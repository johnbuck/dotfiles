"""Build hard-surface props parametrically instead of reconstructing them.

    blender --background --factory-startup --python prop.py -- <command> [opts]

Anything long, thin and regular (a bow, a spear, a staff, a chain, a strap) is
better modelled from a curve than reconstructed from an image. Reconstruction
resolves volume, and a 2 mm bowstring across a 1.4 m span is below what any
voxel grid will hold: it comes out as a broken dotted line or vanishes. A swept
curve gives an exact length, an exact thickness you can hold above the print's
minimum feature size, and a clean watertight solid.

Curve caps in Blender leave open edges, so every prop is closed with a fine
voxel remesh rather than trusting the cap. The remesh is fine here because a
prop is small; the same voxel size would be ruinously slow on a whole figure.

Commands
    sweep  <out.blend>   swept solid through a point list
    peg    <in> <out>    add a locating peg for a socket
    info   <in>          length, thickness and health
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
    argv, boolean, check, clear, is_watertight, keep_largest_component,
    load_one, save, select_only, voxel_remesh, world_verts,
)


def curve_solid(points, radius, name, resolution=24, taper=None):
    """A poly curve swept by a circular profile, converted to a mesh.

    `taper` is an optional list of radius multipliers, one per point, so a bow
    limb can thin toward its tips or a spear shaft can swell at the grip.
    """
    cd = bpy.data.curves.new(name, "CURVE")
    cd.dimensions = "3D"
    cd.resolution_u = 12
    cd.bevel_depth = radius
    cd.bevel_resolution = resolution // 4
    cd.use_fill_caps = True
    sp = cd.splines.new("NURBS")
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        if taper:
            sp.points[i].radius = taper[i]
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(points))
    obj = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(obj)
    select_only(obj)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def cmd_sweep(a):
    clear()
    spec = json.load(open(a.spec)) if a.spec else None
    if spec:
        parts = spec["parts"]
        target_len = spec.get("length_mm")
    else:
        parts = [{"points": [list(map(float, p.split(",")))
                             for p in a.points],
                  "radius_mm": a.radius_mm}]
        target_len = a.length_mm

    # Build in millimetres, then scale to the figure's unit system at the end.
    objs = []
    for i, part in enumerate(parts):
        pts = [Vector(p) for p in part["points"]]
        r = part["radius_mm"]
        o = curve_solid(pts, r, part.get("name", f"part{i}"),
                        taper=part.get("taper"))
        objs.append(o)

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = a.name

    dims = obj.dimensions
    span = max(dims)
    if target_len:
        k = target_len / span
        obj.scale = (k, k, k)
        select_only(obj)
        bpy.ops.object.transform_apply(scale=True)
        span = max(obj.dimensions)
    print(f"built {a.name}: longest span {span:.2f} mm, bbox "
          f"{tuple(round(d, 2) for d in obj.dimensions)}")

    # Close it. Curve caps leave open boundary edges that no slicer will accept.
    voxel = a.voxel_mm if a.voxel_mm else span / 900.0
    print(f">> closing with a voxel remesh at {voxel:.4f} mm", flush=True)
    voxel_remesh(obj, voxel)
    obj, dropped = keep_largest_component(obj, a.name)
    if dropped:
        print(f"   dropped {dropped} floating faces; if that number is large, "
              f"your parts are not actually touching")
    h = check(a.name, obj)
    save(a.output)
    if not is_watertight(h):
        print("WARNING: prop is not watertight; try a finer --voxel-mm")
        sys.exit(2)


def cmd_peg(a):
    """Add a cylindrical peg so the prop keys into a socket on the figure.

    Make the peg a little under the socket so it actually goes in: printers
    over-extrude and resin swells. 0.15 to 0.25 mm of diametral clearance is a
    reasonable starting point, which is what --clearance-mm subtracts.
    """
    clear()
    obj = load_one(a.input, "Prop")
    at = Vector(a.at)
    r = a.radius_mm - a.clearance_mm / 2
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48, radius=r, depth=a.length_mm, location=at)
    peg = bpy.context.view_layer.objects.active
    peg.rotation_euler = tuple(math.radians(x) for x in a.tilt)
    select_only(peg)
    bpy.ops.object.transform_apply(rotation=True)
    boolean(obj, peg, "UNION")
    voxel = a.voxel_mm if a.voxel_mm else max(obj.dimensions) / 900.0
    voxel_remesh(obj, voxel)
    obj, _ = keep_largest_component(obj, "Prop")
    h = check("pegged", obj)
    save(a.output)
    if not is_watertight(h):
        sys.exit(2)


def cmd_info(a):
    clear()
    obj = load_one(a.input, "Prop")
    vs = world_verts(obj)
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs),
                 min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs),
                 max(v.z for v in vs)))
    print(f"bbox {tuple(round(c, 3) for c in lo)} .. "
          f"{tuple(round(c, 3) for c in hi)}")
    print(f"dims {tuple(round(d, 3) for d in (hi - lo))}")
    check("prop", obj)
    from sculptlib import min_wall_thickness
    t = min_wall_thickness(obj, samples=2000)
    if t:
        print(f"thinnest 1% of walls: {t['p01']:.3f} (same units as the mesh)")


def floats(s):
    return tuple(float(x) for x in s.split(","))


def main():
    p = argparse.ArgumentParser(prog="prop.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    s1 = sub.add_parser("sweep")
    s1.add_argument("output")
    s1.add_argument("--name", default="Prop")
    s1.add_argument("--spec", default=None,
                    help="JSON: {length_mm, parts:[{name,points,radius_mm,taper}]}")
    s1.add_argument("--points", nargs="*", default=[],
                    help="x,y,z triples when not using --spec")
    s1.add_argument("--radius-mm", type=float, default=2.0)
    s1.add_argument("--length-mm", type=float, default=0.0,
                    help="scale so the longest span equals this")
    s1.add_argument("--voxel-mm", type=float, default=0.0)
    s1.set_defaults(fn=cmd_sweep)

    s2 = sub.add_parser("peg")
    s2.add_argument("input")
    s2.add_argument("output")
    s2.add_argument("--at", type=floats, required=True)
    s2.add_argument("--radius-mm", type=float, required=True,
                    help="the socket's radius; clearance is subtracted")
    s2.add_argument("--length-mm", type=float, required=True)
    s2.add_argument("--clearance-mm", type=float, default=0.2)
    s2.add_argument("--tilt", type=floats, default=(0, 0, 0))
    s2.add_argument("--voxel-mm", type=float, default=0.0)
    s2.set_defaults(fn=cmd_peg)

    s3 = sub.add_parser("info")
    s3.add_argument("input")
    s3.set_defaults(fn=cmd_info)

    a = p.parse_args(argv())
    a.fn(a)


if __name__ == "__main__":
    main()
