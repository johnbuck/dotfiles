"""Build synthetic humanoid figures whose true neck height is KNOWN.

    blender --background --factory-startup --python synth.py -- <case> <out.blend>

The point of this file is objective ground truth. A neck detector cannot be
judged by looking at a render and deciding it seems about right; that is the
unreliable step. Here the neck is placed at a chosen z by construction, so a
detector's answer can be scored as a plain numeric error.

Every case is built from primitives, joined, and voxel-remeshed so the detector
sees the same kind of closed, uniformly-tessellated surface a real
reconstruction produces, rather than a tidy analytic shape it would never meet.
"""
import sys
import os

import bpy

sys.path.insert(0, os.path.expanduser("~/.claude/skills/pnk-sculpt/scripts"))
from sculptlib import (  # noqa: E402
    clear, join_all, keep_largest_component, save, voxel_remesh, weld,
)

# Proportions of a 1.0-tall figure. These are the ground truth.
FLOOR = 0.0
HIP_Z = 0.46
SHOULDER_Z = 0.80          # top of the torso: the neck BASE
CHIN_Z = 0.865             # bottom of the head: the neck TOP
HEAD_R = 0.075
NECK_R = 0.035
TORSO_R = 0.115
LEG_R = 0.050
SHOULDER_HALF = 0.155

NECK_Z = (SHOULDER_Z + CHIN_Z) / 2      # <- what a detector should return
NECK_BASE_Z = SHOULDER_Z


def cyl(r, z0, z1, x=0.0, y=0.0, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=r, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    return bpy.context.view_layer.objects.active


def cone(r0, r1, z0, z1, x=0.0, y=0.0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=48, radius1=r0, radius2=r1, depth=z1 - z0,
        location=(x, y, (z0 + z1) / 2))
    return bpy.context.view_layer.objects.active


def ball(r, x, y, z, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=r,
                                         location=(x, y, z))
    o = bpy.context.view_layer.objects.active
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return o


def torus(major, minor, z, x=0.0, y=0.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=40, minor_segments=16,
                                     location=(x, y, z))
    return bpy.context.view_layer.objects.active


def body():
    """The common core: legs, torso, shoulders, neck, head."""
    parts = [
        cyl(LEG_R, FLOOR, HIP_Z, x=-0.06),
        cyl(LEG_R, FLOOR, HIP_Z, x=+0.06),
        cone(TORSO_R * 0.85, TORSO_R, HIP_Z - 0.02, SHOULDER_Z),
        ball(SHOULDER_HALF, 0, 0, SHOULDER_Z - 0.02, scale=(1.0, 0.55, 0.35)),
        cyl(NECK_R, SHOULDER_Z - 0.03, CHIN_Z + 0.01),
        ball(HEAD_R, 0, 0, CHIN_Z + HEAD_R * 0.82, scale=(1.0, 1.05, 1.15)),
    ]
    return parts


CASES = {}


def case(fn):
    CASES[fn.__name__] = fn
    return fn


@case
def plain():
    """Clean neck, nothing around it. The easy case."""
    return body()


@case
def gorget():
    """A flared collar WIDER than the neck, rising past it.

    This is the armoured-knight failure: the neck is no longer the narrowest
    thing, the chin is, so a width-based detector jumps up to the jaw.
    """
    return body() + [cone(TORSO_R * 0.95, NECK_R * 2.4,
                          SHOULDER_Z - 0.05, CHIN_Z - 0.005)]


@case
def collar():
    """A ring around the neck, e.g. a torc or a rolled collar."""
    return body() + [torus(NECK_R * 1.7, NECK_R * 0.55, SHOULDER_Z + 0.02)]


@case
def braid():
    """A rope of hair hanging beside the neck, down to mid-torso.

    Adds material at neck height without joining the neck, which inflates a
    bounding-box width badly and a cross-section area only slightly.
    """
    # Stops just below the chin on purpose. The first version ran past it, so
    # the braid widened every band from torso to skull equally and the argmin
    # did not move: the case scored identically to `plain`.
    return body() + [cyl(0.024, 0.55, CHIN_Z - 0.012, x=-0.062, y=0.015)]


@case
def hood():
    """A hood enclosing the head and reaching the shoulders."""
    return body() + [
        ball(HEAD_R * 1.35, 0, 0.012, CHIN_Z + HEAD_R * 0.7,
             scale=(1.0, 1.1, 1.2)),
        cone(TORSO_R * 0.9, HEAD_R * 1.3, SHOULDER_Z - 0.04, CHIN_Z + 0.02),
    ]


@case
def pauldrons():
    """Big shoulder armour sitting high, close to neck height."""
    return body() + [
        ball(0.075, -0.13, 0, SHOULDER_Z + 0.01, scale=(1, 1, 0.75)),
        ball(0.075, +0.13, 0, SHOULDER_Z + 0.01, scale=(1, 1, 0.75)),
    ]


@case
def beard():
    """A beard filling the space under the chin, bridging jaw to chest."""
    return body() + [ball(HEAD_R * 0.85, 0, -0.035, CHIN_Z - 0.01,
                          scale=(0.9, 0.8, 1.5))]


@case
def cape():
    """A cape hanging from the neck down the back."""
    c = cyl(0.001, 0, 1, x=99)      # placeholder to keep the list shape simple
    bpy.data.objects.remove(c, do_unlink=True)
    # scale multiplies HALF-extents, so these are halves. The first version
    # used the same numbers as full extents and put the cape at z 0.40..0.70,
    # entirely below the neck: the case was byte-identical to `plain` and tested
    # nothing while appearing to test a cape.
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0.085, 0.62))
    o = bpy.context.view_layer.objects.active
    o.scale = (0.11, 0.010, 0.25)
    bpy.ops.object.transform_apply(scale=True)
    return body() + [o]


@case
def jaw_trap():
    """Neck exposed, yet its bounding box is wider than the chin's.

    This is the failure the whole exercise is about, and the first version of
    the benchmark did not contain it. A flared collar that stops BELOW the neck
    leaves the neck visible, while a strand running ear-to-shoulder widens the
    neck bands' bounding box without adding much section area. Width should pick
    the chin; area should still pick the neck.
    """
    return body() + [
        cone(TORSO_R * 0.95, NECK_R * 2.2, SHOULDER_Z - 0.06, SHOULDER_Z + 0.025),
        cyl(0.012, SHOULDER_Z + 0.01, CHIN_Z + 0.005, x=-0.070, y=0.0),
        cyl(0.012, SHOULDER_Z + 0.01, CHIN_Z + 0.005, x=+0.070, y=0.0),
    ]


@case
def thick_neck():
    """A neck nearly as wide as the head: a bull-necked or armoured figure."""
    parts = body()
    bpy.data.objects.remove(parts[4], do_unlink=True)
    parts[4] = cyl(HEAD_R * 0.88, SHOULDER_Z - 0.03, CHIN_Z + 0.01)
    return parts


@case
def no_neck():
    """The head sits straight on the shoulders. There is barely a neck."""
    parts = [
        cyl(LEG_R, FLOOR, HIP_Z, x=-0.06),
        cyl(LEG_R, FLOOR, HIP_Z, x=+0.06),
        cone(TORSO_R * 0.85, TORSO_R, HIP_Z - 0.02, SHOULDER_Z + 0.03),
        ball(SHOULDER_HALF, 0, 0, SHOULDER_Z, scale=(1.0, 0.55, 0.35)),
        ball(HEAD_R, 0, 0, SHOULDER_Z + HEAD_R * 0.85, scale=(1, 1.05, 1.15)),
    ]
    return parts


@case
def shoulder_prop():
    """A quiver or haft rising well above the shoulder, beside the head."""
    # Terminates INSIDE the neck span. A prop that runs past the head adds a
    # constant to every band and moves nothing; one that ENDS mid-neck creates a
    # step discontinuity exactly where the detector is looking, which is the
    # failure worth testing.
    return body() + [cyl(0.026, SHOULDER_Z - 0.16, 0.845, x=-0.085, y=0.04)]


@case
def long_hair():
    """Hair falling from the crown to below the shoulders on both sides."""
    return body() + [
        ball(HEAD_R * 1.15, 0, 0.02, CHIN_Z + HEAD_R * 0.8,
             scale=(1.0, 1.0, 1.1)),
        cyl(0.030, 0.62, CHIN_Z + 0.02, x=-0.070, y=0.03),
        cyl(0.030, 0.62, CHIN_Z + 0.02, x=+0.070, y=0.03),
    ]


def build(name, out, voxel=0.004):
    if name not in CASES:
        raise SystemExit(f"unknown case {name}; have {sorted(CASES)}")
    clear()
    parts = CASES[name]()
    obj = join_all(parts, "Figure")
    weld(obj)
    # Remesh so the detector meets the same uniform closed surface a real
    # reconstruction gives it, not a clean analytic primitive.
    voxel_remesh(obj, voxel)
    obj, _ = keep_largest_component(obj, "Figure")

    # Pin the mesh back into the frame it was BUILT in. separate() and friends
    # move the object origin, so a saved case can load spanning -0.23..0.78
    # while the ground truth is stated in build coordinates. Scoring absolute z
    # against a shifted frame silently marks every detector wrong, which is
    # exactly the sort of harness bug that would otherwise be blamed on the
    # method under test.
    from sculptlib import select_only
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    dz = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.z -= dz
    obj.data.update()

    zs = [(obj.matrix_world @ v.co).z for v in obj.data.vertices]
    lo, hi = min(zs), max(zs)
    # Normalise to exactly 1.0 tall sitting on z=0, so ground truth is in the
    # same units for every case regardless of what the extras added.
    print(f"CASE {name}")
    print(f"  built height {hi - lo:.4f} (lo {lo:.4f} hi {hi:.4f})")
    print(f"  GROUND TRUTH neck_z={NECK_Z:.4f} neck_base_z={NECK_BASE_Z:.4f} "
          f"as a fraction of 1.0: {NECK_Z:.4f} / {NECK_BASE_Z:.4f}")
    print(f"  faces {len(obj.data.polygons)}")
    save(out)


if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:]
    if a and a[0] == "list":
        print(" ".join(sorted(CASES)))
    else:
        build(a[0], a[1])
