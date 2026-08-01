---
name: pnk-sculpt-rig
description: >-
  Stage 6 of the pnk-sculpt 3D pipeline. Rigs and poses a figure with Blender's
  Rigify: fits a metarig to the measured mesh, generates the control rig, binds
  with automatic weights, applies a pose from JSON, then either bakes the pose
  into a watertight printable solid or exports a rigged GLB/FBX asset with the
  armature intact. Use this when a model needs an armature, skeleton, bones,
  skinning or weights, when a figure needs posing or re-posing, when a static
  sculpt must become an animatable game character, or when a posed print is
  wanted instead of an A-pose. Covers why automatic weights struggle on
  voxel-remeshed topology, the face budget for rigging, and why a posed print
  must be re-closed afterwards.
---

# Stage 6: rig and pose

Two branches leave this stage and they want opposite things from the mesh.

```
print branch:  metarig -> generate -> pose -> bake   -> stage 7
asset branch:  metarig -> generate -> pose -> export (armature kept)
```

For printing the rig is scaffolding: pose, apply, throw the armature away,
re-close to a solid. Topology does not matter because nothing will deform it
again. For a game asset the rig is the deliverable: face count matters, UVs and
materials must survive, watertightness stops mattering entirely.

## Read this before starting

**This is the least reliable stage in the pipeline and the most likely to need
the GUI.** A voxel-remeshed mesh has no edge loops at the joints, so automatic
weights bleed across them and an elbow bends part of the ribcage with it. Bone
placement in particular is something a script cannot verify for you: a slightly
wrong knee still generates a valid rig, it just deforms badly, and you only find
out after posing.

It was also built after the rest of the pipeline had been proven, and has been
exercised far less. Treat its output as a first draft, check a single strong
bend before committing to a full pose, and expect to correct weights by hand for
anything ambitious.

**Rig the lite mesh.** 50k to 150k faces. Automatic weights on a two-million-face
mesh are slow and no better. `generate` decimates for you by default.

**For the asset branch, do not start from the print mesh.** Voxel remeshing
destroys UVs, so a rigged asset should branch from the textured reconstruction
in `raw/`, cleaned only enough to be usable. Stage 7's textured GLB export is the
right input.

## Fit the metarig

```bash
S=~/.claude/skills/pnk-sculpt/scripts
B="blender --background --factory-startup --python"

$B $S/rig.py -- metarig work/figure_lite.blend work/metarig.blend
```

This measures the mesh (ankle, knee, hip, waist, chest, shoulder, neck, crown,
and the lateral extremities), adds Rigify's human metarig, scales it to the
figure, and snaps the main bone chain to the measured heights. Fingers, toes and
face bones stay at Rigify's defaults, because guessing them from a voxel mesh is
worse than the default.

The measured landmarks are printed. Sanity-check them against
`mesh.py landmarks` output before continuing: if the hip or shoulder is
obviously wrong, the rest of the skeleton is built on it.

Open `work/metarig.blend` in the GUI and look at the bones. There is no headless
substitute for this, and it is the cheapest correction you will ever make here.

## Generate and bind

```bash
$B $S/rig.py -- generate work/metarig.blend work/rigged.blend --decimate 150000
```

Then verify the bind before posing properly. Bend one arm hard, render it, and
look at whether the shoulder and ribs came along:

```bash
cat > /tmp/testbend.json <<'EOF'
{"upper_arm_fk.L": [0, 0, -70]}
EOF
$B $S/rig.py -- list work/rigged.blend | head -40
$B $S/rig.py -- pose work/rigged.blend work/testbend.blend --pose /tmp/testbend.json
$B $S/mesh.py -- render work/testbend.blend bend --outdir renders
```

If the torso deforms with the arm, the weights need work in the GUI. Finding
that now costs one render; finding it after a full pose costs the pose.

## Pose

Poses are JSON: bone name to `[rx, ry, rz]` in degrees, XYZ Euler, in bone
space. Data rather than GUI state, so a pose is reviewable, diffable and
reusable on the next character.

```bash
$B $S/rig.py -- list work/rigged.blend        # exact control bone names
$B $S/rig.py -- pose work/rigged.blend work/posed.blend --pose poses/draw-bow.json
```

Rigify control bones are named like `upper_arm_fk.L`, `hand_ik.L`, `spine_fk.002`,
`chest`, `head`. `list` is the reliable way to get them; guessing produces a
"no such bone" warning and a silently unposed figure.

Keep poses modest for printing. A deep bend self-intersects on the inside of the
joint, and while the re-close usually survives it, a severe one does not.

## Branch A: bake for printing

```bash
$B $S/rig.py -- bake work/posed.blend work/posed_solid.blend \
   --voxel 0.0014 --height-mm 200
```

Applies the armature, removes it, and re-closes with a voxel remesh. The re-close
is not optional: applying an armature stretches geometry at the joints and
reliably self-intersects on the inside of a bend. Self-intersection is invisible
in a render and fatal to a slicer.

Use the figure's fuse voxel or slightly coarser. If the re-close fails, the pose
is too deep: reduce it rather than chasing voxel sizes.

This costs surface detail, because the remesh resamples everything. That is the
real price of a posed print, and it is worth saying out loud when someone asks
for one.

Then go to stage 7 and gate it.

## Branch B: export a rigged asset

```bash
$B $S/rig.py -- export work/posed.blend out/character.glb --max-faces 200000
```

Warns if the face count is over budget or if the mesh has no UV map. No UVs
means the asset exports untextured, and the cause is almost always that it came
from the print branch, where remeshing destroyed them.

GLB carries mesh, armature and materials in one file and imports into most
engines. FBX is there for pipelines that require it.

## When to skip this stage entirely

If nobody asked for a pose and the figure is going to print, skip it. An A-pose
print keeps every bit of surface detail the assembly stage produced, and the
rig-and-bake round trip is a real loss with no compensating gain.
