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
two-object case and unreliable on a dense organic mesh. Three measured failures
on one figure, none of which raised an error:

| Operation | Before | After |
|---|---|---|
| UNION of a head into a 6-component body | 856k faces | 7,765 |
| UNION of spheres into a mesh just cut by DIFFERENCE | 1,432,069 | 1,575 |
| DIFFERENCE of a simple slab from a bust | 537,322 | 6,653 |

They are safe against simple primitives on a clean single-shell mesh: the sphere
that plugs a palm and the cylinder that cuts a socket both work. For anything
else, delete faces and cap, or join and remesh. Note the second row: a mesh that
has just been cut is a poor boolean operand even when the cut itself succeeded.

The remesh fuse is unconditionally robust; the price is that it resamples the
whole surface, which is why its voxel must be coarser than the finest part.

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
   --at=-0.3483,-0.0913,0.0732 --plug-mm 5.0 --radius-mm 3.9 \
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

### Check the prop is the right way round

Numbers can all be correct and the result still be obviously wrong to anyone who
has handled the real object. On a strung bow the **string is the part nearest the
archer** and the stave curves away from her, so the limb offset has to stay at or
below the string offset along essentially the whole length. One build had the
limbs bulging 4.5 mm *past* the string toward the body, which made the stave the
inner element and the string the outer one: a bow held backwards. Every
individual measurement had looked fine.

Before you call a held prop done, render it in place and ask whether someone who
uses that object would recognise the grip.

## Giving the figure a detailed face

The reason this stage exists. In a full-body reference the head is a few percent
of the frame, so after the reconstructor downsamples its input the face has
almost no pixels and comes out as a mask. A separate bust gives the face the
whole frame, roughly a tenfold detail increase.

There are two ways to get that detail onto the body, and the default is
**transfer**, not graft.

### transfer: reshape the body's own head (use this)

```bash
$B $S/assemble.py -- transfer work/body_prop.blend work/head_clean.blend \
   work/figure.blend --head-radius 0.13 --height-mm 200
```

Nothing is cut. The body's head vertices are pulled onto the detailed head's
surface, with influence ramping to zero before the shoulders. No vertex is
added, removed or merged, so the mesh is exactly as watertight afterwards as
before, and there is no seam because there is no join.

Why this is the default: the graft path below produced a visible ledge across
the jaw and a second chin underneath, on a real build. Both are structural, not
tuning problems. Capping the body's neck stub and capping the donor and
overlapping the two gives a voxel fuse two flat discs to reconcile, and it
reconciles them into a step. Separately, the neck is found as the narrowest
horizontal band, which on an armoured figure lands at the **jaw line** rather
than the neck base, so the body's own chin survives below the cut.

The honest limit: shrinkwrap moves vertices, it cannot invent them. Detail finer
than the body head's vertex spacing will not appear, and a feature the body head
lacks entirely will be stretched toward rather than reproduced. Clean the body at
a voxel fine enough that its head carries a few thousand faces; `transfer`
prints the count so you can check. Expect a slightly softer face than the donor,
and let the `eyes` step below supply the eyes.

### graft: cut the head off and replace it

Still available, and correct when the head genuinely must be **replaced** rather
than refined: a different helmet, a swapped head, a non-human head on a human
body. Accept that you will be fixing the seam.

### How graft works

The reason this stage exists. In a full-body reference the head is a few percent
of the frame, so after the reconstructor downsamples its input the face has
almost no pixels and comes out as a mask. A separate bust gives the face the
whole frame, roughly a tenfold detail increase.

Reconstructing the head is easy. **Attaching it is the hardest thing in this
pipeline** and took nine attempts on the build these notes come from. Read the
whole section before running anything; each failure below hides the next.

### The neck detector finds the chin

The narrowest horizontal band in the upper body is the standard way to find a
neck. On a figure with a braid beside the neck or a collar around it, that band
lands on the **chin**, because the chin genuinely is narrower than the padded
neck. Three defects follow, and they took five attempts to untangle:

1. **The cut plane sits through the jaw**, so the chin and lower face survive
   *below* it. No radius fixes that; the leftover is not outside the cylinder,
   it is under the plane.
2. **The head seats too high.** A body's detector finds its chin while a bust's
   finds its real neck, and the graft aligns those two. Different anatomy, so
   the head floats high: a stretched neck, and the bust's collar dragged down
   over the body's.
3. **The head scales small**, because the scale is body crown-to-**chin** over
   bust crown-to-**neck**.

**Verify the neck height before cutting.** Render from the side with candidate
heights drawn on, and confirm the number:

```bash
$B $S/mesh.py -- ortho work/body_prop.blend neck --at 0.0,0.44 --scale 0.30 --outdir renders
```

Then draw labelled lines at known z using the mapping the renderer prints. This
one diagnostic settled in a single image what four rounds of judging renders
could not.

### Remove the head by connectivity, not by radius

A cylinder around the neck axis must be wide enough to swallow the nose and
chin, which reach further **forward** than a quiver's arrows sit **sideways**.
On one figure the chin reached 0.085 from the axis and the arrows started at
0.099: a gap that looks workable until the plane moves and it closes. Tapering
the radius toward the neck, to avoid leaving a shelf, made it strictly worse by
dropping the radius to 0.0595 exactly where the chin is.

Connectivity has no such tension. Cut low in the neck, group the faces above the
plane into connected islands, and delete the one whose vertices reach highest:
the crown of the skull. On that figure the head was one island of 167,962 faces
and the arrows were four separate islands, untouched. No parameter to tune, and
nothing to re-measure after a reshape.

The limit: connectivity only separates what is genuinely disconnected. A bust's
collar is **joined** to its neck, so that cut stays geometric.

### Trim the bust to head plus a neck column

A bust is head, neck, shoulders, collar and often a plinth. Dropped whole onto a
body it gives the figure two sets of shoulders inside each other. A horizontal
plane below the neck is not enough either: it slices the bust's chest, and that
wide cut edge pokes out through the body's surface.

Keep the bust whole above its own neck; below that keep only a narrow column
around the neck axis. Measured on one bust: neck radius 0.035 to 0.05, collar
flaring to 0.13, so a column of 0.055 separated them.

### Running it

```bash
$B $S/assemble.py -- graft work/body_socket.blend work/head_clean.blend \
   work/aligned.blend --head-scale 0.94 --head-voxel 0.0011 \
   --cut-z 0.398 --head-trim --head-overlap 0.045 --height-mm 200
```

`--cut-z` is the verified neck height. Leave it off to fall back to
`--cut-drop` below the detected neck, but verify either way.

**`--head-voxel` is in final figure units.** Scale is applied before the remesh,
so the value is used directly. Dividing it by the scale is a bug that produces a
head remeshed far too fine, which reads as noise after the fuse.

### Shrinkwrap detail transfer is not an alternative

Worth knowing before you spend a session on it. Deforming the body's own head onto
the high-detail bust looks like it should avoid every cutting failure above, and
it does: all attempts stay watertight with the face count unchanged, because
moving vertices cannot break topology. The quality fails instead.

| Attempt | Result |
|---|---|
| Whole head, nearest-surface | head collapsed into folded facets |
| Whole head, normal projection, 2.4 mm limit | face smoother, hair and ears shredded |
| Face only, nose-aligned, 1.6 mm limit | real detail, hard tear seams at the patch edge |

Shrinkwrap projects each vertex independently and has no notion of
**correspondence**: nothing says a vertex is the corner of the mouth on both
meshes. Where the silhouettes disagree, vertices land on unrelated geometry; at
the edge of a weighted region, neighbours move different distances and the
surface tears. Narrowing the region moves the tears, it does not remove them.

The real obstacle, for grafting and for this, is that the two meshes share no
topology. The ways out are a head model with known topology fitted to the
portrait, which is also the only route to genuinely open eyes, or accepting the
reconstruction's face.

### Cap every cut, and gate on watertight

Deleting faces leaves an open shell. A voxel remesh builds a signed distance
field and needs a closed surface to tell inside from outside; an open one comes
back as thin lacy walls **across the whole component**, not just near the cut.
That shows up as shredded hair a long way from the seam and reads as a
reconstruction problem rather than a cutting one.

Cap after every cut and refuse to continue if the part is not watertight. The
gate is worth more than the cap: it converts a confusing cosmetic failure three
steps later into a clear error where the mistake happened.

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

### Coarser smooths, but it also DESTROYS

The rule above is only half of it, and the missing half cost a whole rebuild. A
remesh cannot represent anything finer than its voxel, so detail below that size
is not smoothed away, it is broken into fragments. On the plate knight the
transferred head's hairline came through the transfer perfectly and came out of
a 0.0022 fuse as shrapnel: an obvious ring of holes across the forehead. The
mesh still reported watertight, single-shell, and a *better* dihedral spread
than before, because a field of small fragments is closed and locally smooth.

The numbers cannot catch this. Render the head before and after any fuse.

### Do not remesh the whole figure to attach a primitive

```bash
$B $S/assemble.py -- fuse work/figure.blend work/based.blend \
   --method boolean --height-mm 200
```

A base is a cylinder. Resampling every surface on the figure to attach one is
both wasteful and destructive, and it is what shattered the hairline above. The
boolean path only rewrites geometry near the seam, so the rest of the figure
arrives untouched.

Use `--method remesh` when merging genuinely organic parts, where the boolean
solver is unreliable. Use `--method boolean` for a base, a peg or a plinth.
Known cost: an exact union leaves a handful of non-manifold edges at the seam
that `fill_holes` does not clear. That is an open problem, recorded in the
homelab backlog under assembly hardening.

### Better still: do not attach the base at all

```bash
$B $S/assemble.py -- base work/figure.blend work/keyed_base.blend \
   --radius-mm 48 --thickness-mm 8 --sink-mm 3 --bevel-mm 1.5 \
   --recess --clearance-mm 0.2 --height-mm 250
```

`--recess` cuts the figure's own footprint into the plinth top and leaves the
two as **separately printed parts that key together**. Nothing touches the
figure at all: no remesh, no seam, no non-manifold edges. A plinth is a separate
part in most miniature workflows anyway, and stage 7 exports it as one. On the
plate knight the fit came out at 1 interfering vertex in 15,115.

Two things it will catch you on, both measured on that figure:

- **Size the disc off the real footprint, not the figure's width.** At 34 mm
  radius the boots ran past the rim and the recess cut the disc into three
  pieces. A vertex scan below the ankles gave 73.2 x 50.9 mm, extreme radius
  36.6 mm, so 48 mm was the first comfortable disc.
- **Armour is hollow, so the recess isolates a plug.** A reconstructed sabaton
  is a thin lame, not a solid, so differencing it leaves the plinth material
  inside the boot outline free-floating: two islands, 6.2k faces each, 1.9 mm
  thick. `base --recess` drops whatever the recess isolates, then refuses to
  save unless the result is one watertight shell.

Export the base with `--height-mm` set to **the plinth's own height in the
figure's frame**, not the figure's height. `export` scales an object so its own
height matches the number given, so the plinth's own height is what puts both
parts at one consistent scale.

Verify before going on:

```bash
$B $S/mesh.py -- render work/figure.blend fig --outdir renders
python3 $S/sheet.py renders/fig_sheet.png renders/fig_{front,q45,side,back}.png
```

## Eyes

**Precondition: run this on a mesh under about 850k faces.** Both booleans here
are exact, and past some size the solver stops editing the mesh and consumes it
instead. `sculptlib.boolean` catches that and restores the mesh, so the failure
is loud rather than silent, but the operation still does not happen.

Measured on one figure, so treat the boundary as a rough guide and not a
constant:

| Faces | Aperture DIFFERENCE | Eyeball UNION |
|---|---|---|
| 1,134,577 | succeeds, leaves 184 non-manifold edges | **collapses to 18 faces** |
| 847,500 | clean | clean |
| 638,632 | clean | clean |

If the mesh is too dense, bring it down with **`mesh.py decimate`, not a voxel
remesh**. Decimation costs surface smoothness and keeps the silhouette; a remesh
resamples every feature on the figure and is what shredded the transferred
hairline.

```bash
$B $S/mesh.py -- decimate work/figure.blend work/fig_d.blend --faces 660000 --height-mm 250
```

The collapse decimator will not always reach the target on a dense triangle
mesh, and that is fine: asking for 660k landed at 847,500, which worked.

Image-to-3D cannot produce open eyes. It carves a shallow slit where the lids
meet and leaves the socket flat, so the face reads as asleep at any
magnification. No resolution setting changes this.

Setting a sphere in the socket is **not** enough on its own. It buys volume but
the face still reads heavy-lidded, because nothing defines where the lid ends and
the eye begins. Do it in two steps, the way a sculptor would:

1. **Carve an almond hollow** into the socket. The rim of that hollow is what
   reads as the eyelid, and it is what makes the eye look open.
2. **Set a sphere behind it** as the eyeball. Paint supplies the iris.

Find the sockets from the geometry:

```bash
$B $S/assemble.py -- findeyes work/figure.blend \
   --x-range=-0.095,0.075 --z-range 0.395,0.465
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
   --at-z 0.4694 --centre-x 0.0085 --dx 0.0205 \
   --aperture-w-mm 2.0 --aperture-h-mm 1.05 --aperture-d-mm 1.2 \
   --radius-mm 1.55 --set-mm 1.9 --union --height-mm 200
```

Four things decide whether this reads as an eye or as a deformity:

- **The eyeball must be TALLER than the aperture**, so keep `--radius-mm` above
  `--aperture-h-mm`. That is what lids are: the opening shows only a band of the
  eyeball. If the aperture is taller, no rim shows and the eye is not open.
- **`--set-mm` is positive.** The figure faces -Y, so smaller y is further
  forward, and this is how far *behind* the surface the eyeball centre sits. A
  negative value pushes the eyeball out through the face as a dome on the brow.
- **Probe tight.** `--probe-spread` defaults to 0.0015 for a reason: sampling
  wider catches the brow ridge and nose, which sit forward of the lids, so the
  eyeball is placed against a surface that is too far forward and bulges.
- **Each socket keeps its own depth, clamped** by `--max-diverge`. Forcing one
  depth on both sinks the shallower eye into a pit, because a reconstructed face
  is genuinely a little asymmetric. Letting them float free lets hair skew one.

Expect to iterate on `--at-z` and `--dx` against an ortho render. Being 0.8 mm
high puts the eyes on the brow.

### Closing the eyeballs into the figure: use `--union`

The eyeballs arrive as separate shells sitting in the sockets, which is three
printed parts, so something has to close them. There are two ways and they are
not equivalent.

**`--union` (prefer this).** A local boolean per eyeball. Costs 2,744 faces and
touches nothing else on the figure. It collapses on a very dense mesh, which is
why the face-count precondition above exists, but the collapse guard makes that
an error rather than silent destruction.

**`--refuse-voxel` (fallback).** Remeshes the *whole figure* at the given voxel.
It always works and it always costs every feature finer than that voxel — on the
plate knight that meant the transferred hairline. Reach for it only when the
mesh is too dense to union and too fragile to decimate.

The default is still a plain join with neither, which leaves three shells. That
is deliberate: it fails the print gate loudly rather than quietly picking one of
the two costs for you.

If `--union` reports more than one shell afterwards, the eyeball is not touching
the lid. Raise `--radius-mm` or lower `--set-mm`.

## Verification discipline

Run `check` output past your eyes after every step, and a clay render after the
fuse. When a final mesh is bad you want to know which operation broke it, and
the only way to know that cheaply is to have measured after each one. These
operations take minutes each; finding out at the end costs a whole rebuild.
