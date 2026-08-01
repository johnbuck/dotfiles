"""Mesh inspection, cleanup and QA rendering for pnk-sculpt.

Run headless, always:

    blender --background --factory-startup --python mesh.py -- <command> [opts]

Headless matters. These operations take minutes on a multi-million-face mesh and
would time out the interactive Blender MCP socket, leaving you unsure whether the
job died or is still working.

Commands
    analyze    <in>                       topology + surface health
    clean      <in> <out.blend>           weld, subdivide, voxel remesh to watertight
    landmarks  <in>                       height profile, neck, extremities
    thickness  <in>                       thinnest-wall estimate in mm
    reshape    <in> <out.blend>           piecewise proportion fix
    render     <in> <prefix>              multi-angle clay turntable
    closeup    <in> <prefix>              tight shots around a point
    ortho      <in> <tag>                 measurable orthographic render + mapping
"""
import argparse
import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sculptlib import (  # noqa: E402
    ANGLE_TAGS, add_modifier_apply, argv, check, clear, decimate_safely,
    find_crotch,
    health, is_watertight, join_all, keep_largest_component, load, load_one,
    mm_per_unit, min_wall_thickness, report, save, select_only, setup_studio,
    slice_profile, subdivide, voxel_remesh, weld, world_verts,
)


def out_dir(path, sub="renders"):
    d = os.path.join(os.path.dirname(os.path.abspath(path)), sub)
    os.makedirs(d, exist_ok=True)
    return d


# ----------------------------------------------------------------- analyze --

def cmd_analyze(a):
    clear()
    obj = load_one(a.input)
    report(os.path.basename(a.input), obj)


# ------------------------------------------------------------------- clean --

def cmd_clean(a):
    """Turn a raw reconstruction into a watertight single shell.

    The order is deliberate. Weld first so the topology numbers are real.
    Subdivide before remeshing because a fine voxel grid sampling coarse source
    triangles reproduces their facets as noise. Remesh to close the surface.
    Keep only the largest component to drop the floating islands every
    reconstruction produces. Smooth lightly. Decimate last, and only if it
    survives the watertight check.
    """
    t0 = time.time()
    clear()
    objs = load(a.input)
    obj = join_all(objs, "Figure")
    print(f"welded {weld(obj)} duplicate seam vertices", flush=True)
    check("imported", obj, a.height_mm)

    if a.subdiv:
        print(f">> subdividing {a.subdiv} level(s) to remove source faceting",
              flush=True)
        subdivide(obj, a.subdiv)
        print(f"   now {len(obj.data.polygons)} faces", flush=True)

    print(f">> voxel remesh at {a.voxel} ...", flush=True)
    voxel_remesh(obj, a.voxel)
    print(f"   remesh took {time.time() - t0:.0f}s", flush=True)
    check("after voxel remesh", obj, a.height_mm)

    obj, dropped = keep_largest_component(obj, "Figure")
    print(f">> dropped {dropped} faces of floating islands", flush=True)

    if a.smooth:
        add_modifier_apply(obj, "SMOOTH", iterations=a.smooth, factor=0.5)

    if a.decimate:
        decimate_safely(obj, a.decimate)

    h = check("FINAL", obj, a.height_mm)
    save(a.output)
    print(f"total {time.time() - t0:.0f}s", flush=True)
    if not is_watertight(h):
        print("WARNING: not watertight. Try a coarser voxel, or a source mesh "
              "with fewer floaters (see pnk-sculpt-reconstruct).", flush=True)
        sys.exit(2)


# --------------------------------------------------------------- landmarks --

def cmd_landmarks(a):
    """Report where things are, so later stages can stop guessing coordinates.

    Every hand-typed coordinate in this pipeline has been wrong at least once.
    Measure, then act on the measurement.
    """
    clear()
    obj = load_one(a.input)
    vs = world_verts(obj)
    lo = (min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))
    hi = (max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))
    H = hi[2] - lo[2]
    mm = mm_per_unit(obj, a.height_mm) if a.height_mm else None
    print(f"bbox lo={tuple(round(c, 4) for c in lo)} "
          f"hi={tuple(round(c, 4) for c in hi)}")
    print(f"height = {H:.4f} units" + (f" = {H / mm:.1f} mm" if mm else ""))

    prof, plo, phi, PH = slice_profile(obj, a.bands)
    print(f"\n--- width profile ({a.bands} bands) ---")
    print("  frac   z        x_width  y_width  n")
    for p in prof:
        if not p:
            continue
        z, xw, yw, n = p
        print(f"  {(z - plo) / PH:.2f}   {z: .4f}  {xw:.4f}   {yw:.4f}   {n}")

    # The neck is the narrowest band in the upper fifth of a standing humanoid.
    from sculptlib import find_narrowest, band_centre
    try:
        neck, _, _, _ = find_narrowest(obj, a.neck_lo, a.neck_hi)
        cx, cy = band_centre(obj, neck[1], PH * 0.02)
        print(f"\nneck: z={neck[1]:.4f} frac={neck[4]:.2f} "
              f"xw={neck[2]:.4f} yw={neck[3]:.4f} centre=({cx:.4f}, {cy:.4f})")
        above = sum(1 for v in vs if v.z > neck[1])
        print(f"  verts above the neck plane: {above}")
        # Anything above the neck but far from its axis is not the head:
        # backpack, quiver arrows, a raised weapon. Report the split so a head
        # graft can cut by cylinder rather than by plane and keep them.
        far = [v for v in vs if v.z > neck[1]
               and ((v.x - cx) ** 2 + (v.y - cy) ** 2) ** 0.5 > a.head_radius]
        if far:
            print(f"  {len(far)} verts above the neck lie beyond r="
                  f"{a.head_radius} of its axis: NOT part of the head")
            print(f"    x {min(v.x for v in far):.4f}..{max(v.x for v in far):.4f}"
                  f"  y {min(v.y for v in far):.4f}..{max(v.y for v in far):.4f}"
                  f"  z {min(v.z for v in far):.4f}..{max(v.z for v in far):.4f}")
        head_h = hi[2] - neck[1]
        print(f"  head height above neck = {head_h:.4f} "
              f"-> figure is {H / head_h:.1f} heads tall "
              f"(stylized heroic is 7 to 8)")
    except SystemExit as e:
        print(f"neck detection failed: {e}")

    # Heads-tall on its own is misleading, and this is worth knowing before you
    # trust it: a reconstruction that reads obviously stocky can still measure
    # 8.6 heads, because a small head and short legs cancel out in that ratio.
    # Leg fraction is what "short and wide" actually means, so report both.
    crotch = find_crotch(obj, lo[2], hi[2])
    if crotch is not None:
        leg_frac = (crotch - lo[2]) / H
        print(f"\ncrotch z={crotch:.4f} -> legs are {leg_frac * 100:.1f}% of "
              f"height (a heroic figure is about 47 to 52%)")
        if leg_frac < 0.44:
            print("  SHORT LEGS. Run `reshape` before grafting or socketing, "
                  "and re-measure afterwards.")
        print(f"  suggested reshape: --ankle {lo[2] + H * 0.10:.4f} "
              f"--hip {crotch:.4f} --legs "
              f"{min(1.45, 0.485 / max(leg_frac, 0.2)):.2f}")
    else:
        print("\ncrotch not found (a tabard or robe between the legs defeats "
              "the scan); pick --ankle and --hip off the width profile")

    # Extremities, for finding a hand that should hold a prop.
    xr = hi[0] - lo[0]
    for label, sel in (("min-x extremity (their right / viewer left)",
                        lambda v: v.x < lo[0] + a.extremity_frac * xr),
                       ("max-x extremity (their left / viewer right)",
                        lambda v: v.x > hi[0] - a.extremity_frac * xr)):
        g = [v for v in vs if sel(v)]
        if not g:
            continue
        glo = (min(v.x for v in g), min(v.y for v in g), min(v.z for v in g))
        ghi = (max(v.x for v in g), max(v.y for v in g), max(v.z for v in g))
        ctr = tuple((glo[i] + ghi[i]) * 0.5 for i in range(3))
        print(f"\n{label}: n={len(g)}")
        print(f"  bbox {tuple(round(c, 4) for c in glo)} .. "
              f"{tuple(round(c, 4) for c in ghi)}")
        print(f"  centre = {tuple(round(c, 4) for c in ctr)}")


# --------------------------------------------------------------- thickness --

def cmd_thickness(a):
    if not a.height_mm:
        raise SystemExit("--height-mm is required: thickness is only "
                         "meaningful against a real print size")
    clear()
    obj = load_one(a.input)
    mm = mm_per_unit(obj, a.height_mm)
    t = min_wall_thickness(obj, samples=a.samples)
    if not t:
        raise SystemExit("could not sample thickness")
    print(f"wall thickness over {t['samples']} samples, at {a.height_mm} mm tall:")
    for k in ("min", "p01", "p05", "median"):
        print(f"  {k:7s} {t[k] / mm:7.3f} mm")
    limit = a.min_mm
    if t["p01"] / mm < limit:
        print(f"\nFAIL: the thinnest 1% is below {limit} mm and will not print "
              f"reliably. Either scale up, thicken the offending feature, or "
              f"model it as a separate part.")
        sys.exit(2)
    print(f"\nPASS: thinnest 1% clears the {limit} mm floor.")


# ----------------------------------------------------------------- reshape --

def cmd_reshape(a):
    """Piecewise-linear proportion fix.

    Reconstructions of a full figure routinely come out short and wide, around
    7 heads rather than the 8 that reads as heroic. Stretching the leg segment
    and narrowing side to side fixes both. It is done as a vertex map rather
    than a lattice or a scale so the mesh stays exactly as watertight as it
    started: no vertex is added, removed or merged.

    Feet below the ankle are left alone or they become clown shoes; everything
    above the hip is translated rigidly so the torso is not distorted.
    """
    clear()
    obj = load_one(a.input)
    h0 = check("before", obj, a.height_mm)

    lift = (a.hip - a.ankle) * (a.legs - 1.0)
    print(f"leg stretch k={a.legs} over z {a.ankle}..{a.hip} "
          f"-> adds {lift:.4f}", flush=True)
    print(f"narrow x by {a.narrow}, y by {a.narrow_y}", flush=True)

    # foreach_get/foreach_set with numpy, NOT a per-vertex loop. Iterating a
    # couple of million vertices through RNA one at a time takes longer than the
    # entire rest of the pipeline and will hit a command timeout.
    import numpy as np
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)

    z = co[:, 2]
    above = z >= a.hip
    mid = (z > a.ankle) & ~above
    nz = z.copy()
    nz[above] = z[above] + lift
    nz[mid] = a.ankle + (z[mid] - a.ankle) * a.legs
    co[:, 2] = nz
    co[:, 0] = a.axis + (co[:, 0] - a.axis) * a.narrow
    co[:, 1] = co[:, 1] * a.narrow_y

    if a.renorm:
        # Scale back to the height we started at, so every downstream constant
        # expressed in millimetres still works. Uniform scaling preserves the
        # proportions this command just fixed; it only changes overall size.
        span = float(co[:, 2].max() - co[:, 2].min())
        k = h0["dims"][2] / span
        co *= k
        print(f"renormalizing height {span:.4f} -> {h0['dims'][2]:.4f} (x{k:.4f})",
              flush=True)

    me.vertices.foreach_set("co", co.ravel())
    me.update()
    # obj.dimensions reads a cached bounding box until the depsgraph runs, so
    # without this the "after" report prints the pre-reshape numbers.
    obj.data.update_tag()
    bpy.context.view_layer.update()

    h1 = check("after", obj, a.height_mm)
    print(f"height {h0['dims'][2]:.4f} -> {h1['dims'][2]:.4f}")
    print(f"width  {h0['dims'][0]:.4f} -> {h1['dims'][0]:.4f}")
    if not is_watertight(h1):
        print("WARNING: reshape broke watertightness, which should be "
              "impossible for a pure vertex map. Check the input.")
    save(a.output)
    print("\nNOTE: any coordinate measured before this (grip, eye line, neck) "
          "has moved. Re-run `landmarks` before using them.")


# ------------------------------------------------------------------ render --

def cmd_render(a):
    clear()
    objs = load(a.input)
    if len(objs) > 1 and not a.keep_parts:
        objs = [join_all(objs, "Figure")]
    cam, tgt, ctr, H, dist = setup_studio(objs, clay=not a.textured)
    d = a.outdir or out_dir(a.input)
    scn = bpy.context.scene
    for ang in a.angles:
        r = math.radians(ang)
        cam.location = (ctr.x + dist * math.sin(r),
                        ctr.y - dist * math.cos(r), ctr.z)
        tag = ANGLE_TAGS.get(ang, f"a{ang}")
        scn.render.filepath = os.path.join(d, f"{a.prefix}_{tag}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scn.render.filepath, flush=True)


def cmd_closeup(a):
    from mathutils import Vector
    clear()
    objs = load(a.input)
    if len(objs) > 1 and not a.keep_parts:
        objs = [join_all(objs, "Figure")]
    cam, tgt, ctr, H, dist = setup_studio(objs, clay=not a.textured)
    c = Vector(a.at)
    tgt.location = c
    half_fov = math.atan((cam.data.sensor_width * 0.5) / cam.data.lens)
    d = a.radius / math.tan(half_fov)
    outd = a.outdir or out_dir(a.input)
    scn = bpy.context.scene
    for ang in a.angles:
        r = math.radians(ang)
        cam.location = (c.x + d * math.sin(r), c.y - d * math.cos(r), c.z)
        scn.render.filepath = os.path.join(outd, f"{a.prefix}_a{ang}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scn.render.filepath, flush=True)


def cmd_ortho(a):
    """Orthographic render with a printed pixel-to-world mapping.

    A perspective closeup cannot be measured: features nearer the camera shift
    outward, so every position read off one is wrong by an unknown amount.
    Orthographic removes that, so a pixel coordinate converts straight to a
    world coordinate. This is the reliable way to find a feature (an eye line,
    a socket, a seam) when you need its position, not just its appearance.
    """
    clear()
    objs = load(a.input)
    obj = join_all(objs, "Figure") if len(objs) > 1 else objs[0]
    scn = bpy.context.scene
    for o in list(scn.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)

    try:
        scn.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scn.render.engine = "CYCLES"
    scn.render.resolution_x = scn.render.resolution_y = a.res
    scn.view_settings.view_transform = "Standard"
    if scn.world is None:
        scn.world = bpy.data.worlds.new("W")
    scn.world.use_nodes = True
    scn.world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.05, 0.05, 0.06, 1)

    mat = bpy.data.materials.new("Clay")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.45, 0.44, 0.43, 1)
    b.inputs["Roughness"].default_value = 0.5
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True

    cx, cz = a.at
    cd = bpy.data.cameras.new("Cam")
    cd.type = "ORTHO"
    cd.ortho_scale = a.scale
    cam = bpy.data.objects.new("Cam", cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.location = (cx, -max(2.0, obj.dimensions.length), cz)
    cam.rotation_euler = (math.pi / 2, 0, 0)

    # Light energy is tuned to the ortho frame, not the whole figure. Framing a
    # 30 mm face with lights sized for a 200 mm body blows the render out and
    # hides the very feature you are trying to locate.
    e = a.scale * a.scale * 470
    for off, k in (((-0.25, -0.5, 0.25), 1.0), ((0.3, -0.45, 0.05), 0.5),
                   ((0.0, -0.5, -0.25), 0.25)):
        ld = bpy.data.lights.new("L", "AREA")
        ld.energy = e * k
        ld.size = a.scale * 2
        lo = bpy.data.objects.new("L", ld)
        lo.location = (cx + off[0] * a.scale / 0.16,
                       off[1] * a.scale / 0.16,
                       cz + off[2] * a.scale / 0.16)
        scn.collection.objects.link(lo)
        t = lo.constraints.new("TRACK_TO")
        t.target = obj
        t.track_axis = "TRACK_NEGATIVE_Z"
        t.up_axis = "UP_Y"

    d = a.outdir or out_dir(a.input)
    scn.render.filepath = os.path.join(d, f"{a.tag}.png")
    bpy.ops.render.render(write_still=True)
    print(f"wrote {scn.render.filepath}")
    print(f"MAPPING: world_x = {cx} + (px/{a.res} - 0.5) * {a.scale}")
    print(f"         world_z = {cz} - (py/{a.res} - 0.5) * {a.scale}")
    print(f"         x range {cx - a.scale / 2:+.4f} .. {cx + a.scale / 2:+.4f}")
    print(f"         z range {cz - a.scale / 2:+.4f} .. {cz + a.scale / 2:+.4f}")
    print("Read a feature's pixel position off the image, then convert with the "
          "mapping above. Use sheet.py --grid to overlay a labelled grid.")


# -------------------------------------------------------------------- main --

def floats(s):
    return tuple(float(x) for x in s.split(","))


def ints(s):
    return [int(x) for x in s.split(",")]


def main():
    p = argparse.ArgumentParser(prog="mesh.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--height-mm", type=float, default=None,
                        help="target print height, so sizes report in mm")
        return sp

    a1 = common(sub.add_parser("analyze"))
    a1.add_argument("input")
    a1.set_defaults(fn=cmd_analyze)

    a2 = common(sub.add_parser("clean"))
    a2.add_argument("input")
    a2.add_argument("output")
    a2.add_argument("--voxel", type=float, required=True,
                    help="voxel size in Blender units; the figure is ~1.0 tall")
    a2.add_argument("--subdiv", type=int, default=1,
                    help="Catmull-Clark levels before remeshing (1 is usually right)")
    a2.add_argument("--smooth", type=int, default=1)
    a2.add_argument("--decimate", type=int, default=0,
                    help="target face count; reverted if it breaks watertightness")
    a2.set_defaults(fn=cmd_clean)

    a3 = common(sub.add_parser("landmarks"))
    a3.add_argument("input")
    a3.add_argument("--bands", type=int, default=40)
    a3.add_argument("--neck-lo", type=float, default=0.78)
    a3.add_argument("--neck-hi", type=float, default=0.92)
    a3.add_argument("--head-radius", type=float, default=0.11)
    a3.add_argument("--extremity-frac", type=float, default=0.09)
    a3.set_defaults(fn=cmd_landmarks)

    a4 = common(sub.add_parser("thickness"))
    a4.add_argument("input")
    a4.add_argument("--min-mm", type=float, default=0.8)
    a4.add_argument("--samples", type=int, default=4000)
    a4.set_defaults(fn=cmd_thickness)

    a5 = common(sub.add_parser("reshape"))
    a5.add_argument("input")
    a5.add_argument("output")
    a5.add_argument("--legs", type=float, default=1.22,
                    help="leg stretch factor")
    a5.add_argument("--narrow", type=float, default=0.95, help="x scale")
    a5.add_argument("--narrow-y", type=float, default=1.0, help="y scale")
    a5.add_argument("--ankle", type=float, required=True,
                    help="z above the boot, below the calf (from landmarks)")
    a5.add_argument("--hip", type=float, required=True,
                    help="z where the leg meets the pelvis (from landmarks)")
    a5.add_argument("--axis", type=float, default=0.0)
    a5.add_argument("--renorm", action="store_true",
                    help="scale back to the starting height afterwards, so mm "
                         "constants downstream still hold. Usually what you want.")
    a5.set_defaults(fn=cmd_reshape)

    a6 = common(sub.add_parser("render"))
    a6.add_argument("input")
    a6.add_argument("prefix")
    a6.add_argument("--angles", type=ints, default=[0, 45, 90, 180])
    a6.add_argument("--outdir", default=None)
    a6.add_argument("--textured", action="store_true",
                    help="keep the imported materials instead of clay")
    a6.add_argument("--keep-parts", action="store_true")
    a6.set_defaults(fn=cmd_render)

    a7 = common(sub.add_parser("closeup"))
    a7.add_argument("input")
    a7.add_argument("prefix")
    a7.add_argument("--at", type=floats, required=True, help="x,y,z")
    a7.add_argument("--radius", type=float, required=True)
    a7.add_argument("--angles", type=ints, default=[0, 45])
    a7.add_argument("--outdir", default=None)
    a7.add_argument("--textured", action="store_true")
    a7.add_argument("--keep-parts", action="store_true")
    a7.set_defaults(fn=cmd_closeup)

    a8 = common(sub.add_parser("ortho"))
    a8.add_argument("input")
    a8.add_argument("tag")
    a8.add_argument("--at", type=floats, required=True, help="centre x,z")
    a8.add_argument("--scale", type=float, required=True,
                    help="frame width in Blender units")
    a8.add_argument("--res", type=int, default=1000)
    a8.add_argument("--outdir", default=None)
    a8.set_defaults(fn=cmd_ortho)

    a = p.parse_args(argv())
    a.fn(a)


if __name__ == "__main__":
    main()
