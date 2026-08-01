"""Independent ground-truth probe: exact cross-section area per z, by cutting
triangles with the plane and shoelacing the induced contour, oriented by the
face normal. No bands, no grid, no smoothing -- so it can be used to judge the
benchmark's own profile code rather than inheriting its assumptions.

    blender --background --factory-startup --python probe.py -- <casedir> <out.json>
"""
import json
import os
import sys

import numpy as np

import bpy

sys.path.insert(0, os.path.expanduser("~/.claude/skills/pnk-sculpt/scripts"))
from sculptlib import clear, append_object  # noqa: E402


def tri_arrays(obj):
    mw = np.array(obj.matrix_world)
    me = obj.data
    me.calc_loop_triangles()
    nv = len(me.vertices)
    co = np.empty(nv * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(nv, 3)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    nt = len(me.loop_triangles)
    idx = np.empty(nt * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", idx)
    idx = idx.reshape(nt, 3)
    nrm = np.empty(nt * 3)
    me.loop_triangles.foreach_get("normal", nrm)
    nrm = nrm.reshape(nt, 3) @ mw[:3, :3].T
    return co[idx], nrm, co


def section(V, N, z):
    """Exact area + (dx+dy) bbox width of the section at height z."""
    zc = V[:, :, 2] - z
    keep = (zc.min(1) < 0) & (zc.max(1) > 0)
    if not keep.any():
        return 0.0, None
    v, n = V[keep], N[keep]
    m = v.shape[0]
    P = np.zeros((m, 3, 2))
    C = np.zeros((m, 3), bool)
    for k in range(3):
        a, b = v[:, k], v[:, (k + 1) % 3]
        c = (a[:, 2] < z) != (b[:, 2] < z)
        dz = np.where(c, b[:, 2] - a[:, 2], 1.0)
        t = (z - a[:, 2]) / dz
        P[:, k, 0] = a[:, 0] + t * (b[:, 0] - a[:, 0])
        P[:, k, 1] = a[:, 1] + t * (b[:, 1] - a[:, 1])
        C[:, k] = c
    ok = C.sum(1) == 2
    P, C, n = P[ok], C[ok], n[ok]
    order = np.argsort(C, axis=1, kind="stable")[:, -2:]
    r = np.arange(P.shape[0])
    pa = P[r, order[:, 0]]
    pb = P[r, order[:, 1]]
    d = pb - pa
    # interior on the left: outward in-plane normal must be (d.y, -d.x)
    flip = (d[:, 1] * n[:, 0] - d[:, 0] * n[:, 1]) < 0
    pa2 = np.where(flip[:, None], pb, pa)
    pb2 = np.where(flip[:, None], pa, pb)
    area = 0.5 * np.sum(pa2[:, 0] * pb2[:, 1] - pb2[:, 0] * pa2[:, 1])
    allp = np.vstack([pa, pb])
    w = (allp[:, 0].max() - allp[:, 0].min()) + \
        (allp[:, 1].max() - allp[:, 1].min())
    return float(abs(area)), float(w)


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    casedir, out = a[0], a[1]
    step = 0.0005
    res = {}
    for f in sorted(os.listdir(casedir)):
        if not f.endswith(".blend"):
            continue
        case = f[:-6]
        clear()
        obj = append_object(os.path.join(casedir, f), prefer="Figure",
                            newname="Figure")
        V, N, co = tri_arrays(obj)
        lo, hi = float(co[:, 2].min()), float(co[:, 2].max())
        prof = []
        for z in np.arange(0.55, min(hi - 1e-4, 1.08), step):
            ar, w = section(V, N, float(z))
            prof.append([round(float(z), 5), round(ar, 7),
                         None if w is None else round(w, 5)])
        res[case] = {"lo": lo, "hi": hi, "H": hi - lo, "nverts": int(len(co)),
                     "ntris": int(V.shape[0]), "prof": prof}
        print(f"{case:<15} lo={lo:+.5f} hi={hi:.5f} H={hi-lo:.5f} "
              f"verts={len(co)} tris={V.shape[0]}", flush=True)
    json.dump(res, open(out, "w"))
    print("wrote", out)


main()
