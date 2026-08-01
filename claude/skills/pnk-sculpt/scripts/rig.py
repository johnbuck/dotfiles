"""Rigging and posing.

    blender --background --factory-startup --python rig.py -- <command> [opts]

Two branches leave this stage and they want opposite things from the mesh.

    print branch:  metarig -> generate -> pose -> bake  -> back to printprep
    asset branch:  metarig -> generate -> pose -> export (armature kept)

For printing, the rig is scaffolding. Pose the figure, apply the deformation,
throw the armature away and re-close the result to a watertight solid. Topology
does not matter because nothing will ever deform it again.

For a game asset, the rig is the deliverable. Face count must stay low, UVs and
materials must survive, and the armature ships with the file. Watertightness
stops mattering entirely.

An honest warning before you start. Automatic weights on a voxel-remeshed
figure are unreliable: a voxel mesh has no edge loops at the joints, so weights
bleed across them and an elbow bends the ribcage with it. Rig the LITE mesh
(200k faces or fewer, ideally 50k), check the bend, and expect to fix weights by
hand for anything beyond a modest pose. This is the least automatable stage in
the pipeline and the one most likely to need the GUI.

Commands
    metarig   <in.blend> <out.blend>   fit a Rigify human metarig to the mesh
    generate  <in.blend> <out.blend>   build the control rig, bind the mesh
    pose      <in.blend> <out.blend>   apply bone rotations from JSON
    bake      <in.blend> <out.blend>   apply the pose, drop the rig, re-close
    export    <in.blend> <out>         rigged GLB/FBX for the asset branch
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
    add_modifier_apply, append_object, argv, check, clear, health,
    is_watertight, keep_largest_component, load_one, mm_per_unit, save,
    select_only, slice_profile, voxel_remesh, weld, world_verts,
)


RIG_FACE_WARN = 250_000


def ensure_rigify():
    try:
        bpy.ops.preferences.addon_enable(module="rigify")
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"could not enable Rigify: {e}")


def the_mesh(name="Figure"):
    ms = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not ms:
        raise SystemExit("no mesh in the file")
    for m in ms:
        if m.name == name:
            return m
    return ms[0]


def the_armature():
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            return o
    raise SystemExit("no armature in the file")


# ----------------------------------------------------------------- metarig --

def measure_landmarks(obj):
    """Derive skeletal heights and widths from the mesh itself.

    Everything here comes from the silhouette of a standing humanoid: the neck
    and waist are local minima in width, the hip is where the width jumps as
    the legs merge into the pelvis, and the arms are the lateral extremities.
    These are estimates. They give the metarig a sane starting shape so a human
    has small corrections to make rather than a whole skeleton to place.
    """
    vs = world_verts(obj)
    zlo = min(v.z for v in vs)
    zhi = max(v.z for v in vs)
    H = zhi - zlo
    prof, plo, phi, PH = slice_profile(obj, 60)
    bands = [p for p in prof if p]

    def width_at(f):
        z = plo + f * PH
        near = min(bands, key=lambda p: abs(p[0] - z))
        return near[1]

    def narrowest_between(f0, f1):
        c = [p for p in bands if f0 <= (p[0] - plo) / PH <= f1]
        if not c:
            return plo + (f0 + f1) / 2 * PH
        return min(c, key=lambda p: p[1] + p[2])[0]

    neck_z = narrowest_between(0.78, 0.92)
    waist_z = narrowest_between(0.52, 0.66)

    # The hip is where width stops growing downward from the waist: below it
    # the two legs separate again.
    hip_z = zlo + H * 0.47
    below = [p for p in bands if 0.38 <= (p[0] - plo) / PH <= 0.56]
    if below:
        hip_z = max(below, key=lambda p: p[1])[0]

    lat = max(v.x for v in vs) - min(v.x for v in vs)
    cx = (max(v.x for v in vs) + min(v.x for v in vs)) / 2
    shoulder_z = zlo + H * 0.82
    shoulder_half = width_at(0.80) * 0.42
    hip_half = width_at((hip_z - plo) / PH) * 0.25

    lm = {
        "z_floor": zlo, "z_top": zhi, "height": H, "centre_x": cx,
        "z_ankle": zlo + H * 0.055,
        "z_knee": zlo + H * 0.28,
        "z_hip": hip_z,
        "z_waist": waist_z,
        "z_chest": zlo + H * 0.72,
        "z_shoulder": shoulder_z,
        "z_neck": neck_z,
        "z_head_top": zhi,
        "shoulder_half": shoulder_half,
        "hip_half": hip_half,
        "arm_reach": lat * 0.5,
        "z_elbow": zlo + H * 0.62,
        "z_wrist": zlo + H * 0.50,
    }
    print("measured landmarks (Blender units):")
    for k, v in lm.items():
        print(f"  {k:14s} {v: .4f}")
    return lm


def cmd_metarig(a):
    ensure_rigify()
    clear()
    obj = append_object(a.input, prefer="Figure", newname="Figure") \
        if a.input.endswith(".blend") else load_one(a.input, "Figure")
    n = len(obj.data.polygons)
    if n > RIG_FACE_WARN:
        print(f"WARNING: {n} faces. Rig the lite mesh instead; automatic "
              f"weights on a mesh this dense are slow and produce weights that "
              f"bleed across joints.")
    lm = measure_landmarks(obj)

    bpy.ops.object.armature_human_metarig_add()
    meta = bpy.context.view_layer.objects.active
    meta.name = "metarig"

    # Rigify's metarig ships at roughly 1.85 units tall in a T-pose. Scale it to
    # the figure first so per-bone nudges are small.
    scale = lm["height"] / meta.dimensions.z
    meta.scale = (scale, scale, scale)
    meta.location = (lm["centre_x"], 0.0, lm["z_floor"])
    select_only(meta)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    print(f"metarig scaled by {scale:.4f} and placed on the floor plane")

    if a.snap:
        snap_metarig(meta, lm)

    save(a.output)
    print("\nNEXT: render this and look at it before generating. "
          "`mesh.py render` will not show bones, so open it in the GUI, or "
          "trust the printed bone heights below and correct in the GUI.\n"
          "Bone placement is the one part of this pipeline that a machine "
          "cannot verify for you: a slightly wrong knee still generates a rig, "
          "it just deforms badly when posed.")


def snap_metarig(meta, lm):
    """Move the main chain to the measured heights.

    Only the bones whose position is derivable from a silhouette are touched.
    Fingers, toes, face bones and the shoulder roll are left where Rigify put
    them, because guessing them from a voxel mesh is worse than the default.
    """
    bpy.context.view_layer.objects.active = meta
    bpy.ops.object.mode_set(mode="EDIT")
    eb = meta.data.edit_bones

    def set_z(name, head_z=None, tail_z=None):
        b = eb.get(name)
        if not b:
            print(f"  (no bone {name})")
            return
        if head_z is not None:
            b.head.z = head_z
        if tail_z is not None:
            b.tail.z = tail_z

    set_z("spine", head_z=lm["z_hip"], tail_z=lm["z_waist"])
    set_z("spine.001", head_z=lm["z_waist"], tail_z=lm["z_chest"])
    set_z("spine.002", head_z=lm["z_chest"], tail_z=lm["z_shoulder"])
    set_z("spine.003", head_z=lm["z_shoulder"], tail_z=lm["z_neck"])
    set_z("spine.004", head_z=lm["z_neck"],
          tail_z=lm["z_neck"] + (lm["z_head_top"] - lm["z_neck"]) * 0.25)
    set_z("spine.006", tail_z=lm["z_head_top"])

    for side, sgn in (("L", 1.0), ("R", -1.0)):
        for name, hz, tz in (
            ("thigh." + side, lm["z_hip"], lm["z_knee"]),
            ("shin." + side, lm["z_knee"], lm["z_ankle"]),
            ("upper_arm." + side, lm["z_shoulder"], lm["z_elbow"]),
            ("forearm." + side, lm["z_elbow"], lm["z_wrist"]),
        ):
            set_z(name, head_z=hz, tail_z=tz)
        b = eb.get("thigh." + side)
        if b:
            b.head.x = lm["centre_x"] + sgn * lm["hip_half"]
        b = eb.get("upper_arm." + side)
        if b:
            b.head.x = lm["centre_x"] + sgn * lm["shoulder_half"]

    bpy.ops.object.mode_set(mode="OBJECT")
    print("snapped the main chain to measured heights; fingers, toes and face "
          "bones left at Rigify's defaults")


# ---------------------------------------------------------------- generate --

def cmd_generate(a):
    ensure_rigify()
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    meta = the_armature()
    obj = the_mesh()

    if a.decimate and len(obj.data.polygons) > a.decimate:
        cur = len(obj.data.polygons)
        print(f">> decimating {cur} -> {a.decimate} for rigging", flush=True)
        add_modifier_apply(obj, "DECIMATE", ratio=a.decimate / cur)

    bpy.context.view_layer.objects.active = meta
    bpy.ops.pose.rigify_generate()
    rig = bpy.context.view_layer.objects.active
    print(f"generated control rig: {rig.name}")

    # Automatic weights. On organic voxel topology this is a starting point, not
    # an answer: look at a bent elbow before trusting it.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    print("bound the mesh with automatic weights")

    meta.hide_set(True)
    save(a.output)
    print("\nNEXT: `pose`. Verify one strong bend before committing to a full "
          "pose; weight problems are far cheaper to find now.")


# -------------------------------------------------------------------- pose --

def cmd_pose(a):
    """Apply bone rotations from JSON.

    JSON is {"bone_name": [rx, ry, rz]} in degrees, XYZ Euler, in the bone's own
    space. Keeping poses as data rather than GUI state means a pose is
    reviewable, diffable and reusable on the next character.
    """
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    rig = the_armature()
    pose = json.load(open(a.pose))

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    missing = []
    for name, rot in pose.items():
        pb = rig.pose.bones.get(name)
        if pb is None:
            missing.append(name)
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = tuple(math.radians(x) for x in rot)
    bpy.ops.object.mode_set(mode="OBJECT")
    if missing:
        print(f"WARNING: no such bones: {missing}")
        print("Rigify control bones are usually named like upper_arm_fk.L or "
              "hand_ik.L; list them with --list.")
    save(a.output)


def cmd_list(a):
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    rig = the_armature()
    names = sorted(b.name for b in rig.pose.bones)
    print(f"{len(names)} pose bones in {rig.name}:")
    for n in names:
        print(f"  {n}")


# -------------------------------------------------------------------- bake --

def cmd_bake(a):
    """Freeze the pose into the mesh and return a printable solid.

    Applying an armature modifier stretches geometry at the joints, which
    reliably self-intersects on the inside of a strong bend. Self-intersection
    is invisible in a render and fatal to a slicer, so the pose is always
    re-closed with a voxel remesh afterwards. That is also why posing before
    printing costs surface detail: the remesh resamples everything.
    """
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    obj = the_mesh()
    height = a.height_mm

    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=m.name)
            print(f"applied {m.name}")

    for o in list(bpy.context.scene.objects):
        if o.type == "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)

    select_only(obj)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    weld(obj)
    check("posed, before re-close", obj, height)

    print(f">> re-closing at voxel {a.voxel}", flush=True)
    voxel_remesh(obj, a.voxel)
    obj, dropped = keep_largest_component(obj, "Figure")
    print(f"   dropped {dropped} floating faces", flush=True)
    if a.smooth:
        add_modifier_apply(obj, "SMOOTH", iterations=a.smooth, factor=0.5)
    h = check("BAKED", obj, height)
    save(a.output)
    if not is_watertight(h):
        print("WARNING: re-close failed. A deep self-intersection can survive "
              "one remesh; try a slightly coarser voxel, or reduce the pose.")
        sys.exit(2)
    print("\nNEXT: printprep gate, then export.")


# ------------------------------------------------------------------ export --

def cmd_export(a):
    """Export the rigged asset with the armature and materials intact."""
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    obj = the_mesh()
    rig = the_armature()
    n = len(obj.data.polygons)
    if n > a.max_faces:
        print(f"WARNING: {n} faces is heavy for a rigged asset "
              f"(budget was {a.max_faces}). Decimate before exporting, or "
              f"accept it if this is a cinematic asset rather than a game one.")
    if not obj.data.uv_layers:
        print("WARNING: no UV map. The mesh will export untextured. UVs are "
              "lost by voxel remeshing, so the asset branch should start from "
              "the textured reconstruction, not the print mesh.")

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    ext = os.path.splitext(a.output)[1].lower()
    if ext == ".glb":
        bpy.ops.export_scene.gltf(filepath=a.output, use_selection=True,
                                  export_format="GLB", export_skins=True,
                                  export_animations=False)
    elif ext == ".fbx":
        bpy.ops.export_scene.fbx(filepath=a.output, use_selection=True,
                                 add_leaf_bones=False,
                                 bake_anim=False)
    else:
        raise SystemExit("use .glb or .fbx for a rigged asset")
    print(f"exported {a.output}  {os.path.getsize(a.output) / 1e6:.1f} MB")


def main():
    p = argparse.ArgumentParser(prog="rig.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("metarig")
    m.add_argument("input")
    m.add_argument("output")
    m.add_argument("--snap", action="store_true", default=True,
                   help="move the main bone chain to measured heights")
    m.add_argument("--no-snap", dest="snap", action="store_false")
    m.set_defaults(fn=cmd_metarig)

    g = sub.add_parser("generate")
    g.add_argument("input")
    g.add_argument("output")
    g.add_argument("--decimate", type=int, default=150_000,
                   help="face budget before binding; 0 disables")
    g.set_defaults(fn=cmd_generate)

    po = sub.add_parser("pose")
    po.add_argument("input")
    po.add_argument("output")
    po.add_argument("--pose", required=True, help="JSON of bone -> [rx,ry,rz]")
    po.set_defaults(fn=cmd_pose)

    ls = sub.add_parser("list")
    ls.add_argument("input")
    ls.set_defaults(fn=cmd_list)

    b = sub.add_parser("bake")
    b.add_argument("input")
    b.add_argument("output")
    b.add_argument("--height-mm", type=float, default=200.0)
    b.add_argument("--voxel", type=float, required=True,
                   help="use the figure's fuse voxel or slightly coarser")
    b.add_argument("--smooth", type=int, default=1)
    b.set_defaults(fn=cmd_bake)

    e = sub.add_parser("export")
    e.add_argument("input")
    e.add_argument("output")
    e.add_argument("--max-faces", type=int, default=200_000)
    e.set_defaults(fn=cmd_export)

    a = p.parse_args(argv())
    a.fn(a)


if __name__ == "__main__":
    main()
