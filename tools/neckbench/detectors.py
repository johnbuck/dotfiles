"""Candidate neck detectors, scored against each other by bench.py.

Every detector returns a dict and NEVER refuses. Refusing was safe but useless:
it left the caller with nothing on exactly the figures that need help. Instead
each answer carries `confidence` and a `low_confidence` flag, so a caller that
needs certainty can gate on it and a caller that just needs somewhere to start
gets somewhere to start.

Contract:
    neck_z         best estimate of the narrowest point
    neck_base_z    where the neck stops being a column and becomes shoulder
    neck_join_z    where it becomes head
    confidence     0..1
    low_confidence bool

Rebuilt after an adversarial audit found the previous version's measurements
biased and its peak-finding wrong. Each fix is commented where it applies,
because every one of them looked reasonable until it was measured.
"""
import bpy  # noqa: F401


# ------------------------------------------------------------ measurements --

def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def median_edge(obj, sample=4000):
    """Typical edge length in WORLD units.

    Measuring in local coordinates, as the previous version did, is correct only
    while the object carries no scale. Everything else here is world-space, so a
    scaled object silently mixed units.
    """
    import random
    es, vs = obj.data.edges, obj.data.vertices
    if not len(es):
        return 0.0
    mw = obj.matrix_world
    rnd = random.Random(0)
    idx = range(len(es)) if len(es) <= sample else rnd.sample(range(len(es)),
                                                              sample)
    ds = sorted(((mw @ vs[es[i].vertices[0]].co)
                 - (mw @ vs[es[i].vertices[1]].co)).length for i in idx)
    return ds[len(ds) // 2]


def _bands(vs, lo, H, nbands, min_frac=0.0006):
    """Bucket vertices by height, with a RELATIVE population gate.

    The old gate was `len(g) < 8`, an absolute count. On these 55k-vertex test
    meshes it never fired; on a 20k-vertex reconstruction at the same band count
    it would null out bands that are perfectly measurable, including the neck
    itself, letting the jaw win by default.
    """
    bands = [[] for _ in range(nbands)]
    for v in vs:
        bands[min(nbands - 1, int((v.z - lo) / H * nbands))].append(v)
    return bands, max(6, int(len(vs) * min_frac))


def _smooth(prof, k):
    """Moving average over 2k+1 bands.

    The previous default averaged 5 bands = 0.036 in z against a neck plateau of
    0.015: a kernel 2.2x wider than the feature. It dragged the shoulder into
    the neck's number and moved every area detector's answer up a full band.
    With 300 bands, k=1 spans 0.010, comfortably inside the feature.
    """
    if not k:
        return prof
    vals = [p[1] for p in prof]
    out = []
    for i, p in enumerate(prof):
        if p[1] is None:
            out.append(p)
            continue
        w = [vals[j] for j in range(max(0, i - k), min(len(vals), i + k + 1))
             if vals[j] is not None]
        out.append((p[0], sum(w) / len(w)) + tuple(p[2:]))
    return out


def width_profile(obj, nbands=300):
    """Bounding-box width per band: what the CURRENT production method uses.

    This statistic is not rotation-invariant. A 0.24 x 0.12 shoulder slab scores
    0.36 at yaw 0 and 0.51 at yaw 45, while a circular neck scores the same at
    both, so the ranking between bands shifts with the figure's arbitrary yaw
    and two runs of the same character can disagree.
    """
    vs = world_verts(obj)
    lo, hi = min(v.z for v in vs), max(v.z for v in vs)
    H = hi - lo
    bands, floor = _bands(vs, lo, H, nbands)
    out = []
    for i, g in enumerate(bands):
        z = lo + (i + 0.5) * H / nbands
        out.append((z, None) if len(g) < floor else
                   (z, (max(v.x for v in g) - min(v.x for v in g))
                    + (max(v.y for v in g) - min(v.y for v in g))))
    return out, lo, hi, H


def _cell_for(obj, vs):
    """Grid cell tied to the MESH's resolution, not to the figure's bbox.

    Basing it on the bbox made the ruler coarser whenever a costume grew: a
    figure with pauldrons was measured 33% more coarsely than a bare one, so
    areas were not comparable across cases. It must also stay at or above the
    vertex spacing, or a slice of a closed surface fragments into dozens of
    "islands" because neighbouring surface points land in non-adjacent cells.
    """
    e = median_edge(obj)
    if e <= 0:
        xs = [v.x for v in vs]
        return (max(xs) - min(xs)) / 100.0
    return e * 1.6


def area_profile(obj, nbands=300, smooth=1):
    """Filled cross-section area per band.

    Still a per-row hull rather than a true fill, so it bridges gaps between
    disjoint pieces of a slice and over-reads by 7 to 50 percent depending on
    shape. That bias is known and measured; it is tolerated because it is cheap
    and monotone enough to locate a minimum, and because the ground truth this
    is scored against is computed exactly instead.
    """
    vs = world_verts(obj)
    lo, hi = min(v.z for v in vs), max(v.z for v in vs)
    H = hi - lo
    cell = _cell_for(obj, vs)
    x0, y0 = min(v.x for v in vs), min(v.y for v in vs)
    bands, floor = _bands(vs, lo, H, nbands)

    prof = []
    for i, g in enumerate(bands):
        z = lo + (i + 0.5) * H / nbands
        if len(g) < floor:
            prof.append((z, None))
            continue
        rows = {}
        for v in g:
            r, c = int((v.y - y0) / cell), int((v.x - x0) / cell)
            lohi = rows.get(r)
            rows[r] = (c, c) if lohi is None else (min(lohi[0], c),
                                                   max(lohi[1], c))
        prof.append((z, sum(hc - lc + 1 for lc, hc in rows.values())
                     * cell * cell))
    return _smooth(prof, smooth), lo, hi, H


# ------------------------------------------------------------ peak finding --

def local_minima(seq):
    """Local minima with prominence, by neighbour comparison.

    The obvious test, "smaller than everything on both sides", is wrong here and
    silently disqualified the correct answer every time: above a neck sits a
    head, and a head tapers to almost nothing at the crown, so a neck is never
    the lowest point of the region above it.
    """
    out = []
    for k in range(1, len(seq) - 1):
        a = seq[k][2]
        if a > seq[k - 1][2] or a > seq[k + 1][2]:
            continue
        pl = a
        for j in range(k - 1, -1, -1):
            pl = max(pl, seq[j][2])
            if seq[j][2] < a:
                break
        pr = a
        for j in range(k + 1, len(seq)):
            pr = max(pr, seq[j][2])
            if seq[j][2] < a:
                break
        out.append({"k": k, "z": seq[k][1], "area": a,
                    "prominence": min(pl, pr) / max(a, 1e-12)})
    return sorted(out, key=lambda d: -d["prominence"])


def _plateau(pts, k, tol=1.03):
    """Contiguous run around a minimum within tol of it, and its CENTRE.

    Scanning the whole profile for "within 3% of the minimum" leaks to the
    crown, where the head's section falls below the neck's and trivially
    qualifies. Walk outward instead. Returning the centre makes a flat minimum
    resolve deterministically rather than by list order.
    """
    a = pts[k][2]
    i = k
    while i - 1 >= 0 and pts[i - 1][2] <= a * tol:
        i -= 1
    j = k
    while j + 1 < len(pts) and pts[j + 1][2] <= a * tol:
        j += 1
    return pts[i][1], pts[j][1], (pts[i][1] + pts[j][1]) / 2


def _walk(pts, k, widen, max_span):
    """Neck base and join: walk out until the section widens or a cap is hit.

    Without the cap this ran off the end of the figure. Below the hips the
    head-island trace follows one leg, whose area is well under `widen` times a
    buried neck's, so the walk reached the FLOOR and the reported neck landed at
    the figure's waist.
    """
    a, z0 = pts[k][2], pts[k][1]
    base = z0
    for j in range(k - 1, -1, -1):
        if pts[j][2] > a * widen or abs(pts[j][1] - z0) > max_span:
            break
        base = pts[j][1]
    join = z0
    for j in range(k + 1, len(pts)):
        if pts[j][2] > a * widen or abs(pts[j][1] - z0) > max_span:
            break
        join = pts[j][1]
    return base, join


def _window(prof, lo, H, f_lo, f_hi):
    return [(i, p[0], p[1]) for i, p in enumerate(prof)
            if p[1] is not None and f_lo <= (p[0] - lo) / H <= f_hi]


def _at_edge(pts, k):
    """Is the chosen minimum pinned to the search window's boundary?

    Two cases were decided by window arithmetic rather than by any detector: the
    profile fell monotonically to the crown, `min()` walked to the last in-window
    band and stopped. An answer at the boundary is not a minimum, it is where we
    stopped looking.
    """
    return k <= 1 or k >= len(pts) - 2


# --------------------------------------------------------------- detectors --

def _argmin_detector(prof, lo, H, f_lo, f_hi, tag):
    pts = _window(prof, lo, H, f_lo, f_hi)
    if len(pts) < 4:
        return {"neck_z": lo + H * 0.85, "confidence": 0.0,
                "low_confidence": True, "method": tag, "note": "no bands"}
    k = min(range(len(pts)), key=lambda i: pts[i][2])
    edge = _at_edge(pts, k)
    return {"neck_z": pts[k][1], "metric": pts[k][2], "window_edge": edge,
            "confidence": 0.15 if edge else 0.7, "low_confidence": edge,
            "method": tag}


def detect_width(obj, f_lo=0.60, f_hi=0.95):
    """A: the current production method."""
    prof, lo, hi, H = width_profile(obj)
    return _argmin_detector(prof, lo, H, f_lo, f_hi, "width_argmin")


def detect_area_min(obj, f_lo=0.60, f_hi=0.95):
    """B: smallest cross-section area, same fixed window."""
    prof, lo, hi, H = area_profile(obj)
    return _argmin_detector(prof, lo, H, f_lo, f_hi, "area_argmin")


def _prominence_detector(prof, lo, H, f_lo, f_hi, widen, tag):
    pts = _window(prof, lo, H, f_lo, f_hi)
    if len(pts) < 6:
        return {"neck_z": lo + H * 0.85, "confidence": 0.0,
                "low_confidence": True, "method": tag, "note": "no bands"}
    mins = local_minima(pts)
    if mins:
        k, prom = mins[0]["k"], mins[0]["prominence"]
    else:
        k, prom = min(range(len(pts)), key=lambda i: pts[i][2]), 1.0
    zl, zr, zc = _plateau(pts, k)
    base, join = _walk(pts, k, widen, H * 0.12)

    # Confidence: how deep the basin is, reduced by how flat the minimum is and
    # by whether it sits where we stopped looking.
    conf = min(1.0, max(0.0, (prom - 1.15) / 1.6))
    conf *= max(0.15, 1.0 - (zr - zl) / (0.10 * H))
    if _at_edge(pts, k):
        conf *= 0.3
    return {"neck_z": zc, "neck_base_z": base, "neck_join_z": join,
            "prominence": prom, "plateau": zr - zl, "confidence": conf,
            "low_confidence": conf < 0.35, "method": tag}


def detect_area_prominence(obj, f_lo=0.55, f_hi=0.98, widen=1.7):
    """C: whole-slice area, prominence, plateau centre, bounded walks."""
    prof, lo, hi, H = area_profile(obj)
    return _prominence_detector(prof, lo, H, f_lo, f_hi, widen,
                                "area_prominence")


# ------------------------------------------------------------- head island --

def _head_axis(vs, top_frac=0.04):
    zs = sorted(v.z for v in vs)
    cut = zs[int(len(zs) * (1 - top_frac))]
    top = [v for v in vs if v.z >= cut]
    return (sum(v.x for v in top) / len(top), sum(v.y for v in top) / len(top))


def _slice_islands(g, cell, x0, y0):
    occ = {}
    for v in g:
        occ.setdefault((int((v.x - x0) / cell), int((v.y - y0) / cell)),
                       []).append(v)
    seen, islands = set(), []
    for key in occ:
        if key in seen:
            continue
        stack, cells, pts = [key], [], []
        seen.add(key)
        while stack:
            c = stack.pop()
            cells.append(c)
            pts += occ[c]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nk = (c[0] + dx, c[1] + dy)
                    if nk in occ and nk not in seen:
                        seen.add(nk)
                        stack.append(nk)
        rows = {}
        for c, r in cells:
            lohi = rows.get(r)
            rows[r] = (c, c) if lohi is None else (min(lohi[0], c),
                                                   max(lohi[1], c))
        islands.append({
            "area": sum(hc - lc + 1 for lc, hc in rows.values()) * cell * cell,
            "cx": sum(p.x for p in pts) / len(pts),
            "cy": sum(p.y for p in pts) / len(pts)})
    return islands


def head_island_profile(obj, nbands=300, smooth=1):
    """Area of the island containing the HEAD, walking downward.

    Measuring the whole slice lets a braid, cape, quiver or pauldron contaminate
    the neck's number: they add material at neck height without being part of
    the neck. Following only the head's island removes that class entirely.
    """
    vs = world_verts(obj)
    lo, hi = min(v.z for v in vs), max(v.z for v in vs)
    H = hi - lo
    cell = _cell_for(obj, vs)
    x0, y0 = min(v.x for v in vs), min(v.y for v in vs)
    bands, floor = _bands(vs, lo, H, nbands)

    prof = [None] * nbands
    cur = _head_axis(vs)
    for i in range(nbands - 1, -1, -1):
        z = lo + (i + 0.5) * H / nbands
        g = bands[i]
        if len(g) < floor:
            prof[i] = (z, None, 0)
            continue
        isl = _slice_islands(g, cell, x0, y0)
        pick = min(isl, key=lambda d: (d["cx"] - cur[0]) ** 2
                   + (d["cy"] - cur[1]) ** 2)
        prof[i] = (z, pick["area"], len(isl))
        cur = (pick["cx"], pick["cy"])
    return _smooth(prof, smooth), lo, hi, H


def detect_head_island(obj, f_lo=0.55, f_hi=0.98, widen=1.7):
    """E: head-island area with the same prominence and confidence machinery."""
    prof3, lo, hi, H = head_island_profile(obj)
    prof = [(p[0], p[1]) for p in prof3]
    r = _prominence_detector(prof, lo, H, f_lo, f_hi, widen, "head_island")
    islands = [p[2] for p in prof3
               if p[1] is not None and abs(p[0] - r["neck_z"]) < H * 0.01]
    if islands:
        n = max(islands)
        r["islands"] = n
        if n > 1:
            r["confidence"] *= 0.6
            r["low_confidence"] = r["confidence"] < 0.35
    return r


DETECTORS = {
    "A_width_current": detect_width,
    "B_area_min": detect_area_min,
    "C_area_prominence": detect_area_prominence,
    "E_head_island": detect_head_island,
}
