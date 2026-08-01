---
name: pnk-sculpt-mesh
description: >-
  Stage 4 of the pnk-sculpt 3D pipeline. Turns a raw image-to-3D reconstruction
  into a watertight, single-shell, smooth-surfaced mesh using headless Blender:
  weld seams, subdivide, voxel remesh, drop floating islands, and verify. Also
  measures the figure (neck, hips, hands, head count) and corrects proportions.
  Use this whenever a mesh has holes, non-manifold edges, loose parts or a
  noisy speckled surface, whenever a slicer or printer rejects a model, when a
  glTF import reports thousands of components, when a model needs to be made
  watertight or manifold, or when a reconstructed figure looks short and wide.
  Covers voxel remeshing, why remeshing finer can make a surface worse, safe
  decimation, wall-thickness measurement, and reading mesh health numbers.
---

# Stage 4: mesh

Take the raw reconstruction to a solid you could hold. One command usually does
it; the skill is in choosing the voxel size and reading the result.

```bash
S=~/.claude/skills/pnk-sculpt/scripts
B="blender --background --factory-startup --python"

$B $S/mesh.py -- analyze raw/body.glb
$B $S/mesh.py -- clean raw/body.glb work/body_clean.blend --voxel 0.0018 --subdiv 1 --height-mm 200
```

## Weld before you believe any number

glTF splits vertices at every UV and normal seam. A single closed shell imports
looking like 12,000 components with tens of thousands of boundary edges. Every
command here welds first; the point is not to panic at a raw import's numbers,
and not to go hunting a problem that does not exist.

## What the health numbers mean

`analyze` prints all of these. The two that decide printability are first; the
rest tell you which stage broke something.

| Number | Good | Meaning |
|---|---|---|
| `non_manifold_edges` | 0 | Edges shared by other than two faces. Non-zero means not a solid. |
| `boundary_edges` | 0 | Actual holes. |
| `components` | 1 | Separate shells. More than one means floating islands. |
| `signed_volume` | positive | Negative means normals are inside out. |
| `dihedral_p95` | under ~30 | Angle between neighbouring faces. Near 180 means folded spikes. |
| `frac_folded_gt90` | under ~0.03 | The proportion of edges that fold back. This is the number that catches "watertight but a spiky mess". |

A mesh can pass the manifold checks and still be unusable. That is what the
roughness numbers are for.

## Choosing the voxel size

Voxel size is in Blender units, where the figure is about 1.0 tall. At a 200 mm
print, 0.0018 units is 0.36 mm.

| Purpose | Voxel | Note |
|---|---|---|
| Body, display scale | 0.0018 | proven |
| Body, finer pass before assembly | 0.0012 | pair with `--subdiv 1` |
| Fusing several parts | 0.0014 | must be **coarser** than the finest part |
| Lite export copy | 0.0025 | slicer-friendly |
| Small prop | span / 900 | props get their own fine grid; they are small |

**Always pass `--subdiv 1`.** A reconstruction is about 280k faces, so its
triangles are larger than a fine voxel. Remeshing finer than the source samples
flat triangle facets and reproduces them as surface noise: the mesh is closed,
and covered in speckle. Subdividing first gives the remesh a smooth field. This
one flag took a figure from p95 dihedral 68 to 13.5.

The paired rule for later stages: **remesh coarser than the finest input**.
Coarser smooths, finer amplifies. Re-remeshing a 0.0012 body at 0.0012 produced
noise; fusing it at 0.0014 did not.

## When cleanup fails

`clean` exits non-zero and says so. The causes, in order of likelihood:

1. **The source arrived as fragments.** Check the stage 3 diagnostics. Tens of
   thousands of floaters means no voxel size will help; go back and fix the
   reference or drop the resolution.
2. **Voxel too fine for the source.** Try one step coarser.
3. **Genuinely two objects.** `keep_largest_component` already drops islands; if
   the drop count is huge, look at what was dropped before accepting it.

A coarse remesh that bridges fragments is worth one attempt and rarely works. On
a 592-component head, remeshing coarsely left a 14k-face lump of what should
have been 240k. When that happens, re-reconstruct rather than salvage.

## Measure the figure

```bash
$B $S/mesh.py -- landmarks work/body_clean.blend --height-mm 200
```

Reports the bounding box, a width profile, the neck (narrowest band in the upper
fifth) with its centre, how many heads tall the figure is, what sits above the
neck but outside the head radius, and the left and right extremities where hands
are.

Everything the assembly stage needs comes from here. Write the values into
`run.json` and use them; do not retype them from a render.

## Fixing proportions

Reconstructions come out short and wide, typically 6.5 to 7 heads. `landmarks`
tells you which.

```bash
$B $S/mesh.py -- reshape work/body_clean.blend work/body_prop.blend \
   --legs 1.22 --narrow 0.95 --ankle -0.44 --hip -0.03 --renorm --height-mm 200
```

Get `--ankle` and `--hip` from the width profile: the ankle is above the boot
and below the calf, the hip is where the legs merge into the pelvis.

This is a piecewise-linear vertex map, so no vertex is added, removed or merged
and the mesh stays exactly as watertight as it started. Feet below the ankle are
untouched, or they become clown shoes; everything above the hip is translated
rigidly so the torso is not distorted.

Stretching the legs alone makes a figure taller but no slimmer, which is why
`--narrow` exists: "short and wide" is two complaints. On one build 1.22 / 0.95
took a figure from 7.3 heads to about 8 with a 51.4% leg fraction.

`--renorm` scales the result back to the height it started at. Use it. Without
it the figure grows by the amount the legs gained (18 mm in that example) and
every millimetre constant downstream, base radius, socket radius, prop length,
is silently applied at the wrong scale.

Do this **before** grafting a head or cutting sockets. Every coordinate measured
beforehand moves: the grip, the neck, the eye line, and the head-cut radius,
which shrinks with the narrowing and will eat the quiver if you leave it. Re-run
`landmarks` afterwards and believe it over anything you wrote down earlier.

## Checking thickness early

```bash
$B $S/mesh.py -- thickness work/body_clean.blend --height-mm 200 --min-mm 0.8
```

Worth running now rather than at the print gate, because the answer may send you
back to the brief. If the thinnest features fail at the target scale, the choices
are to scale up, thicken the feature, or promote it to a separate printed part,
and all three are cheaper to decide before assembly.

The estimate casts rays inward from the surface and keeps only hits on a genuinely
opposing wall. Without that filter every concave crease reports near-zero and the
number is meaningless.

## Looking at it

```bash
$B $S/mesh.py -- render work/body_clean.blend clay --outdir renders
python3 $S/sheet.py renders/clay_sheet.png renders/clay_{front,q45,side,back}.png
```

Render clay, not textured. Texture hides geometry problems: a speckled surface
reads as pattern until you strip the colour and see holes.

If a render looks blown out or black, the lights are wrong for the subject size,
not the mesh. Light energy scales with the bounding box, so an unexpected
exposure usually means the object is not the size you think.
