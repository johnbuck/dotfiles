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
    scene_meshes, select_only, setup_studio, slice_profile, voxel_remesh,
    weld, world_verts,
)


RIG_FACE_WARN = 250_000


def ensure_rigify():
    try:
        bpy.ops.preferences.addon_enable(module="rigify")
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"could not enable Rigify: {e}")


def the_mesh(name="Figure"):
    # scene_meshes filters out Rigify's WGT-* widget meshes, which are not in
    # the view layer and cannot be selected.
    ms = [m for m in scene_meshes("the file") if not m.name.startswith("WGT-")]
    if not ms:
        raise SystemExit("no mesh in the file")
    for m in ms:
        if m.name == name:
            return m
    return ms[0]


def the_armature(prefer_generated=True):
    """The armature to act on, preferring the GENERATED rig over the metarig.

    After `generate` the file holds both, and the metarig is merely hidden. It
    is often first in the scene, so taking the first armature found silently
    targets it. That failure is nasty because everything appears to work: the
    pose applies, the file saves, and the mesh does not move a millimetre,
    because the metarig deforms nothing.

    Rigify stamps the generated rig's armature data with a `rig_id`, which is
    the reliable way to tell them apart.
    """
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        raise SystemExit("no armature in the file")
    if prefer_generated:
        for o in arms:
            if o.data.get("rig_id"):
                return o
        for o in arms:
            if o.name == "rig" or o.name.startswith("rig"):
                return o
    for o in arms:
        if o.name != "metarig":
            return o
    return arms[0]


# ----------------------------------------------------------------- metarig --

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
    waist_f = (waist_z - plo) / PH

    # The hip sits just above the crotch, and the crotch is the one landmark on
    # a standing figure that can be found without a heuristic: it is the lowest
    # height at which the cross-section stops being two separate legs.
    #
    # Width alone does not work. The widest band below the waist is a skirt hem,
    # a cape or a boot flare far more often than it is the pelvis, and on the
    # first figure tried it put the hip at 34% of height.
    crotch_z = find_crotch(obj, zlo, zhi)
    if crotch_z is None:
        crotch_z = zlo + H * 0.44
        print("  (no clean crotch found; falling back to 44% of height)")
    hip_z = min(crotch_z + H * 0.035, waist_z - H * 0.02)

    lat = max(v.x for v in vs) - min(v.x for v in vs)
    cx = (max(v.x for v in vs) + min(v.x for v in vs)) / 2
    shoulder_z = zlo + H * 0.82
    shoulder_half = width_at(0.80) * 0.42
    hip_half = width_at((hip_z - plo) / PH) * 0.25

    # Depth. A skeleton snapped only in height sits on one flat Y plane, which
    # in a side view floats in front of or behind the body it is meant to
    # deform. Sampling the body's own mid-depth at each height fixes it.
    def y_at(z, tol=None):
        tol = tol or H * 0.02
        g = [v.y for v in vs if abs(v.z - z) < tol]
        if not g:
            return 0.0
        g.sort()
        return (g[0] + g[-1]) * 0.5

    # Limb ends, measured. Rigify's default arms point along its own T-pose and
    # end up outside the mesh entirely on any figure that is not in that pose.
    def extremity(sign, frac=0.09, zlo_f=0.0, zhi_f=1.0):
        lo_z, hi_z = zlo + H * zlo_f, zlo + H * zhi_f
        band = [v for v in vs if lo_z <= v.z <= hi_z]
        if not band:
            return None
        edge = (max(v.x for v in band) if sign > 0
                else min(v.x for v in band))
        g = [v for v in band if abs(v.x - edge) < lat * frac]
        if not g:
            return None
        return Vector((sum(v.x for v in g) / len(g),
                       sum(v.y for v in g) / len(g),
                       sum(v.z for v in g) / len(g)))

    hand_l = extremity(+1, zlo_f=0.30, zhi_f=0.85)
    hand_r = extremity(-1, zlo_f=0.30, zhi_f=0.85)
    foot_l = extremity(+1, frac=0.25, zlo_f=0.0, zhi_f=0.10)
    foot_r = extremity(-1, frac=0.25, zlo_f=0.0, zhi_f=0.10)

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
    lm["_y_at"] = y_at
    lm["_hand"] = {"L": hand_l, "R": hand_r}
    lm["_foot"] = {"L": foot_l, "R": foot_r}
    print("measured landmarks (Blender units):")
    for k, v in lm.items():
        if not k.startswith("_"):
            print(f"  {k:14s} {v: .4f}")
    for side in ("L", "R"):
        for what in ("_hand", "_foot"):
            p = lm[what][side]
            print(f"  {what[1:]}_{side:11s} "
                  f"{'not found' if p is None else tuple(round(c, 4) for c in p)}")

    # A skeleton built on an out-of-order landmark still generates a rig that
    # looks fine until it is posed, so say so loudly here rather than let it
    # through.
    order = ["z_ankle", "z_knee", "z_hip", "z_waist", "z_chest", "z_shoulder",
             "z_neck", "z_head_top"]
    bad = [(a, b) for a, b in zip(order, order[1:]) if lm[a] >= lm[b]]
    if bad:
        for a, b in bad:
            print(f"  WARNING: {a} ({lm[a]:.4f}) is not below {b} ({lm[b]:.4f})")
        print("  The silhouette heuristics have mis-read this figure. Check it "
              "in the GUI before generating, or place those bones by hand.")
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
        snap_metarig(meta, lm, bend=a.bend)

    # Stripping is right for a print and wrong for an asset, so it follows the
    # branch rather than being a blanket default. A print is one frozen pose and
    # has no use for a face rig; an animated asset does, and silently deleting
    # it would leave someone wondering where their face bones went.
    if a.branch == "print":
        strip_unfitted(meta, drop_face=not a.face,
                       drop_fingers=not a.fingers)
    else:
        print("asset branch: keeping the face and finger rigs.")
        print("  Be aware they are NOT fitted to this mesh, and fitting them "
              "would not be enough on its own. Facial deformation needs edge "
              "loops around the eyes and mouth; a voxel remesh has uniform "
              "triangles with no loops, so these bones will smear the face "
              "however well they are placed. Retopologise the head first.")
        print("  Pass --branch print to strip them instead.")

    save(a.output)
    print("\nNEXT: look at it before generating, with\n"
          f"  rig.py -- preview {a.output} bones\n"
          "A wrong bone still generates a perfectly valid rig; it only shows "
          "up as bad deformation after posing, by which point several slow "
          "steps have to be redone. The preview render is cheap.")


def cmd_preview(a):
    """Render the skeleton inside a see-through body, from several angles.

    Bones are viewport overlays, so a normal render does not show them and
    checking placement used to mean opening the GUI. That is a problem: it is
    the one step nobody can automate, it happens at the exact moment when a
    mistake is cheapest to fix, and it does not survive into a log.

    Building each bone as an actual cylinder solves it. The picture is
    reviewable, repeatable, and can be put in front of someone who is not
    sitting at the machine.
    """
    import math as _m
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    rig = the_armature(prefer_generated=False)
    body = the_mesh()

    bone_mat = bpy.data.materials.new("Bone")
    bone_mat.use_nodes = True
    bb = bone_mat.node_tree.nodes["Principled BSDF"]
    bb.inputs["Base Color"].default_value = (0.95, 0.25, 0.15, 1)
    bb.inputs["Emission Color"].default_value = (0.95, 0.25, 0.15, 1)
    bb.inputs["Emission Strength"].default_value = 1.4

    r = body.dimensions.z * a.bone_radius
    made = 0
    for b in rig.data.bones:
        head = rig.matrix_world @ b.head_local
        tail = rig.matrix_world @ b.tail_local
        v = tail - head
        if v.length < 1e-6:
            continue
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8, radius=r, depth=v.length,
            location=(head + tail) / 2)
        c = bpy.context.view_layer.objects.active
        c.rotation_mode = "QUATERNION"
        c.rotation_quaternion = v.to_track_quat("Z", "Y")
        c.name = f"bone_{b.name}"
        c.data.materials.append(bone_mat)
        made += 1
    print(f"built {made} bone cylinders at radius {r:.4f}")

    # A solid body hides the skeleton, so make it a ghost. Alpha blending in the
    # viewport engine is enough; this render is for judging placement, not looks.
    ghost = bpy.data.materials.new("Ghost")
    ghost.use_nodes = True
    gb = ghost.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.65, 0.68, 0.72, 1)
    gb.inputs["Alpha"].default_value = a.ghost_alpha
    try:
        ghost.blend_method = "BLEND"
        ghost.show_transparent_back = False
    except AttributeError:
        pass
    body.data.materials.clear()
    body.data.materials.append(ghost)
    for p in body.data.polygons:
        p.use_smooth = True

    rig.hide_render = True
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    cam, tgt, ctr, H, dist = setup_studio(objs, clay=False)
    outdir = a.outdir or os.path.join(os.path.dirname(os.path.abspath(a.input)),
                                      "renders")
    os.makedirs(outdir, exist_ok=True)
    scn = bpy.context.scene
    for ang in a.angles:
        t = _m.radians(ang)
        cam.location = (ctr.x + dist * _m.sin(t), ctr.y - dist * _m.cos(t),
                        ctr.z)
        scn.render.filepath = os.path.join(outdir, f"{a.prefix}_a{ang}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scn.render.filepath, flush=True)
    print("\nCheck: knees at the knees, hip above the crotch, shoulders inside "
          "the deltoids, and the spine following the actual back rather than a "
          "straight vertical line.")


def strip_subtree(eb, root_name):
    """Delete a bone and everything descended from it.

    Removing a parent on its own is not enough: Blender reparents the orphans
    to their grandparent, so the sub-rig survives in mangled form.
    """
    root = eb.get(root_name)
    if root is None:
        return 0
    doomed, stack = [], [root]
    while stack:
        b = stack.pop()
        doomed.append(b)
        stack.extend(b.children)
    for b in doomed:
        eb.remove(b)
    return len(doomed)


def strip_unfitted(meta, drop_face=True, drop_fingers=True):
    """Remove the sub-rigs this pipeline cannot fit to the mesh.

    Face and finger bones are placed by Rigify's own defaults and only
    translated with their parent here, never fitted. That is harmless while they
    are just bones, and destructive the moment automatic weights bind real
    geometry to them: on the first validated run the generated face rig tore the
    figure's face apart, caving in the forehead and smearing the brow into
    strands, from nothing more than an 18-degree spine twist.

    A print pose needs neither. Strip them unless someone explicitly wants a
    face or hand rig and is prepared to place those bones by hand.
    """
    bpy.context.view_layer.objects.active = meta
    bpy.ops.object.mode_set(mode="EDIT")
    eb = meta.data.edit_bones
    removed = 0
    if drop_face:
        n = strip_subtree(eb, "face")
        removed += n
        print(f"stripped {n} unfitted face bones")
    if drop_fingers:
        n = 0
        for side in ("L", "R"):
            for root in ("palm.01", "palm.02", "palm.03", "palm.04",
                         "thumb.01"):
                n += strip_subtree(eb, f"{root}.{side}")
        removed += n
        print(f"stripped {n} unfitted finger bones")
    bpy.ops.object.mode_set(mode="OBJECT")
    if removed:
        print("These sub-rigs are removed because they were never fitted to "
              "this mesh. Pass --face / --fingers to keep them, and place them "
              "in the GUI before generating.")
    return removed


def snap_metarig(meta, lm, bend=0.05):
    """Fit the main chain to the measured body in all three axes.

    An earlier version set heights only, and the bone-preview render showed
    exactly why that is not enough: the spine sat on one flat Y plane in front
    of the torso, and both arms ran off Rigify's own T-pose direction and ended
    up entirely outside the mesh, elbows and hands floating in mid-air.

    So three things happen here rather than one. Heights come from the
    silhouette. Depth comes from the body's mid-Y at each height. Arms and legs
    are aimed at their measured extremity, which is the only way to follow the
    pose the figure is actually in.

    Bones that cannot be derived from a silhouette (fingers, toes, face) are
    still not fitted, but they are TRANSLATED with the hand or head they belong
    to, so at least they end up inside the body instead of beside it.
    """
    y_at = lm["_y_at"]
    bpy.context.view_layer.objects.active = meta
    bpy.ops.object.mode_set(mode="EDIT")
    eb = meta.data.edit_bones

    def place(name, head=None, tail=None):
        b = eb.get(name)
        if not b:
            print(f"  (no bone {name})")
            return None
        if head is not None:
            b.head = Vector(head)
        if tail is not None:
            b.tail = Vector(tail)
        return b

    cx = lm["centre_x"]

    def spine_pt(z):
        return (cx, y_at(z), z)

    place("spine", spine_pt(lm["z_hip"]), spine_pt(lm["z_waist"]))
    place("spine.001", spine_pt(lm["z_waist"]), spine_pt(lm["z_chest"]))
    place("spine.002", spine_pt(lm["z_chest"]), spine_pt(lm["z_shoulder"]))
    place("spine.003", spine_pt(lm["z_shoulder"]), spine_pt(lm["z_neck"]))
    neck_mid = lm["z_neck"] + (lm["z_head_top"] - lm["z_neck"]) * 0.25
    place("spine.004", spine_pt(lm["z_neck"]), spine_pt(neck_mid))

    head_bone = eb.get("spine.006") or eb.get("head")
    head_delta = None
    if head_bone:
        old = head_bone.head.copy()
        new_head = Vector(spine_pt(neck_mid))
        head_bone.head = new_head
        head_bone.tail = Vector(spine_pt(lm["z_head_top"]))
        head_delta = new_head - old

    for side, sgn in (("L", 1.0), ("R", -1.0)):
        # Legs: hip to a measured foot, with the knee on the way.
        foot = lm["_foot"][side]
        hip_pt = Vector((cx + sgn * lm["hip_half"], y_at(lm["z_hip"]),
                         lm["z_hip"]))
        ankle_pt = Vector((hip_pt.x, y_at(lm["z_ankle"]), lm["z_ankle"])) \
            if foot is None else Vector((foot.x, y_at(lm["z_ankle"]),
                                         lm["z_ankle"]))
        t = (lm["z_hip"] - lm["z_knee"]) / max(
            lm["z_hip"] - lm["z_ankle"], 1e-6)
        knee_pt = hip_pt.lerp(ankle_pt, t)
        # A perfectly straight limb has no bend plane, so Rigify's IK cannot
        # work out which way the joint should fold and generation fails outright
        # with "zero length vectors have no valid angle". Nudge the knee forward
        # and (below) the elbow back: a few percent is enough to define the
        # plane, and it matches how the joints actually bend.
        knee_pt.y -= (hip_pt - ankle_pt).length * bend
        place("thigh." + side, hip_pt, knee_pt)
        place("shin." + side, knee_pt, ankle_pt)
        if foot is not None:
            fb = eb.get("foot." + side)
            if fb:
                delta = ankle_pt - fb.head.copy()
                fb.head = ankle_pt
                fb.tail = fb.tail + delta
                tb = eb.get("toe." + side)
                if tb:
                    tb.head = tb.head + delta
                    tb.tail = tb.tail + delta

        # Arms: aim the whole chain at the measured hand. This is what the
        # height-only version got badly wrong.
        hand = lm["_hand"][side]
        sh_pt = Vector((cx + sgn * lm["shoulder_half"], y_at(lm["z_shoulder"]),
                        lm["z_shoulder"]))
        sb = eb.get("shoulder." + side)
        if sb:
            sb.head = Vector((cx + sgn * lm["shoulder_half"] * 0.25,
                              y_at(lm["z_shoulder"]), lm["z_shoulder"]))
            sb.tail = sh_pt
        if hand is None:
            print(f"  (no hand found on {side}; arm left at default)")
            continue
        elbow_pt = sh_pt.lerp(hand, 0.45)
        elbow_pt.y += (sh_pt - hand).length * bend
        wrist_pt = sh_pt.lerp(hand, 0.88)
        place("upper_arm." + side, sh_pt, elbow_pt)
        place("forearm." + side, elbow_pt, wrist_pt)
        hb = eb.get("hand." + side)
        hand_delta = None
        if hb:
            hand_delta = wrist_pt - hb.head.copy()
            hb.head = wrist_pt
            hb.tail = hand
        if hand_delta is not None:
            # Fingers are separate bones, not children that follow their parent
            # in edit mode, so move them by hand.
            for b in eb:
                if b.name.endswith("." + side) and (
                        b.name.startswith(("thumb", "f_index", "f_middle",
                                           "f_ring", "f_pinky", "palm"))):
                    b.head = b.head + hand_delta
                    b.tail = b.tail + hand_delta

    if head_delta is not None:
        face = ("brow", "lid", "cheek", "nose", "lip", "chin", "jaw", "ear",
                "teeth", "tongue", "eye", "temple", "forehead")
        for b in eb:
            if b.name.startswith(face):
                b.head = b.head + head_delta
                b.tail = b.tail + head_delta

    bpy.ops.object.mode_set(mode="OBJECT")
    print("fitted the spine, arms and legs to the measured body in all three "
          "axes; fingers, toes and face bones translated with their parent but "
          "not individually fitted")


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

    # Rigify limbs default to IK. While a limb is in IK the FK controls are
    # ignored, so a pose file full of *_fk rotations applies cleanly, saves
    # without complaint, and moves nothing. Flip the per-limb IK_FK switch to
    # FK unless asked not to.
    if a.fk:
        flipped = []
        for pb in rig.pose.bones:
            for key in ("IK_FK", "ik_fk", "IK/FK"):
                if key in pb.keys():
                    pb[key] = 1.0
                    flipped.append(f"{pb.name}.{key}")
        if flipped:
            print(f"switched {len(flipped)} limbs to FK: {flipped}")

    missing, applied = [], []
    driven = []
    for name, rot in pose.items():
        pb = rig.pose.bones.get(name)
        if pb is None:
            missing.append(name)
            continue
        if pb.constraints:
            driven.append(name)
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = tuple(math.radians(x) for x in rot)
        applied.append(name)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"applied rotations to {len(applied)} bones")
    if missing:
        print(f"WARNING: no such bones: {missing}")
        print("Rigify control bones are named like upper_arm_fk.L or hand_ik.L."
              " Run `list` for the drivable ones.")
    if driven:
        print(f"WARNING: these bones are constraint-driven, so the rotations "
              f"you set on them are overridden and nothing will move: {driven}")
        print("Use the _fk or _ik control instead.")
    save(a.output)


def cmd_list(a):
    clear()
    bpy.ops.wm.open_mainfile(filepath=a.input)
    rig = the_armature()
    print(f"{len(rig.pose.bones)} pose bones in {rig.name}"
          f" (rig_id={rig.data.get('rig_id')})")
    # A bone whose transform is driven by constraints ignores anything you set
    # on it, so listing every bone equally sends you straight at the wrong ones.
    free, driven = [], []
    for b in sorted(rig.pose.bones, key=lambda b: b.name):
        (driven if b.constraints else free).append(b.name)
    print(f"\n-- drivable ({len(free)}): set rotations on these --")
    for n in free:
        print(f"  {n}")
    if a.all:
        print(f"\n-- constraint-driven ({len(driven)}): rotating these does "
              f"nothing --")
        for n in driven:
            print(f"  {n}")
    else:
        print(f"\n({len(driven)} constraint-driven bones hidden; --all shows "
              f"them)")


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
    m.add_argument("--branch", choices=("print", "asset"), default="print",
                   help="print bakes the pose into a solid and has no use for "
                        "a face rig; asset keeps the armature")
    m.add_argument("--face", action="store_true",
                   help="keep Rigify's face rig; it is NOT fitted and will "
                        "tear the face apart under automatic weights")
    m.add_argument("--fingers", action="store_true",
                   help="keep finger bones; also unfitted")
    m.add_argument("--bend", type=float, default=0.05,
                   help="joint pre-bend as a fraction of limb length; "
                        "Rigify refuses a perfectly straight limb")
    m.set_defaults(fn=cmd_metarig)

    pv = sub.add_parser("preview")
    pv.add_argument("input")
    pv.add_argument("prefix", nargs="?", default="bones")
    pv.add_argument("--angles", type=lambda s: [int(x) for x in s.split(",")],
                    default=[0, 90])
    pv.add_argument("--bone-radius", type=float, default=0.006,
                    help="as a fraction of figure height")
    pv.add_argument("--ghost-alpha", type=float, default=0.18)
    pv.add_argument("--outdir", default=None)
    pv.set_defaults(fn=cmd_preview)

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
    po.add_argument("--keep-ik", dest="fk", action="store_false",
                    default=True,
                    help="leave limbs in IK; FK rotations will be ignored")
    po.set_defaults(fn=cmd_pose)

    ls = sub.add_parser("list")
    ls.add_argument("input")
    ls.add_argument("--all", action="store_true")
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
