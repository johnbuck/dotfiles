"""Shared Blender helpers for the pnk-sculpt pipeline.

Everything here is import-only: no side effects, no hardcoded project paths. The
CLI entry points (mesh.py, assemble.py, prop.py, rig.py, printprep.py) import
this and are the things you actually run.

Two ideas run through the whole file and are worth understanding before you use
any of it.

1. Units. Blender units are arbitrary. The pipeline keeps the figure at roughly
   1.0 unit tall through every intermediate stage and converts to millimetres
   only at export. `mm_per_unit()` derives the conversion from the object's own
   bounding box and the target height, so nothing has to remember a constant and
   the scale cannot silently drift between scripts.

2. Health. "Printable" means watertight (no holes, no non-manifold edges) and
   single-shell (one connected piece). `health()` measures both, plus a surface
   roughness figure that catches the failure mode a manifold check misses: a
   mesh can be perfectly closed and still be a spiky mess. Measure after every
   destructive operation rather than at the end, because when the final mesh is
   bad you want to know which step broke it.
"""
import math
import os
import statistics
import sys

import bpy
import bmesh
from mathutils import Vector


# ---------------------------------------------------------------- plumbing --

def argv():
    """Args after the `--` separator Blender uses to end its own options."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def clear():
    bpy.ops.wm.read_homefile(use_empty=True)


def load(path):
    """Import a mesh file or open a .blend. Returns the mesh objects."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    elif ext == ".stl":
        try:
            bpy.ops.wm.stl_import(filepath=path)
        except AttributeError:
            bpy.ops.import_mesh.stl(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".ply":
        try:
            bpy.ops.wm.ply_import(filepath=path)
        except AttributeError:
            bpy.ops.import_mesh.ply(filepath=path)
    else:
        raise SystemExit(f"unsupported input: {path}")
    return scene_meshes(path)


def scene_meshes(what="the scene"):
    """Mesh objects that can actually be selected.

    A generated Rigify rig brings dozens of WGT-* control-shape meshes that live
    in a hidden collection outside the view layer. They look like ordinary mesh
    objects in `scene.objects`, and any attempt to select one raises
    "cannot be selected because it is not in View Layer", which kills a render
    of an otherwise fine posed figure.
    """
    in_layer = set(bpy.context.view_layer.objects)
    meshes = [o for o in bpy.context.scene.objects
              if o.type == "MESH" and o in in_layer]
    if not meshes:
        raise SystemExit(f"no selectable mesh objects in {what}")
    return meshes


def load_one(path, name="Figure"):
    """Import and join everything into a single welded object."""
    objs = load(path)
    obj = join_all(objs, name)
    weld(obj)
    return obj


def append_object(blend, prefer="Figure", newname=None):
    """Pull one object out of a .blend without opening it as the current file."""
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        names = list(src.objects)
        dst.objects = ([n for n in names if n == prefer] or names)[:1]
    if not dst.objects:
        raise SystemExit(f"no objects in {blend}")
    obj = dst.objects[0]
    bpy.context.scene.collection.objects.link(obj)
    if newname:
        obj.name = newname
    return obj


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def join_all(objs, name="Figure"):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def weld(obj, dist=1e-5):
    """Merge coincident vertices, returning how many went away.

    glTF splits vertices at every UV and normal seam, so a single closed shell
    imports looking like thousands of separate components with tens of thousands
    of boundary edges. Weld before judging topology or you will chase a problem
    that does not exist.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()
    return before - len(obj.data.vertices)


# ------------------------------------------------------------------ health --

def health(obj):
    """Topology and surface-quality report for one mesh object."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)

    nm_edges = sum(1 for e in bm.edges if not e.is_manifold)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nm_verts = sum(1 for v in bm.verts if not v.is_manifold)
    loose_verts = sum(1 for v in bm.verts if not v.link_edges)

    seen = set()
    comps = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        seen.add(f.index)
        n = 0
        while stack:
            cur = stack.pop()
            n += 1
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index not in seen:
                        seen.add(nf.index)
                        stack.append(nf)
        comps.append(n)
    comps.sort(reverse=True)

    vol = bm.calc_volume(signed=True)

    # Dihedral angle between neighbouring faces. A well formed surface sits near
    # zero; a population near 180 means folded, spiky triangles, which is what a
    # raw voxel decode looks like and what a manifold check will happily pass.
    angs = []
    degenerate = 0
    for e in bm.edges:
        if len(e.link_faces) == 2:
            n0, n1 = e.link_faces[0].normal, e.link_faces[1].normal
            # Booleans leave zero-area faces whose normal is a zero vector.
            if n0.length_squared == 0.0 or n1.length_squared == 0.0:
                degenerate += 1
                continue
            angs.append(math.degrees(n0.angle(n1)))
    angs.sort()
    na = len(angs) or 1
    bm.free()

    return {
        "verts": len(obj.data.vertices),
        "faces": len(obj.data.polygons),
        "non_manifold_edges": nm_edges,
        "boundary_edges": boundary,
        "non_manifold_verts": nm_verts,
        "loose_verts": loose_verts,
        "components": len(comps),
        "largest_comps": comps[:6],
        "signed_volume": round(vol, 6),
        "dims": tuple(round(v, 4) for v in obj.dimensions),
        "dihedral_p50": round(angs[int(na * 0.50)], 1) if angs else None,
        "dihedral_p95": round(angs[int(na * 0.95)], 1) if angs else None,
        "frac_folded_gt90": round(sum(1 for a in angs if a > 90) / na, 4),
        "degenerate_edges": degenerate,
    }


def is_watertight(h):
    return h["non_manifold_edges"] == 0 and h["boundary_edges"] == 0


def check(tag, obj, height_mm=None, verbose=False, mm=None):
    """One-line health line. Use it after every destructive step.

    Pass `mm` (units per millimetre) when the object is a PART of a figure
    rather than the whole thing. Deriving the scale from a part's own height
    silently reports every part as exactly `height_mm` tall, which looks fine
    and is meaningless.
    """
    h = health(obj)
    dims = h["dims"]
    if mm is None and height_mm and obj.dimensions.z > 0:
        mm = mm_per_unit(obj, height_mm)
    if mm:
        dims = tuple(round(d / mm, 1) for d in dims)
        unit = "mm"
    else:
        unit = "u"
    print(
        f"[{tag}] faces={h['faces']} comps={h['components']} "
        f"nm={h['non_manifold_edges']} bnd={h['boundary_edges']} "
        f"p95dihedral={h['dihedral_p95']} folded={h['frac_folded_gt90']} "
        f"dims_{unit}={dims} watertight={is_watertight(h)}",
        flush=True,
    )
    if verbose:
        for k, v in h.items():
            print(f"    {k}: {v}")
    return h


def report(tag, obj):
    """Verbose multi-line health report."""
    h = health(obj)
    print(f"\n--- {tag} ---")
    for k, v in h.items():
        print(f"  {k}: {v}")
    print(f"  WATERTIGHT: {is_watertight(h)}")
    print(f"  SINGLE SHELL: {h['components'] == 1}")
    sys.stdout.flush()
    return h


# ------------------------------------------------------------------- units --

def mm_per_unit(obj, height_mm):
    """Blender units per millimetre, derived from this object's own height.

    Deriving it rather than storing it means every script agrees on scale even
    after a stage changes the figure's height, which the proportion pass does.
    """
    return obj.dimensions.z / float(height_mm)


# -------------------------------------------------------------- operations --

def add_modifier_apply(obj, kind, **kw):
    m = obj.modifiers.new(kind, kind)
    for k, v in kw.items():
        setattr(m, k, v)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    return obj


def voxel_remesh(obj, voxel, fix_poles=True):
    obj.data.remesh_voxel_size = voxel
    obj.data.remesh_voxel_adaptivity = 0.0
    obj.data.use_remesh_fix_poles = fix_poles
    select_only(obj)
    bpy.ops.object.voxel_remesh()
    return obj


def subdivide(obj, levels):
    """Catmull-Clark subdivision before a fine voxel remesh.

    A reconstruction is typically ~280k faces, so its triangles are larger than
    a fine voxel. Remeshing finer than the source samples flat triangle facets
    and the result reads as noise on what should be a smooth surface.
    Subdividing first removes the facets so the remesh has a smooth field to
    sample. This is the single highest-value trick in the mesh stage.
    """
    m = obj.modifiers.new("subd", "SUBSURF")
    m.subdivision_type = "CATMULL_CLARK"
    m.levels = m.render_levels = levels
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    return obj


def keep_largest_component(obj, name=None):
    """Split by loose parts, keep the biggest, delete the rest."""
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if len(parts) <= 1:
        return obj, 0
    parts.sort(key=lambda o: len(o.data.polygons), reverse=True)
    keep, drop = parts[0], parts[1:]
    dropped = sum(len(o.data.polygons) for o in drop)
    for o in drop:
        bpy.data.objects.remove(o, do_unlink=True)
    keep.name = name or obj.name
    bpy.context.view_layer.objects.active = keep
    return keep, dropped


def cleanup_after_boolean(obj):
    """Exact booleans leave slivers, zero-area faces and inconsistent normals
    along the cut. Left alone these break the roughness metric (a zero-length
    normal has no angle) and confuse later remeshes."""
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-6)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def boolean(target, cutter, op, remove_cutter=True):
    m = target.modifiers.new("bool", "BOOLEAN")
    m.operation = op
    m.object = cutter
    m.solver = "EXACT"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    if remove_cutter:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return cleanup_after_boolean(target)


def fill_holes(obj):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_non_manifold()
    bpy.ops.mesh.fill_holes(sides=0)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def decimate_safely(obj, target_faces):
    """Decimate, then revert if it broke watertightness.

    Blender's collapse decimator can introduce non-manifold edges on a dense
    organic mesh. Face count is a convenience; watertightness is the contract.
    So try, attempt a repair, and if it still fails put the dense mesh back
    rather than shipping a broken one.
    """
    cur = len(obj.data.polygons)
    if cur <= target_faces:
        return obj, "skipped"
    backup = obj.data.copy()
    print(f">> decimating {cur} -> {target_faces}", flush=True)
    add_modifier_apply(obj, "DECIMATE", ratio=target_faces / cur)
    weld(obj)
    fill_holes(obj)
    h = health(obj)
    if not is_watertight(h):
        print(
            f"   decimation left nm={h['non_manifold_edges']} "
            f"bnd={h['boundary_edges']} after repair; reverting",
            flush=True,
        )
        old = obj.data
        obj.data = backup
        bpy.data.meshes.remove(old)
        return obj, "reverted"
    print(f"   decimated cleanly to {h['faces']} faces", flush=True)
    bpy.data.meshes.remove(backup)
    return obj, "ok"


# ------------------------------------------------------------- measurement --

def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def slice_profile(obj, nbands=90):
    """Width of the figure in x and y at each of nbands heights.

    Used to find anatomical landmarks (the neck is the narrowest band in the
    upper fifth) without any hand-tuned coordinates.
    """
    vs = world_verts(obj)
    lo = min(v.z for v in vs)
    hi = max(v.z for v in vs)
    H = hi - lo
    bands = [[] for _ in range(nbands)]
    for v in vs:
        bands[min(nbands - 1, int((v.z - lo) / H * nbands))].append(v)
    out = []
    for i, g in enumerate(bands):
        if len(g) < 8:
            out.append(None)
            continue
        z = lo + (i + 0.5) * H / nbands
        out.append((z, max(v.x for v in g) - min(v.x for v in g),
                    max(v.y for v in g) - min(v.y for v in g), len(g)))
    return out, lo, hi, H


def find_narrowest(obj, f_lo, f_hi):
    """Narrowest horizontal band between two height fractions.

    (sum_of_widths, z, x_width, y_width, height_fraction), plus the bbox.
    """
    prof, lo, hi, H = slice_profile(obj)
    best = None
    for p in prof:
        if not p:
            continue
        z, xw, yw, _ = p
        f = (z - lo) / H
        if not (f_lo <= f <= f_hi):
            continue
        s = xw + yw
        if best is None or s < best[0]:
            best = (s, z, xw, yw, f)
    if best is None:
        raise SystemExit(f"no populated band between {f_lo} and {f_hi}")
    return best, lo, hi, H


def band_centre(obj, z, tol, r=0.055, iters=6):
    """Centre of the body at height z, by mean-shift rather than bounding box.

    The bounding-box midpoint of a horizontal band is pulled sideways by
    anything else crossing that height: a braid on one side, quiver arrows on
    the other. On one figure that moved the neck centre 29 mm off axis, and the
    head-removal cylinder centred on it then ate the arrows.

    Starting from the median and mean-shifting into the densest nearby cluster
    locks onto the neck itself and is stable against both.
    """
    g = [v for v in world_verts(obj) if abs(v.z - z) < tol]
    if not g:
        return 0.0, 0.0
    xs = sorted(v.x for v in g)
    ys = sorted(v.y for v in g)
    cx, cy = xs[len(xs) // 2], ys[len(ys) // 2]
    for _ in range(iters):
        near = [v for v in g if (v.x - cx) ** 2 + (v.y - cy) ** 2 < r * r]
        if not near:
            break
        cx = sum(v.x for v in near) / len(near)
        cy = sum(v.y for v in near) / len(near)
    return cx, cy


def bvh_for(obj):
    import mathutils
    return mathutils.bvhtree.BVHTree.FromObject(
        obj, bpy.context.evaluated_depsgraph_get())


def probe_surface(bvh, x, z, from_y=-1.0, spread=0.004, n=2):
    """Median front-surface depth over a small grid of rays.

    A single ray is fragile: it can strike hair hanging in front of the face, or
    slip through a gap and hit the back of the skull. Sampling a grid and taking
    the median is robust to both. The returned spread tells you whether the
    samples agreed; a wide spread means something is occluding that spot.
    """
    hits = []
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            o = Vector((x + i * spread, from_y, z + j * spread))
            hit, _, _, _ = bvh.ray_cast(o, Vector((0, 1, 0)))
            if hit is not None:
                hits.append(hit.y)
    if not hits:
        return None
    return statistics.median(hits), max(hits) - min(hits), len(hits)


def section_blobs(vs, z, tol, cell):
    """How many separate pieces of material cross a plane, largest first.

    Grid the band in x and y and flood fill occupied cells. Cheap, and it does
    not care about mesh topology, only about where material actually is.
    """
    band = [v for v in vs if abs(v.z - z) < tol]
    if not band:
        return []
    occ = {}
    for v in band:
        occ.setdefault((int(v.x // cell), int(v.y // cell)), []).append(v)
    seen, blobs = set(), []
    for key in occ:
        if key in seen:
            continue
        stack, members = [key], []
        seen.add(key)
        while stack:
            k = stack.pop()
            members += occ[k]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nk = (k[0] + dx, k[1] + dy)
                    if nk in occ and nk not in seen:
                        seen.add(nk)
                        stack.append(nk)
        blobs.append(members)
    blobs.sort(key=len, reverse=True)
    return blobs


def find_crotch(obj, zlo, zhi, lo_f=0.25, hi_f=0.62, steps=60, bins=41):
    """Highest height that still shows a gap between the legs.

    Two earlier approaches failed on a real figure and are worth knowing about,
    because both look reasonable on paper:

    - Widest band below the waist. On a costumed figure the widest band is a
      skirt hem, a cape or a boot flare, not the pelvis. It put the hip at 34%
      of height.
    - Lowest band where the section is a single blob. A cape hanging behind the
      legs merges them at mid-thigh, so it answered 25%.

    What survives both is looking for an actual gap on the CENTRELINE of the
    FRONT surface. A cape behind the legs occupies the same x range but a
    different y, so restricting to the front half ignores it, and a hem does not
    close the gap between the legs, only widens the silhouette. A tabard hanging
    between the legs still defeats this, hence the caller's fallback.
    """
    vs = world_verts(obj)
    H = zhi - zlo
    tol = H * 0.005
    xs = [v.x for v in vs]
    cx = (max(xs) + min(xs)) * 0.5
    width = max(xs) - min(xs)
    if width <= 0:
        return None
    best = None
    for i in range(steps + 1):
        f = lo_f + (hi_f - lo_f) * i / steps
        z = zlo + H * f
        band = [v for v in vs if abs(v.z - z) < tol]
        if len(band) < 40:
            continue
        ys = sorted(v.y for v in band)
        front_cut = ys[len(ys) // 2]
        band = [v for v in band if v.y <= front_cut]
        if len(band) < 20:
            continue
        occ = set()
        for v in band:
            occ.add(int((v.x - cx) / width * bins))
        mid = 0
        if mid in occ:
            continue                      # material on the centreline: no gap
        left = [b for b in occ if b < mid]
        right = [b for b in occ if b > mid]
        if left and right:
            best = z                      # legs either side of an empty middle
    return best


def min_wall_thickness(obj, samples=4000, seed=1, opposing=0.5):
    """Estimate the thinnest wall by casting inward rays from the surface.

    This is an estimate, not a proof. It samples face centres, fires a ray along
    the inward normal, and records the distance to the far wall. Good enough to
    catch a bowstring that will not survive a scale-down, which is the failure
    it exists to prevent.

    The `opposing` filter is what makes the number meaningful. Without it every
    concave crease reports near-zero thickness, because the ray immediately hits
    a neighbouring face that folds back toward it. A genuine opposite wall is
    hit from behind, so its outward normal points roughly along the ray; a
    crease neighbour's points back at the ray. Requiring the dot product to
    exceed `opposing` keeps only the real ones.
    """
    import random
    rnd = random.Random(seed)
    bvh = bvh_for(obj)
    mw = obj.matrix_world
    nm = mw.to_3x3()
    polys = obj.data.polygons
    if not len(polys):
        return None
    idx = range(len(polys)) if len(polys) <= samples else \
        rnd.sample(range(len(polys)), samples)
    eps = obj.dimensions.length * 1e-5
    dists = []
    rejected = 0
    outside = 0
    for i in idx:
        p = polys[i]
        c = mw @ p.center
        n = (nm @ p.normal).normalized()
        d_ray = -n
        hit, hn, _, d = bvh.ray_cast(c + d_ray * eps, d_ray)
        if hit is None or d is None or d <= eps:
            continue
        if hn is not None and hn.dot(d_ray) < opposing:
            rejected += 1
            continue
        # Is the span actually MATERIAL? A ray crossing a narrow surface slot
        # also lands on a roughly opposing face, so the normal test alone
        # measures crevices, not walls, and a detailed sculpt then reports a
        # sub-millimetre "wall thickness" everywhere. Sample the midpoint: for a
        # real wall it lies inside the solid, for a slot it lies in open air.
        mid = c + d_ray * (d * 0.5)
        nloc, nnor, _, _ = bvh.find_nearest(mid)
        if nloc is None or (mid - nloc).dot(nnor) > 0:
            outside += 1
            continue
        dists.append((d + eps, c))
    if not dists:
        return None
    dists.sort(key=lambda t: t[0])
    vals = [d for d, _ in dists]
    return {
        "min": vals[0],
        "p01": vals[int(len(vals) * 0.01)],
        "p05": vals[int(len(vals) * 0.05)],
        "median": vals[len(vals) // 2],
        "samples": len(vals),
        "rejected_creases": rejected,
        "rejected_slots": outside,
        # Keep where the thin samples are. A percentile on its own cannot tell
        # you whether a figure has one genuinely fragile feature or is simply
        # covered in fine surface detail, and those need opposite responses.
        "thin_points": [c for _, c in dists[:max(20, len(dists) // 100)]],
    }


# ------------------------------------------------------------------ render --

def setup_studio(objs, clay=True, res=(900, 1200), lens=85):
    """Neutral three-point studio with a camera that tracks the subject.

    Light energy scales with the subject's size. Fixed energies blow out a 30 mm
    mini and leave a 200 mm figure black, and a blown-out render hides exactly
    the surface defects you are rendering to find.
    """
    scn = bpy.context.scene
    try:
        scn.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scn.render.engine = "CYCLES"
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.view_settings.view_transform = "Standard"

    if scn.world is None:
        scn.world = bpy.data.worlds.new("World")
    scn.world.use_nodes = True
    scn.world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.20, 0.20, 0.22, 1.0)

    if clay:
        mat = bpy.data.materials.new("Clay")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (0.34, 0.33, 0.32, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.55
        for o in objs:
            o.data.materials.clear()
            o.data.materials.append(mat)
            for p in o.data.polygons:
                p.use_smooth = True

    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    ctr = (lo + hi) * 0.5
    H = max(hi.z - lo.z, hi.x - lo.x, hi.y - lo.y)

    tgt = bpy.data.objects.new("CamTarget", None)
    scn.collection.objects.link(tgt)
    tgt.location = ctr

    cd = bpy.data.cameras.new("Cam")
    cd.lens = lens
    cam = bpy.data.objects.new("Camera", cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    t = cam.constraints.new("TRACK_TO")
    t.target = tgt
    t.track_axis = "TRACK_NEGATIVE_Z"
    t.up_axis = "UP_Y"

    for name, off, energy in (("Key", (1.8, -2.2, 1.9), 1.6),
                              ("Fill", (-2.2, -1.6, 1.1), 0.7),
                              ("Rim", (-0.9, 2.4, 1.8), 1.1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy * 90 * (H ** 2)
        ld.size = H * 1.2
        lobj = bpy.data.objects.new(name, ld)
        lobj.location = (ctr.x + off[0] * H, ctr.y + off[1] * H,
                         ctr.z + off[2] * H * 0.4)
        scn.collection.objects.link(lobj)
        lt = lobj.constraints.new("TRACK_TO")
        lt.target = tgt
        lt.track_axis = "TRACK_NEGATIVE_Z"
        lt.up_axis = "UP_Y"

    half_fov = math.atan((cd.sensor_width * 0.5) / cd.lens)
    dist = (H * 0.5 * 1.25) / math.tan(half_fov)
    return cam, tgt, ctr, H, dist


ANGLE_TAGS = {0: "front", 45: "q45", 90: "side", 135: "q135", 180: "back",
              270: "side2"}


# ------------------------------------------------------------------ export --

def to_millimetres(obj, height_mm):
    """Scale so one Blender unit is one millimetre and sit the object on z=0."""
    mm = mm_per_unit(obj, height_mm)
    select_only(obj)
    obj.scale = (1 / mm, 1 / mm, 1 / mm)
    bpy.ops.object.transform_apply(scale=True)
    zmin = min(v.z for v in world_verts(obj))
    obj.location.z -= zmin
    bpy.ops.object.transform_apply(location=True)
    return obj


def export_3mf(obj, path, unit="millimeter"):
    """Write a minimal but valid 3MF.

    Blender has no 3MF exporter, and `hasattr(bpy.ops.wm, "threemf_export")`
    reports True regardless because bpy.ops resolves attribute access lazily and
    never raises. Do not use hasattr to probe for an operator; check
    `dir(bpy.ops.wm)` or call it.

    3MF matters here because STL is naked triangles with no declared unit, which
    is how a 250 mm figure ends up printing at 250 inches. A 3MF states its unit,
    so the slicer cannot guess wrong. The format is a zip holding three XML
    parts, so writing one directly is straightforward.
    """
    import zipfile
    from xml.sax.saxutils import escape  # noqa: F401  (kept for future metadata)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    mw = obj.matrix_world
    verts = [mw @ v.co for v in bm.verts]
    index = {v: i for i, v in enumerate(bm.verts)}
    tris = [tuple(index[lv] for lv in f.verts) for f in bm.faces]
    bm.free()

    vx = "".join(
        f'<vertex x="{v.x:.6g}" y="{v.y:.6g}" z="{v.z:.6g}"/>' for v in verts)
    tx = "".join(
        f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in tris)
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<model unit="{unit}" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        '<resources><object id="1" type="model"><mesh>'
        f'<vertices>{vx}</vertices><triangles>{tx}</triangles>'
        '</mesh></object></resources>'
        '<build><item objectid="1"/></build></model>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '</Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)
    return len(verts), len(tris)


def export_mesh_file(obj, path):
    """Write one object to .stl, .3mf, .obj, .ply or .glb by extension.

    3MF is preferred over STL where the slicer supports it: it records units and
    can carry several parts in one file, where STL is naked triangles with no
    declared scale. STL stays the universal fallback.
    """
    select_only(obj)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".stl":
        try:
            bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True,
                                  ascii_format=False)
        except AttributeError:
            bpy.ops.export_mesh.stl(filepath=path, use_selection=True,
                                    ascii=False)
    elif ext == ".3mf":
        nv, nt = export_3mf(obj, path)
        print(f"   3mf: {nv} vertices, {nt} triangles, unit=millimeter",
              flush=True)
    elif ext == ".obj":
        bpy.ops.wm.obj_export(filepath=path, export_selected_objects=True)
    elif ext == ".ply":
        bpy.ops.wm.ply_export(filepath=path, export_selected_objects=True)
    elif ext in (".glb", ".gltf"):
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True,
                                  export_format="GLB" if ext == ".glb" else "GLTF_SEPARATE")
    else:
        raise SystemExit(f"unsupported export format: {ext}")
    print(f"exported {os.path.basename(path)}  "
          f"{os.path.getsize(path) / 1e6:.1f} MB", flush=True)
    return path


def save(path):
    d = os.path.dirname(os.path.abspath(path))
    if d:
        os.makedirs(d, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"saved {path}", flush=True)
    return path
