---
name: pnk-sculpt-print
description: >-
  Stage 7 and final stage of the pnk-sculpt 3D pipeline. Gates a model against
  hard printability checks (watertight, single shell, wall thickness, build
  volume), surveys where a figure can be cut cleanly, splits it into keyed parts
  with locating pins, and exports 3MF, STL and GLB at true millimetre scale plus
  an as-built record. Use this whenever a model needs preparing for 3D printing,
  when someone asks if a mesh is printable or why a slicer rejected it, when a
  figure is too tall for the build plate or has features too thin to form, when
  a model must be split into printable pieces, or when export files are needed
  in mm. Covers the difference between 3MF and STL, minimum feature size at
  28 mm versus 200 mm, and safe decimation.
---

# Stage 7: print

Everything upstream optimises for looking right. This stage optimises for
physically existing, and the two disagree most about thin features.

```bash
S=~/.claude/skills/pnk-sculpt/scripts
B="blender --background --factory-startup --python"
```

## Gate first, and mean it

```bash
$B $S/printprep.py -- gate work/figure_eyes.blend --preset display --height-mm 200
```

Exits non-zero on any of:

- not watertight (holes or non-manifold edges)
- more than one shell
- zero or negative volume (inverted normals)
- the thinnest 1% of walls below the preset's floor
- largest dimension over `--max-dim-mm`, if you set a build volume

These failures are hard on purpose. Everything else in this pipeline is
forgiving; shipping a mesh with holes wastes someone's afternoon and a tank of
resin.

| Preset | Height | Floor | Reality |
|---|---|---|---|
| `tabletop` | 32 mm | 0.5 mm | Expect to omit bowstrings, loose straps and hair strands entirely. |
| `display` | 200 mm | 0.8 mm | Most detail survives; thin props still print better separately. |

The thickness number is an estimate from inward rays that only count hits on a
genuinely opposing wall. Without that filter every concave crease reads as
near-zero and the check is worthless. A p01 close to the floor is worth looking
at rather than accepting: it usually points at one specific feature, like a cape
edge or a sash tip.

### Read the clustering line before you react

The gate reports where the thin samples sit, and that decides which failure you
have:

- **"clustered: likely one specific feature"** — one fragile thing. Look at it.
  It is usually a cape hem, a sash tip or the hair, and you can often fix it
  alone.
- **"spread over the whole figure: this is surface detail"** — the model is
  simply finer than the floor everywhere.

On the plate knight, 46 of the 48 thinnest samples sat between 90% and 100% of
height within 12 mm of the midline: the hair on the crown, and nothing else. The
median wall was 0.927 mm and the armour was fine.

### A passing gate is not always the better mesh

That knight's *first* export passed at 0.826 mm. It passed because it had been
voxel-remeshed at 0.0022, and a remesh cannot produce a feature thinner than its
voxel. It passed by having already destroyed the detail.

The re-export from the detail-transferred mesh fails at 0.108 mm, and is the
better model by every other measure. Sub-floor **surface detail** prints soft
rather than crisp; sub-floor **structure** breaks or fails to form. The gate
cannot tell those apart, which is what the clustering line is for.

So `--force` is legitimate here, on two conditions: you have identified the
feature, and you write down in `AS-BUILT.md` what will print soft. Forcing
without naming the feature is just ignoring the gate.

### When the gate fails

- **Holes**: back to stage 4. Re-clean, usually one voxel step coarser.
- **Multiple shells**: something did not fuse. `analyze` reports the component
  sizes; if the extras are tiny, re-clean drops them.
- **Too thin**: three real options, and the user picks. Scale the whole figure
  up; thicken the offending feature; or promote it to a separate part that can be
  printed thicker and glued.
- **Inverted normals**: re-clean; the remesh rebuilds them consistently.

## Splitting into parts

Survey before you cut. A cut through the wrong height severs the forearms as
well as the torso, and the lower "half" arrives as three loose objects.

```bash
$B $S/printprep.py -- survey work/figure_eyes.blend --height-mm 200
```

Prints, for each candidate height, how many separate pieces the plane crosses
and how wide the largest is. On a standing figure the pattern is consistent:
legs separate low down, one blob at the hips, arms separate through the
mid-torso, one blob again at the chest. Pick a `GOOD` row.

```bash
$B $S/printprep.py -- split work/figure_eyes.blend out/parts \
   --height-mm 200 --at-frac 0.43 --pin-radius-mm 3 --pin-length-mm 6
```

Each part gets a locating pin and socket so the halves find their own alignment
instead of you eyeballing a glue joint on a curved organic surface. The socket
is cut oversize by `--clearance-mm`, because printers over-extrude and resin
swells; 0.15 to 0.25 mm is the useful range.

`split` refuses a multi-piece cut unless you pass `--force`. It also reports when
a resulting part contains several shells, which happens when a cape hem hangs
below the cut but attaches well above it. Those pieces are each watertight and
print fine, you just end up gluing them, so it is a decision rather than a fault.

## Export

```bash
$B $S/printprep.py -- export work/figure_eyes.blend out \
   --name elven_archer --height-mm 200 --formats 3mf,stl --lite-voxel 0.0025
```

Scales to true millimetres, sits the model on z=0, writes each format, and
re-checks health per file because a remesh that closes at one density can open at
another. Refuses to export a mesh that is not watertight unless you pass
`--force` and know why.

**3MF over STL where the slicer supports it.** 3MF records units and can carry
several parts in one file; STL is naked triangles with no declared scale, which
is how a 200 mm figure ends up printing at 200 inches. Keep STL as the universal
fallback and ship both.

`--lite-voxel` produces a second, lighter copy alongside the detailed one.
Slicers choke on a few million triangles, and the lite mesh is also what the rig
stage wants.

**Do not chase a face count at the cost of watertightness.** Blender's collapse
decimator can introduce non-manifold edges on a dense organic mesh. `sculptlib`
tries, attempts a repair, and reverts to the dense mesh if it still fails,
because face count is a convenience and watertightness is the contract. If you
see a "reverting" message, that is the system working.

## Textured GLB

If the brief asked for a viewable copy, export it from the **textured**
reconstruction in `raw/`, not from the print mesh. Voxel remeshing destroys UVs,
so the print mesh has no texture to carry.

## The as-built record

Write `out/AS-BUILT.md` before calling the job done. A good result that nobody
can reproduce is half a result, and the numbers are scattered across logs that
get deleted.

```markdown
# <name>: as built

## Delivered
| File | Faces | Size mm | Watertight |
|---|---|---|---|

## How it was made
- Reference: which model, which prompt template, which candidate and why
- Reconstruction: resolution, quant, decimation ratio, floater count, peak VRAM
- Mesh: voxel sizes, subdivision, final health numbers
- Assembly: head scale, head cut radius, fuse voxel, eye coordinates
- Rig: whether posed, which pose file, bake voxel

## What is short of the brief
Be specific and honest here. Face count over budget, proportions still off,
eyes not fully open, the back invented. This section is the most useful part of
the file.

## To reproduce
The exact commands, in order.
```

Pull the numbers from `run.json`, the stage 3 logs, and the health lines each
stage printed.

## Closing out

Delete the intermediates the user does not need: raw `.ply` byproducts, failed
reconstruction attempts, superseded `.blend` files. A finished project directory
is easily a gigabyte of things nobody will open again. Keep `raw/*.glb` and its
logs, the chosen references, the final `.blend`, the renders and `out/`.

Say what you actually delivered and what fell short. A model that is 7.3 heads
tall when the brief said 8, or whose eyes read heavy-lidded, is still a good
result, and the person receiving it should hear both parts from you rather than
discover the second one themselves.
