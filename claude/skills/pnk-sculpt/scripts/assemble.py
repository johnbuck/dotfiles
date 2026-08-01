"""Assembly operations: sockets, head grafts, bases, fusing, eyes.

    blender --background --factory-startup --python assemble.py -- <command> [opts]

Order matters more than any single setting here, and getting it wrong is the
most expensive mistake in the pipeline because each step takes minutes.

    socket  ->  graft  ->  base  ->  fuse  ->  eyes

Booleans go first, while the body is still a clean single shell. Exact booleans
are reliable on a tidy mesh and unreliable on a joined multi-component one: one
attempt on an 850k-face six-component mesh collapsed it to 7k faces. The head
graft, base and any remaining parts are then merged in a single voxel remesh,
which is robust where booleans are not. Eyes come last because they are a small
local boolean followed by a re-remesh at the same voxel size the figure was
fused at, so the figure's effective resolution does not change.

One rule underpins the fuse: remesh COARSER than the finest mesh going in.
Remeshing finer than a source samples that source's own triangle facets and the
result reads as surface noise. Coarser smooths.

Commands
    socket  <in.blend> <out.blend>   plug a hole, cut a mounting socket
    graft   <body> <head> <out>      scale + align a head, replace the body's
    base    <in> <out>               add a plinth
    fuse    <out> <in...>            join several parts into one solid
    eyes    <in> <out>               add eyeball spheres to a face
    findeyes <in>                    locate eye sockets from the geometry
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sculptlib import (  # noqa: E402
    add_modifier_apply, append_object, argv, band_centre, boolean, bvh_for,
    check, clear, fill_holes, find_narrowest, health, is_watertight,
    keep_largest_component, load_one, mm_per_unit, probe_surface, save,
    select_only, voxel_remesh, weld, world_verts,
)
import bmesh  # noqa: E402


def open_figure(path, name="Figure"):
    clear()
    if path.endswith(".blend"):
        obj = append_object(path, prefer="Figure", newname=name)
    else:
        obj = load_one(path, name)
    return obj


# ------------------------------------------------------------------ socket --

def cmd_socket(a):
    """Give a held prop a real mounting socket.

    Reconstructions often leave a hand as a closed fist with a shallow tube
    through it, pointing whichever way the reference happened to look. That tube
    is rarely aligned with the axis the prop needs. Filling it and cutting a
    fresh socket along a chosen axis is more reliable than trying to use it.
    """
    obj = open_figure(a.input)
    mm = mm_per_unit(obj, a.height_mm)
    check("in", obj, a.height_mm)
    at = Vector(a.at)

    if a.plug_mm:
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=32, ring_count=20, radius=a.plug_mm * mm, location=at)
        plug = bpy.context.view_layer.objects.active
        boolean(obj, plug, "UNION")
        check("plugged", obj, a.height_mm)

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=64, radius=a.radius_mm * mm, depth=a.depth_mm * mm, location=at)
    cutter = bpy.context.view_layer.objects.active
    cutter.rotation_euler = (math.radians(a.tilt[0]), math.radians(a.tilt[1]),
                             math.radians(a.tilt[2]))
    select_only(cutter)
    bpy.ops.object.transform_apply(rotation=True)
    boolean(obj, cutter, "DIFFERENCE")
    weld(obj)
    h = check("socketed", obj, a.height_mm)
    save(a.output)
    if not is_watertight(h):
        print("WARNING: the socket cut left the mesh open. A cylinder that only "
              "partly exits the surface leaves a rim; lengthen --depth-mm so it "
              "passes fully through, or reposition it.")


# ------------------------------------------------------------------- graft --

def cmd_graft(a):
    """Replace a body's head with a separately reconstructed one.

    Why this exists: in a full-body reference the head is roughly 8% of the
    frame, so after the reconstructor downsamples its conditioning image the
    face has almost no pixels left to work from. No resolution setting fixes
    that, because the bottleneck is the input. Reconstructing a bust portrait of
    the same character gives the face the whole frame, which is roughly a
    tenfold increase in facial detail.

    Alignment is measured, not typed: the neck is the narrowest horizontal band
    in the upper part of each mesh, and matching neck-to-crown distances gives
    the scale. `--head-scale` then trims that by eye, since a reconstructed bust
    usually has a slightly generous neck.
    """
    clear()
    body = append_object(a.body, prefer="Figure", newname="Body")
    check("body in", body, a.height_mm)

    b_neck, b_lo, b_hi, b_H = find_narrowest(body, a.neck_lo, a.neck_hi)
    head = append_object(a.head, prefer="Figure", newname="Head")
    h_neck, h_lo, h_hi, h_H = find_narrowest(head, a.head_neck_lo, a.head_neck_hi)

    s = ((b_hi - b_neck[1]) / (h_hi - h_neck[1])) * a.head_scale
    print(f"body neck z={b_neck[1]:.4f}  head neck z={h_neck[1]:.4f}  "
          f"scale={s:.4f}")

    h_cx, h_cy = band_centre(head, h_neck[1], h_H * 0.02)
    b_cx, b_cy = band_centre(body, b_neck[1], b_H * 0.02)
    head.scale = (s, s, s)
    head.location = (b_cx - h_cx * s + a.offset[0],
                     b_cy - h_cy * s + a.offset[1],
                     b_neck[1] - h_neck[1] * s + a.offset[2])
    if a.yaw:
        head.rotation_euler = (0, 0, math.radians(a.yaw))
    select_only(head)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Resample the head to the density it will be fused at. Scale is already
    # applied so its geometry is in final figure units and the voxel size is
    # used directly; dividing by the scale here is a bug that produces a head
    # remeshed far too fine, which then reads as noise after the fuse.
    if a.head_voxel:
        print(f">> head remesh at {a.head_voxel:.5f}", flush=True)
        voxel_remesh(head, a.head_voxel)
        head, _ = keep_largest_component(head, "Head")
        check("head resampled", head, a.height_mm)

    remove_head(body, b_neck[1], b_cx, b_cy, a.head_radius)
    fill_holes(body)
    check("body decapitated and capped", body, a.height_mm)

    save(a.output)
    print(f"\nBody and Head are both in {a.output}, aligned but not yet fused. "
          f"Add a base if you want one, then run `fuse`.")


def remove_head(obj, z, cx, cy, radius):
    """Delete the head without touching anything else above the neck.

    A flat plane cut at the neck also decapitates quiver arrows, a raised
    weapon, a backpack: anything that rises past the shoulder. Measured on a
    standing humanoid the head and ears lie within a small radius of the neck
    axis while those other features sit well beyond it, so cut by a cylinder
    around that axis instead. `mesh.py landmarks` prints the split so you can
    pick the radius from evidence.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    doomed = []
    r2 = radius * radius
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z > z and ((c.x - cx) ** 2 + (c.y - cy) ** 2) < r2:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()
    print(f"   removed {len(doomed)} head faces (r={radius})", flush=True)
    return obj


# -------------------------------------------------------------------- base --

def cmd_base(a):
    obj = open_figure(a.input)
    mm = mm_per_unit(obj, a.height_mm)
    zlo = min(v.z for v in world_verts(obj))
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=a.segments, radius=a.radius_mm * mm,
        depth=a.thickness_mm * mm,
        location=(a.centre[0], a.centre[1],
                  zlo + a.sink_mm * mm - a.thickness_mm * mm / 2))
    base = bpy.context.view_layer.objects.active
    base.name = "Base"
    if a.bevel_mm:
        add_modifier_apply(base, "BEVEL", width=a.bevel_mm * mm, segments=3)
    save(a.output)
    print("Base added as a separate object. Run `fuse` to merge it.")


# -------------------------------------------------------------------- fuse --

def cmd_fuse(a):
    """Join every part and close it into one solid with a single voxel remesh.

    Remesh rather than boolean union. Exact booleans are the better tool on
    clean two-object cases but they are unreliable on dense multi-component
    organic meshes, and here we have several at once. The remesh is
    unconditionally robust; the price is that it resamples the whole surface,
    which is why the voxel must be coarser than the finest input.
    """
    clear()
    objs = []
    for src in a.inputs:
        if src.endswith(".blend"):
            with bpy.data.libraries.load(src, link=False) as (s, d):
                d.objects = list(s.objects)
            for o in d.objects:
                if o and o.type == "MESH":
                    bpy.context.scene.collection.objects.link(o)
                    objs.append(o)
        else:
            objs.append(load_one(src, os.path.basename(src)))
    if not objs:
        raise SystemExit("nothing to fuse")
    print(f"fusing {len(objs)} parts: {[o.name for o in objs]}")

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    fig = bpy.context.view_layer.objects.active
    fig.name = "Figure"

    print(f">> fuse remesh at {a.voxel}", flush=True)
    voxel_remesh(fig, a.voxel)
    fig, dropped = keep_largest_component(fig, "Figure")
    print(f"   dropped {dropped} floating faces", flush=True)
    if a.smooth:
        add_modifier_apply(fig, "SMOOTH", iterations=a.smooth, factor=0.5)
    h = check("FUSED", fig, a.height_mm)
    save(a.output)
    if not is_watertight(h):
        print("WARNING: fuse did not close the mesh. Usually one input was "
              "already open; analyze each part separately.")
        sys.exit(2)


# -------------------------------------------------------------------- eyes --

def cmd_findeyes(a):
    """Find the eye sockets from the geometry rather than from a render.

    Casts a grid of rays at the face and builds a depth map. The sockets are the
    most recessed points of the upper face, either side of the nose bridge, so
    they appear as two local maxima in depth. Prints both an ASCII map for a
    quick sanity look and the numbers to feed straight into `eyes`.
    """
    obj = open_figure(a.input)
    bvh = bvh_for(obj)
    x0, x1 = a.x_range
    z0, z1 = a.z_range
    step = a.step
    xs = [x0 + i * step for i in range(int((x1 - x0) / step) + 1)]
    zs = [z0 + j * step for j in range(int((z1 - z0) / step) + 1)]
    from_y = -max(2.0, obj.dimensions.length)

    depth = {}
    for z in zs:
        for x in xs:
            hit, _, _, _ = bvh.ray_cast(Vector((x, from_y, z)),
                                        Vector((0, 1, 0)))
            depth[(x, z)] = hit.y if hit is not None else None

    vals = sorted(v for v in depth.values() if v is not None)
    if not vals:
        raise SystemExit("no surface found in that window; widen the ranges")
    lo = vals[0]
    # Clip to the front of the face. The far side of the skull otherwise
    # dominates the range and flattens every facial feature into one symbol.
    hi = vals[int(len(vals) * 0.55)]
    print(f"depth range {lo:.4f} .. {hi:.4f}   (larger = more recessed)")
    print("\n'.' = most forward (nose, brow), '@' = most recessed (sockets), "
          "blank = no hit.")
    ramp = ".:-=+*#%@"
    print("      " + "".join(f"{int((x - x0) / step) % 10}" for x in xs))
    for z in reversed(zs):
        row = ""
        for x in xs:
            v = depth[(x, z)]
            row += " " if v is None else ramp[
                max(0, min(8, int((v - lo) / (hi - lo) * 8.99)))]
        print(f"{z:.4f} {row}")

    print("\nz        centre_x   L_x      L_depth  R_x      R_depth  relief")
    best = None
    for z in zs:
        row = [(x, depth[(x, z)]) for x in xs if depth[(x, z)] is not None]
        if len(row) < 20:
            continue
        cx = min(row, key=lambda p: p[1])[0]   # most forward: nose or brow
        left = [p for p in row if -a.socket_far < p[0] - cx < -a.socket_near]
        right = [p for p in row if a.socket_near < p[0] - cx < a.socket_far]
        if not left or not right:
            continue
        lx, ld = max(left, key=lambda p: p[1])
        rx, rd = max(right, key=lambda p: p[1])
        cd = min(row, key=lambda p: p[1])[1]
        relief = (ld + rd) / 2 - cd
        print(f"{z:.4f}  {cx:+.4f}   {lx:+.4f}  {ld:+.4f}  "
              f"{rx:+.4f}  {rd:+.4f}  {relief:.4f}")
        if best is None or relief > best[0]:
            best = (relief, z, cx, lx, rx)

    if best:
        _, z, cx, lx, rx = best
        print(f"\nSTRONGEST SOCKET RELIEF at z={z:.4f}")
        print(f"  suggested: --at-z {z:.4f} --centre-x {cx:+.4f} "
              f"--dx {((rx - cx) + (cx - lx)) / 2:.4f}")
        print("If the relief numbers are all tiny the sockets are too shallow "
              "to detect. Fall back to `mesh.py ortho` and measure the eye line "
              "off a labelled grid.")


def cmd_eyes(a):
    """Put actual eyeball spheres in the sockets.

    Image-to-3D reliably fails to produce open eyes. It carves a shallow slit
    where the lids meet and leaves the socket flat, so the face reads as asleep
    at any magnification. Miniature sculptors solve this the same way: set a
    sphere in the socket so the eye reads as a rounded open eyeball, and let
    paint supply the iris.

    Depth is probed rather than assumed, and both eyes share one depth. Hair
    hanging over one side of the face contaminates that side's samples, and
    asymmetric eyes read as a deformity, so the socket whose samples agree more
    tightly wins and sets the depth for both.
    """
    obj = open_figure(a.input)
    mm = mm_per_unit(obj, a.height_mm)
    check("in", obj, a.height_mm)
    R = a.radius_mm * mm
    bvh = bvh_for(obj)
    from_y = -max(2.0, obj.dimensions.length)

    probe = {}
    for side, dx in (("L", -a.dx), ("R", +a.dx)):
        r = probe_surface(bvh, a.centre_x + dx, a.at_z, from_y=from_y,
                          spread=a.probe_spread)
        if r:
            probe[side] = r
            print(f"  probe {side}: median={r[0]:.4f} spread={r[1]:.4f} n={r[2]}")
    if not probe:
        raise SystemExit("no surface found at either eye position; re-check "
                         "--at-z and --centre-x with findeyes or ortho")
    best = min(probe, key=lambda k: probe[k][1])
    surf_y = probe[best][0]
    print(f"  using the {best} socket depth for both eyes: y={surf_y:.4f}")

    spheres = []
    for side, dx in (("L", -a.dx), ("R", +a.dx)):
        cy = surf_y + R - a.protrude_mm * mm
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=48, ring_count=32, radius=R,
            location=(a.centre_x + dx, cy, a.at_z))
        s = bpy.context.view_layer.objects.active
        s.name = f"Eye{side}"
        spheres.append(s)

    for s in spheres:
        boolean(obj, s, "UNION")
    weld(obj)
    check("after eye booleans", obj, a.height_mm)

    # The boolean leaves a few non-manifold edges where sphere meets lid.
    # Re-remeshing at the SAME voxel the figure was fused at restores a closed
    # solid without changing its effective resolution.
    if a.refuse_voxel:
        voxel_remesh(obj, a.refuse_voxel)
        obj, dropped = keep_largest_component(obj, "Figure")
        print(f"   dropped {dropped} faces", flush=True)
    h = check("with eyes", obj, a.height_mm)
    save(a.output)
    if not is_watertight(h):
        print("WARNING: not watertight; do not export this without a repair pass")
        sys.exit(2)


# -------------------------------------------------------------------- main --

def floats(s):
    return tuple(float(x) for x in s.split(","))


def main():
    p = argparse.ArgumentParser(prog="assemble.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--height-mm", type=float, default=200.0)
        return sp

    s1 = common(sub.add_parser("socket"))
    s1.add_argument("input")
    s1.add_argument("output")
    s1.add_argument("--at", type=floats, required=True, help="x,y,z of the hand")
    s1.add_argument("--radius-mm", type=float, required=True)
    s1.add_argument("--depth-mm", type=float, default=60.0,
                    help="make this long enough to pass fully through")
    s1.add_argument("--tilt", type=floats, default=(0, 0, 0),
                    help="rx,ry,rz degrees for the socket axis")
    s1.add_argument("--plug-mm", type=float, default=0.0,
                    help="radius of a sphere to fill an existing tube first")
    s1.set_defaults(fn=cmd_socket)

    s2 = common(sub.add_parser("graft"))
    s2.add_argument("body")
    s2.add_argument("head")
    s2.add_argument("output")
    s2.add_argument("--head-scale", type=float, default=1.0,
                    help="trim on top of the measured neck-match scale")
    s2.add_argument("--head-voxel", type=float, default=0.0,
                    help="resample the head to the fuse density; 0 skips")
    s2.add_argument("--head-radius", type=float, default=0.11,
                    help="cylinder radius around the neck axis to remove")
    s2.add_argument("--neck-lo", type=float, default=0.78)
    s2.add_argument("--neck-hi", type=float, default=0.92)
    s2.add_argument("--head-neck-lo", type=float, default=0.25)
    s2.add_argument("--head-neck-hi", type=float, default=0.75)
    s2.add_argument("--offset", type=floats, default=(0, 0, 0))
    s2.add_argument("--yaw", type=float, default=0.0)
    s2.set_defaults(fn=cmd_graft)

    s3 = common(sub.add_parser("base"))
    s3.add_argument("input")
    s3.add_argument("output")
    s3.add_argument("--radius-mm", type=float, required=True)
    s3.add_argument("--thickness-mm", type=float, default=5.0)
    s3.add_argument("--bevel-mm", type=float, default=1.2)
    s3.add_argument("--sink-mm", type=float, default=2.5,
                    help="how far the feet sink into the plinth")
    s3.add_argument("--centre", type=floats, default=(0.0, 0.0))
    s3.add_argument("--segments", type=int, default=128)
    s3.set_defaults(fn=cmd_base)

    s4 = common(sub.add_parser("fuse"))
    s4.add_argument("output")
    s4.add_argument("inputs", nargs="+")
    s4.add_argument("--voxel", type=float, required=True,
                    help="MUST be coarser than the finest input mesh")
    s4.add_argument("--smooth", type=int, default=1)
    s4.set_defaults(fn=cmd_fuse)

    s5 = common(sub.add_parser("findeyes"))
    s5.add_argument("input")
    s5.add_argument("--x-range", type=floats, required=True)
    s5.add_argument("--z-range", type=floats, required=True)
    s5.add_argument("--step", type=float, default=0.0025)
    s5.add_argument("--socket-near", type=float, default=0.012)
    s5.add_argument("--socket-far", type=float, default=0.055)
    s5.set_defaults(fn=cmd_findeyes)

    s6 = common(sub.add_parser("eyes"))
    s6.add_argument("input")
    s6.add_argument("output")
    s6.add_argument("--at-z", type=float, required=True)
    s6.add_argument("--centre-x", type=float, default=0.0)
    s6.add_argument("--dx", type=float, required=True,
                    help="half the interocular distance")
    s6.add_argument("--radius-mm", type=float, default=1.5)
    s6.add_argument("--protrude-mm", type=float, default=0.35)
    s6.add_argument("--probe-spread", type=float, default=0.004)
    s6.add_argument("--refuse-voxel", type=float, default=0.0,
                    help="re-remesh at the figure's fuse voxel to reclose it")
    s6.set_defaults(fn=cmd_eyes)

    a = p.parse_args(argv())
    a.fn(a)


if __name__ == "__main__":
    main()
