"""Print preparation: gate, split into keyed parts, export.

    blender --background --factory-startup --python printprep.py -- <command> [opts]

Everything upstream optimises for looking right. This stage optimises for
physically existing. The two disagree most about thin features: a bowstring that
reads beautifully at 200 mm is 0.14 mm at 28 mm and simply will not form.

Commands
    gate    <in>                  refuse-to-ship checks: watertight, single
                                  shell, thickness, size
    split   <in> <outdir>         cut into printable parts with locating pins
    export  <in> <outdir>         write 3MF / STL / GLB at true scale

The gate runs first and its failures are hard. Shipping a mesh with holes wastes
someone's afternoon and a tank of resin, so it is worth being strict here even
though every other stage is forgiving.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sculptlib import (  # noqa: E402
    append_object, argv, boolean, check, clear, fill_holes, health,
    is_watertight, keep_largest_component, load_one, mm_per_unit,
    min_wall_thickness, save, select_only, to_millimetres, export_mesh_file,
    voxel_remesh, weld, world_verts,
)
import bmesh  # noqa: E402


# Scale presets. The floors are conservative for FDM and comfortable for resin;
# they exist to catch a feature that cannot form, not to dictate style.
PRESETS = {
    "tabletop": {"height_mm": 32.0, "min_feature_mm": 0.5,
                 "target_faces": 250_000, "note":
                 "28-32 mm gaming mini, resin. Expect to simplify or omit "
                 "hair strands, loose straps and bowstrings entirely."},
    "display": {"height_mm": 200.0, "min_feature_mm": 0.8,
                "target_faces": 900_000, "note":
                "150-250 mm display piece. Most detail survives; thin props "
                "still print better as separate parts."},
}


def open_figure(path, name="Figure"):
    clear()
    if path.endswith(".blend"):
        return append_object(path, prefer="Figure", newname=name)
    return load_one(path, name)


# -------------------------------------------------------------------- gate --

def cmd_gate(a):
    preset = PRESETS.get(a.preset, PRESETS["display"])
    height = a.height_mm or preset["height_mm"]
    floor = a.min_mm if a.min_mm is not None else preset["min_feature_mm"]

    obj = open_figure(a.input)
    weld(obj)
    h = health(obj)
    mm = mm_per_unit(obj, height)
    dims_mm = tuple(round(d / mm, 1) for d in h["dims"])

    fails = []
    print(f"gate: preset={a.preset} height={height} mm floor={floor} mm")
    print(f"  faces            {h['faces']}")
    print(f"  dims mm          {dims_mm}")
    print(f"  components       {h['components']}")
    print(f"  non-manifold     {h['non_manifold_edges']}")
    print(f"  boundary edges   {h['boundary_edges']}")
    print(f"  signed volume    {h['signed_volume']}")

    if not is_watertight(h):
        fails.append("not watertight: it has holes or non-manifold edges")
    if h["components"] != 1:
        fails.append(f"{h['components']} separate shells; a print needs one "
                     f"per file (or split them deliberately)")
    if h["signed_volume"] <= 0:
        fails.append("negative or zero volume: normals are inverted")

    t = min_wall_thickness(obj, samples=a.samples)
    if t:
        print(f"  wall thickness   min={t['min'] / mm:.3f} mm  "
              f"p01={t['p01'] / mm:.3f} mm  median={t['median'] / mm:.3f} mm "
              f"({t['samples']} samples)")
        if t["p01"] / mm < floor:
            fails.append(
                f"thinnest 1% of walls is {t['p01'] / mm:.3f} mm, below the "
                f"{floor} mm floor. Scale up, thicken the feature, or split it "
                f"out as a separate part that can be printed thicker.")
    else:
        print("  wall thickness   could not sample")

    if a.max_dim_mm and max(dims_mm) > a.max_dim_mm:
        fails.append(f"largest dimension {max(dims_mm)} mm exceeds the "
                     f"{a.max_dim_mm} mm build volume; split it")

    if fails:
        print("\nGATE FAILED:")
        for f in fails:
            print(f"  - {f}")
        sys.exit(2)
    print("\nGATE PASSED")
    print(f"  note: {preset['note']}")


# ------------------------------------------------------------------- split --

def cut_at_plane(obj, z, name_a, name_b):
    """Bisect into two closed halves. Returns (lower, upper)."""
    upper = obj.copy()
    upper.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(upper)

    for o, keep_below, nm in ((obj, True, name_a), (upper, False, name_b)):
        select_only(o)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.bisect(plane_co=(0, 0, z), plane_no=(0, 0, 1),
                            clear_inner=not keep_below,
                            clear_outer=keep_below)
        bpy.ops.object.mode_set(mode="OBJECT")
        fill_holes(o)
        o.name = nm
    return obj, upper


def band_clusters(obj, z, tol, cell):
    """Cluster the material crossing a plane into separate blobs.

    Grid the band in x and y, then flood fill neighbouring occupied cells. Two
    blobs means the plane passes through two disconnected pieces of the figure,
    which is the thing that quietly ruins a split: cutting a standing figure at
    mid-torso also severs both forearms, so the lower "half" arrives as three
    loose objects instead of one.
    """
    vs = [v for v in world_verts(obj) if abs(v.z - z) < tol]
    if not vs:
        return []
    occupied = {}
    for v in vs:
        key = (int(v.x // cell), int(v.y // cell))
        occupied.setdefault(key, []).append(v)
    seen = set()
    blobs = []
    for key in occupied:
        if key in seen:
            continue
        stack = [key]
        seen.add(key)
        members = []
        while stack:
            k = stack.pop()
            members += occupied[k]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nk = (k[0] + dx, k[1] + dy)
                    if nk in occupied and nk not in seen:
                        seen.add(nk)
                        stack.append(nk)
        blobs.append(members)
    blobs.sort(key=len, reverse=True)
    return blobs


def cut_cross_section(obj, z, tol, cell=None):
    """Centroid and radius of the LARGEST blob crossing a plane, plus the
    blob count.

    The pin goes at the centroid of the largest blob so it sits in the thickest
    part of the section rather than near an edge where it would break out.
    """
    cell = cell or obj.dimensions.x * 0.04
    blobs = band_clusters(obj, z, tol, cell)
    if not blobs:
        return None
    vs = blobs[0]
    cx = sum(v.x for v in vs) / len(vs)
    cy = sum(v.y for v in vs) / len(vs)
    r = min(max(abs(v.x - cx) for v in vs), max(abs(v.y - cy) for v in vs))
    return Vector((cx, cy, z)), r, len(blobs)


def cmd_survey(a):
    """Scan candidate cut heights and report how clean each one would be.

    Run this before `split`. A good cut has exactly one blob in cross-section
    and a reasonably wide one, so the pin has material to sit in and the two
    halves meet on a single seam.
    """
    obj = open_figure(a.input)
    mm = mm_per_unit(obj, a.height_mm)
    vs = world_verts(obj)
    zlo, zhi = min(v.z for v in vs), max(v.z for v in vs)
    tol = (zhi - zlo) * 0.004
    cell = obj.dimensions.x * 0.04
    print(f"cut survey for {os.path.basename(a.input)} "
          f"({a.height_mm} mm tall)")
    print("  frac   z_mm    blobs  widest_mm  verdict")
    for i in range(a.steps + 1):
        f = a.lo + (a.hi - a.lo) * i / a.steps
        z = zlo + (zhi - zlo) * f
        blobs = band_clusters(obj, z, tol, cell)
        if not blobs:
            print(f"  {f:.2f}   {(z - zlo) / mm:6.1f}  {0:5d}   "
                  f"{'-':>9}  no material")
            continue
        b = blobs[0]
        w = max(max(v.x for v in b) - min(v.x for v in b),
                max(v.y for v in b) - min(v.y for v in b)) / mm
        if len(blobs) == 1 and w > a.min_width_mm:
            verdict = "GOOD"
        elif len(blobs) == 1:
            verdict = f"thin ({w:.1f} mm); pin may break out"
        else:
            verdict = (f"{len(blobs)} separate pieces here; the lower part "
                       f"would come away in {len(blobs)} loose objects")
        print(f"  {f:.2f}   {(z - zlo) / mm:6.1f}  {len(blobs):5d}   "
              f"{w:9.1f}  {verdict}")
    print("\nPick a GOOD row and pass its frac to `split --at-frac`.")


def cmd_split(a):
    """Cut the figure at one or more heights and key the halves together.

    A pin and socket pair means the parts locate themselves during assembly
    instead of you eyeballing a glue joint on a curved organic surface. The
    socket is cut oversize by the clearance so the parts actually go together
    after the printer's own dimensional error.
    """
    height = a.height_mm
    obj = open_figure(a.input)
    mm = mm_per_unit(obj, height)
    check("in", obj, height)

    os.makedirs(a.outdir, exist_ok=True)
    vs = world_verts(obj)
    zlo, zhi = min(v.z for v in vs), max(v.z for v in vs)

    cuts = sorted(zlo + (zhi - zlo) * f for f in a.at_frac) if a.at_frac else \
        sorted(zlo + z * mm for z in a.at_mm)
    if not cuts:
        raise SystemExit("give --at-frac or --at-mm")

    parts = []
    current = obj
    for i, z in enumerate(cuts):
        sect = cut_cross_section(current, z, (zhi - zlo) * 0.004)
        if sect is None:
            raise SystemExit(f"no material at z={z:.4f}; pick another cut")
        ctr, r, nblobs = sect
        if nblobs > 1:
            msg = (f"the plane at z={z:.4f} passes through {nblobs} separate "
                   f"pieces of the figure, so this cut will produce loose "
                   f"parts. Run `survey` and pick a height with one blob.")
            if not a.force:
                raise SystemExit("refusing: " + msg)
            print("WARNING: " + msg)
        pin_r = min(a.pin_radius_mm * mm, r * 0.6)
        if pin_r < a.pin_radius_mm * mm:
            print(f"  narrowing pin to r={pin_r / mm:.2f} mm to fit a "
                  f"{r / mm:.2f} mm section")

        lower, upper = cut_at_plane(current, z, f"part{i}", f"part{i + 1}")

        # Pin on the lower half, socket in the upper. Doing it in this order
        # means the pin points up and gravity helps during assembly.
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=48, radius=pin_r, depth=a.pin_length_mm * mm * 2,
            location=(ctr.x, ctr.y, z))
        pin = bpy.context.view_layer.objects.active
        pin_copy = pin.copy()
        pin_copy.data = pin.data.copy()
        bpy.context.scene.collection.objects.link(pin_copy)
        pin_copy.scale = ((pin_r + a.clearance_mm * mm / 2) / pin_r,
                          (pin_r + a.clearance_mm * mm / 2) / pin_r, 1.02)
        select_only(pin_copy)
        bpy.ops.object.transform_apply(scale=True)

        boolean(lower, pin, "UNION")
        # Trim anything the pin added above the cut plane on the lower half.
        select_only(lower)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.bisect(plane_co=(0, 0, z + a.pin_length_mm * mm),
                            plane_no=(0, 0, 1), clear_inner=False,
                            clear_outer=True)
        bpy.ops.object.mode_set(mode="OBJECT")
        fill_holes(lower)
        boolean(upper, pin_copy, "DIFFERENCE")
        fill_holes(upper)

        check(f"part{i} (lower)", lower, mm=mm)
        parts.append(lower)
        current = upper

    check(f"part{len(cuts)} (top)", current, mm=mm)
    parts.append(current)

    manifest = []
    for i, p in enumerate(parts):
        h = health(p)
        out = os.path.join(a.outdir, f"part{i}.blend")
        select_only(p)
        bpy.ops.wm.save_as_mainfile(filepath=out)
        manifest.append({
            "part": i, "file": os.path.basename(out), "faces": h["faces"],
            "watertight": is_watertight(h), "components": h["components"],
            "dims_mm": [round(d / mm, 1) for d in h["dims"]],
        })
        if not is_watertight(h):
            print(f"WARNING: part{i} is not watertight after the cut")
        if h["components"] > 1:
            # The survey only looks at the cut plane. A cape hem or a trailing
            # sash can hang down past the cut while attaching to the body well
            # above it, so it arrives in the lower part as its own free piece.
            print(f"NOTE: part{i} contains {h['components']} separate pieces "
                  f"(sizes {h['largest_comps']}). They are each watertight, so "
                  f"they print fine, but you will be gluing them. If that is "
                  f"not what you want, cut elsewhere or keep the figure whole.")
    json.dump(manifest, open(os.path.join(a.outdir, "parts.json"), "w"),
              indent=2)
    print(f"\nwrote {len(parts)} parts + parts.json to {a.outdir}")
    print(f"pin: r={a.pin_radius_mm} mm len={a.pin_length_mm} mm "
          f"clearance={a.clearance_mm} mm")


# ------------------------------------------------------------------ export --

def cmd_export(a):
    """Write the deliverables at true millimetre scale, sitting on z=0.

    A lite copy is produced alongside the detailed one because slicers choke on
    a few million triangles, and because the lite mesh is what the rig stage
    wants. Both are gated on watertightness independently: a remesh that closes
    at one density can open at another.
    """
    height = a.height_mm
    os.makedirs(a.outdir, exist_ok=True)
    obj = open_figure(a.input)
    weld(obj)
    h = health(obj)
    if not is_watertight(h) and not a.force:
        raise SystemExit("input is not watertight; refusing to export "
                         "(pass --force only if you know why)")

    exports = []
    lite = None
    if a.lite_voxel:
        lite = obj.copy()
        lite.data = obj.data.copy()
        lite.name = "Lite"
        bpy.context.scene.collection.objects.link(lite)
        voxel_remesh(lite, a.lite_voxel)
        lite, _ = keep_largest_component(lite, "Lite")
        lh = check("lite", lite, height)
        if not is_watertight(lh):
            print("lite copy is not watertight; skipping it")
            bpy.data.objects.remove(lite, do_unlink=True)
            lite = None

    for o, suffix in ((obj, ""), (lite, "_lite")):
        if o is None:
            continue
        to_millimetres(o, height)
        for fmt in a.formats:
            path = os.path.join(a.outdir, f"{a.name}{suffix}.{fmt}")
            export_mesh_file(o, path)
            hh = health(o)
            exports.append({
                "file": os.path.basename(path), "faces": hh["faces"],
                "dims_mm": [round(d, 1) for d in o.dimensions],
                "watertight": is_watertight(hh),
                "bytes": os.path.getsize(path),
            })

    json.dump(exports, open(os.path.join(a.outdir, f"{a.name}_exports.json"),
                            "w"), indent=2)
    print(f"\n{len(exports)} files in {a.outdir}")
    for e in exports:
        print(f"  {e['file']:40s} {e['faces']:>9} faces  {e['dims_mm']} mm  "
              f"watertight={e['watertight']}")


def floats(s):
    return [float(x) for x in s.split(",")]


def main():
    p = argparse.ArgumentParser(prog="printprep.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gate")
    g.add_argument("input")
    g.add_argument("--preset", choices=list(PRESETS), default="display")
    g.add_argument("--height-mm", type=float, default=None)
    g.add_argument("--min-mm", type=float, default=None)
    g.add_argument("--max-dim-mm", type=float, default=0.0,
                   help="build volume limit; 0 disables the check")
    g.add_argument("--samples", type=int, default=6000)
    g.set_defaults(fn=cmd_gate)

    sv = sub.add_parser("survey")
    sv.add_argument("input")
    sv.add_argument("--height-mm", type=float, required=True)
    sv.add_argument("--lo", type=float, default=0.15)
    sv.add_argument("--hi", type=float, default=0.85)
    sv.add_argument("--steps", type=int, default=28)
    sv.add_argument("--min-width-mm", type=float, default=8.0)
    sv.set_defaults(fn=cmd_survey)

    s = sub.add_parser("split")
    s.add_argument("input")
    s.add_argument("outdir")
    s.add_argument("--height-mm", type=float, required=True)
    s.add_argument("--at-frac", type=floats, default=None,
                   help="cut heights as fractions of the figure, e.g. 0.55")
    s.add_argument("--at-mm", type=floats, default=None,
                   help="cut heights in mm from the base")
    s.add_argument("--pin-radius-mm", type=float, default=2.0)
    s.add_argument("--pin-length-mm", type=float, default=4.0)
    s.add_argument("--clearance-mm", type=float, default=0.2)
    s.add_argument("--force", action="store_true",
                   help="cut anyway when the plane crosses several pieces")
    s.set_defaults(fn=cmd_split)

    e = sub.add_parser("export")
    e.add_argument("input")
    e.add_argument("outdir")
    e.add_argument("--name", required=True)
    e.add_argument("--height-mm", type=float, required=True)
    e.add_argument("--formats", type=lambda s: s.split(","),
                   default=["3mf", "stl"])
    e.add_argument("--lite-voxel", type=float, default=0.0)
    e.add_argument("--force", action="store_true")
    e.set_defaults(fn=cmd_export)

    a = p.parse_args(argv())
    a.fn(a)


if __name__ == "__main__":
    main()
