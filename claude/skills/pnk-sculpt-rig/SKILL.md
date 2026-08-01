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

## The face and finger rigs, and why the branch decides

Rigify's human metarig ships about 92 face bones and 38 finger bones. This
pipeline fits the spine, arms and legs from the mesh but cannot fit those:
there is no way to find a lip corner or a knuckle on a voxel-remeshed sculpt.
They are only translated along with the head or hand they belong to.

That is harmless while they are just bones and destructive the moment automatic
weights bind real geometry to them. On the first validated run an 18-degree
spine twist tore the face apart: forehead caved in, brow smeared into strands,
eye sockets collapsed. Nothing was rotating those bones. Badly-placed bones
owning that geometry was enough on its own.

`--branch print` (the default) deletes both sub-rigs. That is not a workaround.
A print is one frozen pose, there is no expression to animate, and Rigify ships
a face rig because Rigify is built for animation, not because a figurine needs
one.

`--branch asset` keeps them and warns, because silently deleting an animator's
face bones would be worse than shipping them imperfect.

### The limitation you should state plainly to whoever asked

Keeping the face bones does not give you a working face rig, and neither would
placing them perfectly. Facial deformation needs edge loops: concentric rings of
quads around the eyes and mouth, so a lid bone's rotation follows the loop and
the eye closes. A voxel remesh produces uniform triangles with no loops
anywhere, so the deformation has nothing to follow and smears.

**The bones were the visible cause; the topology is the real one.** A usable
face rig needs the head retopologised to quad topology first, with the lost
surface detail baked into a normal map. That is a different discipline from
anything in this pipeline and is specified separately; see the retopology spec
in the homelab backlog. Until it exists, the asset branch is honestly a
body-deformation rig with a static face.

## Rig BEFORE the base is fused on

This changes stage 5's order and it is not optional. Automatic weights are
assigned by proximity, so a plinth fused to the feet gets weighted to the leg
bones. Swing a leg forward and the base is dragged and stretched with it into a
warped sliver, which then fails the print gate on wall thickness. It looks
obviously wrong the moment you render it and is invisible until you do.

So for the posed branch, stage 5 runs in two halves:

```
socket -> graft -> fuse (body + head)   ->  RIG, POSE, BAKE  ->  base -> fuse -> eyes
```

Do the same for any prop that should not bend: model and attach it after the
pose is baked, not before.

## Read this before starting

**This is the least reliable stage in the pipeline.** A voxel-remeshed mesh has
no edge loops at the joints, so automatic weights bleed across them and an elbow
can bend part of the ribcage with it. Treat the output as a first draft, check a
single strong bend before committing to a full pose, and expect to correct
weights by hand for anything ambitious.

The full print branch has been run end to end once, on a 200 mm figure: metarig,
preview, generate, pose, bake, gate. The bake came back watertight and
single-shell with surface roughness improved by the re-close (p95 dihedral 56 to
22). That run is also where every warning below comes from.

**Always run `preview` after `metarig`.** A misplaced bone generates a perfectly
valid rig and only reveals itself as bad deformation after posing, by which
point several slow steps have to be redone. The preview render costs seconds.
This is not optional advice: the first validated run of this stage produced a
skeleton whose arms lay entirely outside the mesh, and only the preview showed
it.

**Rig the lite mesh.** 50k to 150k faces. Automatic weights on a two-million-face
mesh are slow and no better. `generate` decimates for you by default.

**For the asset branch, do not start from the print mesh.** Voxel remeshing
destroys UVs, so a rigged asset should branch from the textured reconstruction
in `raw/`, cleaned only enough to be usable. Stage 7's textured GLB export is the
right input.

## What the fit does and does not do

`metarig` measures the body and fits bones in all three axes: heights from the
silhouette, depth from the body's own mid-Y at each height, and the arm and leg
chains aimed at the measured hand and foot. That last part matters more than it
sounds. Rigify's default arms follow its own T-pose, so on a figure in any other
pose they end up outside the mesh entirely.

Not fitted: fingers, toes and face bones. They are translated with the hand or
head they belong to, so they land inside the body rather than beside it, but
their individual placement is still Rigify's default. If you need working
fingers, place them in the GUI.

The landmark heights are checked for anatomical order (ankle below knee below
hip below waist, and so on) and any inversion is reported loudly, because a
skeleton built on an out-of-order landmark looks fine until it is posed.

## Fit the metarig, then look at it

```bash
S=~/.claude/skills/pnk-sculpt/scripts
B="blender --background --factory-startup --python"

$B $S/rig.py -- metarig work/figure.blend work/metarig.blend
$B $S/rig.py -- preview work/metarig.blend bones --outdir renders
python3 $S/sheet.py renders/bones_sheet.png renders/bones_a0.png renders/bones_a90.png
```

`preview` builds every bone as a cylinder and renders it inside a see-through
body, front and side. Bones are viewport overlays, so an ordinary render will
not show them; building them as real geometry is what makes this checkable
headlessly, and reviewable by someone who is not at the machine.

What to look for, in order of how often it is wrong:

1. **Arms inside the arms.** Elbows within the limb, hands at the hands. This is
   the failure mode that fitting exists to prevent.
2. **Side view depth.** The spine should run through the torso, not float in
   front of it or behind it. A cape or a backpack pulls the measured mid-depth
   backward, so check this one specifically on a cloaked figure.
3. **Hip above the crotch, knees at the knees.**
4. **Shoulders inside the deltoids**, not out at the edge of a pauldron.

Correct anything wrong in the GUI before generating.

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
$B $S/rig.py -- list work/rigged.blend        # drivable control bones
$B $S/rig.py -- pose work/rigged.blend work/posed.blend --pose poses/draw-bow.json
```

**Target the `_fk` controls, not the plain bone names.** A generated rig has
around 700 bones and most are constraint-driven: setting a rotation on
`upper_arm.L` applies cleanly, saves without complaint, and moves nothing,
because a constraint overrides it. `list` separates the drivable bones from the
driven ones for exactly this reason, and `pose` warns if you hit a driven one.
The useful names are `upper_arm_fk.L`, `forearm_fk.L`, `thigh_fk.R`,
`shin_fk.R`, `spine_fk.00n`, `hips`, `chest`, `neck`, `head`.

**Limbs default to IK**, and while a limb is in IK its FK controls are ignored,
which is the same silent no-op by another route. `pose` flips every limb's
`IK_FK` switch to FK before applying, and reports which. Pass `--keep-ik` if you
are posing through IK targets instead.

Both of these were found by validating this stage rather than by reading the
documentation, so expect other Rigify conventions to bite the same way: when a
pose does nothing, suspect a constraint or a mode switch before suspecting the
numbers.

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
