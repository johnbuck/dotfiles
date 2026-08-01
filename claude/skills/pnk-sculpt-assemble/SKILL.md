---
name: pnk-sculpt-assemble
description: >-
  Stage 5 of the pnk-sculpt 3D pipeline. Combines separately reconstructed or
  parametrically built parts into one solid: grafts a high-detail head onto a
  body at the neck, cuts mounting sockets for held props, adds a base, fuses
  everything, and sets eyeball spheres into a face. Use this when a
  reconstructed figure has a blank, mask-like or sleeping face, when a head or
  prop needs joining to a body, when a model needs a plinth or a socket for a
  weapon, when several meshes must become one watertight solid, or when someone
  asks why image-to-3D cannot produce open eyes. Covers the boolean-then-remesh
  ordering that keeps assembly from destroying a mesh, cutting a head off
  without decapitating a quiver, and locating features by measurement rather
  than by eye.
---

# Stage 5: assemble

Every operation here is destructive and slow, so the order is not negotiable and
each step is verified before the next.

```
socket  ->  graft  ->  base  ->  fuse  ->  eyes
```

Booleans first, while the body is still one clean shell. The graft, base and
fuse then happen as a single voxel remesh. Eyes last, as a small local boolean
plus a re-close at the same voxel the figure was fused at.

**Why not booleans throughout.** Exact booleans are excellent on a tidy
two-object case and unreliable on a dense multi-component organic mesh. One
attempt on an 850k-face six-component mesh collapsed it to 7k faces. The remesh
fuse is unconditionally robust; the price is that it resamples the whole
surface, which is why its voxel must be coarser than the finest part going in.

## Setup

```bash
S=~/.claude/skills/pnk-sculpt/scripts
B="blender --background --factory-startup --python"
```

Measure first. Everything below takes coordinates, and every one of them should
come from `mesh.py landmarks`, `mesh.py ortho` or `assemble.py findeyes`, not
from looking at a picture.

## Sockets for held props

A reconstruction usually leaves a hand as a closed fist with a shallow tube
through it, pointing whichever way the reference happened to look. That tube is
rarely on the axis the prop needs. Fill it, then cut a fresh one.

```bash
$B $S/assemble.py -- socket work/body_prop.blend work/body_socket.blend \
   --at -0.3483,-0.0913,0.0732 --plug-mm 5.0 --radius-mm 3.9 \
   --depth-mm 60 --tilt 0,7,0 --height-mm 200
```

`--at` is the hand centre from `landmarks`. Make `--depth-mm` long enough that
the cylinder passes fully through: one that stops inside leaves a rim and the
mesh opens.

The matching peg goes on the prop, undersize by the clearance:

```bash
$B $S/prop.py -- peg work/bow.blend work/bow_peg.blend \
   --at 0,0,0 --radius-mm 3.9 --length-mm 12 --clearance-mm 0.2
```

## Grafting a head

The reason this stage exists. In a full-body reference the head is a few percent
of the frame, so after the reconstructor downsamples its input the face has
almost no pixels and comes out as a mask. A separate bust gives the face the
whole frame, roughly a tenfold detail increase.

```bash
$B $S/assemble.py -- graft work/body_socket.blend work/head_clean.blend \
   work/aligned.blend --head-scale 0.94 --head-voxel 0.0011 \
   --head-radius 0.11 --height-mm 200
```

Alignment is measured, not typed. The neck is the narrowest horizontal band in
the upper part of each mesh, and matching neck-to-crown distances gives the
scale. `--head-scale` trims that by eye, because a reconstructed bust usually
has a slightly generous neck; 0.92 to 0.96 is the useful range.

**`--head-radius` is what keeps the quiver.** A flat plane cut at the neck also
decapitates anything rising past the shoulder: arrows, a raised weapon, a
backpack. Measured on a standing humanoid the head and ears lie within a small
radius of the neck axis while those features sit well beyond it, so the cut is a
cylinder around that axis. `mesh.py landmarks` prints exactly how many vertices
fall each side of a candidate radius, so pick it from that rather than the
default.

**`--head-voxel` is in final figure units.** The scale is applied before the
remesh, so the value is used directly. Dividing it by the scale is a bug that
produces a head remeshed far too fine, which then reads as noise after the fuse.

## Base and fuse

```bash
$B $S/assemble.py -- base work/aligned.blend work/based.blend \
   --radius-mm 30 --thickness-mm 5 --sink-mm 2.5 --height-mm 200

$B $S/assemble.py -- fuse work/figure.blend work/based.blend \
   --voxel 0.0014 --height-mm 200
```

The fuse voxel must be coarser than the finest part. If the body was cleaned at
0.0012, fuse at 0.0014. Fusing at the same value or finer resamples the body's
own facets and the result reads as noise across the whole surface.

Verify before going on:

```bash
$B $S/mesh.py -- render work/figure.blend fig --outdir renders
python3 $S/sheet.py renders/fig_sheet.png renders/fig_{front,q45,side,back}.png
```

## Eyes

Image-to-3D cannot produce open eyes. It carves a shallow slit where the lids
meet and leaves the socket flat, so the face reads as asleep at any
magnification. No resolution setting changes this. Miniature sculptors solve it
by setting a sphere in the socket, and so do we: it buys a rounded eyeball with
real volume, and paint supplies the iris. It does not buy a wide alert gaze; be
straight with the user about that.

Find the sockets from the geometry:

```bash
$B $S/assemble.py -- findeyes work/figure.blend \
   --x-range -0.095,0.075 --z-range 0.395,0.465
```

It prints a depth map and suggests `--at-z`, `--centre-x` and `--dx`. If the
relief numbers are all tiny the sockets are too shallow to detect, and the
fallback is a measured orthographic render:

```bash
$B $S/mesh.py -- ortho work/figure.blend face --at 0.0,0.425 --scale 0.16 --outdir renders
python3 $S/sheet.py renders/face_grid.png renders/face.png --grid --step 100
```

The ortho command prints the pixel-to-world mapping, the grid labels the pixels,
and a feature's position converts exactly. A perspective closeup cannot be
measured this way: features nearer the camera shift outward, so every position
read off one is wrong by an unknown amount. That mistake cost several rounds
before it was caught.

Then place them:

```bash
$B $S/assemble.py -- eyes work/figure.blend work/figure_eyes.blend \
   --at-z 0.4200 --centre-x 0.0 --dx 0.0264 --radius-mm 1.5 \
   --protrude-mm 0.35 --refuse-voxel 0.0014 --height-mm 200
```

Both eyes take one depth. Hair hanging over one side of the face contaminates
that side's samples, and asymmetric eyes read as a deformity, so the socket whose
probe samples agree more tightly wins and sets the depth for both. The script
prints both spreads so you can see which it chose and why.

`--refuse-voxel` should be the figure's fuse voxel. The boolean leaves a few
non-manifold edges where sphere meets lid; re-remeshing at the same value
recloses the solid without changing its effective resolution.

## Verification discipline

Run `check` output past your eyes after every step, and a clay render after the
fuse. When a final mesh is bad you want to know which operation broke it, and
the only way to know that cheaply is to have measured after each one. These
operations take minutes each; finding out at the end costs a whole rebuild.
