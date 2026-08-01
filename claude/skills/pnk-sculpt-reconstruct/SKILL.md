---
name: pnk-sculpt-reconstruct
description: >-
  Stage 3 of the pnk-sculpt 3D pipeline. Runs image-to-3D reconstruction
  (TRELLIS via trellis.cpp) on a GPU host, manages the VRAM window around a
  resident language model, and reads the run log to judge whether the result is
  worth cleaning up. Use this whenever an image needs converting to a 3D mesh,
  when choosing a reconstruction resolution, when a reconstruction came out
  shattered or full of holes, when a GPU is too full to run one, or when someone
  asks why a higher resolution made their model worse. Also covers the --decim
  flag trap, quantisation choices (f16 is the full model, not an upgrade),
  reading floater counts and decimation ratios, and safely stopping and
  restarting the service that is holding the GPU.
---

# Stage 3: reconstruct

One command per part. The judgement is entirely in choosing the resolution and
reading the log afterwards.

```bash
S=~/.claude/skills/pnk-sculpt/scripts
python3 $S/trellis.py run --image ref/body.png --name body --res 1024 --outdir raw
python3 $S/trellis.py run --image ref/bust.png --name head --res 512  --outdir raw
```

`trellis.py` uploads the image, checks free VRAM, opens a window if needed, runs,
restores the service, fetches the result and diagnoses the log.

## Pause monitoring first

The script deliberately does not touch monitors. A script that silences alerts
and then dies leaves them silenced. Pause the monitors listed under
`vram_guard.monitors` in your config yourself, run the reconstruction, then
resume them. If you use Uptime Kuma, `pnk-uptime-kuma` covers the calls.

## Choosing a resolution

Higher is frequently worse, which is the least intuitive thing in this pipeline.

The reconstructor decimates to a fixed face budget of roughly 300k regardless of
what resolution you asked for. Raising the resolution raises what goes into the
decimator without raising its budget, so the ratio climbs and the surface is
shredded. Observed:

| Subject | Resolution | Ratio | Result |
|---|---|---|---|
| Knight in solid plate | 1536 | 46:1 | clean |
| Elf with bow, sash, loose hair | 1536 | 101:1 | lace, holes everywhere |
| Same elf | 1024 | 27:1 | clean |
| Smooth bust portrait | 1024 | shattered, 31k floaters | unusable |
| Same bust | 512 | one clean component | good |

The limit is **subject complexity, not resolution**. A figure in solid armour
survives detail that a figure with a cape, a quiver and loose hair does not.

Start here and adjust on the diagnostics:

- Full body, simple silhouette: **1024**
- Full body, busy silhouette: **1024**, drop to 512 if the ratio exceeds 60:1
- Bust or head: **512**. A head fills the frame, so 512 already gives it more
  detail per feature than the body gets at 1024.

## The two flag traps

**`--decim 0` is not "keep all the detail".** It skips the whole dual-contouring
remesh chain, not just the decimation, leaving a raw voxel decode. Measured: 14%
of edges folded past 90 degrees against 2.6% for the default path, and on a bust
it produced 171,100 fragments that no cleanup could rescue. Leave `--decim`
unset.

**`f16` is the full model.** The quant names read like a quality ladder and are
not: f16 is the complete weights, and q8 and q4 are reductions of it. f16 at
1536 peaks around 8.7 GB, so on a 16 GB card there is no reason to use anything
else. q8 at 512 peaks around 2.9 GB, which is small enough to run alongside a
loaded language model with no window at all.

## Reading the diagnostics

`trellis.py` prints these automatically after a run, and `diagnose` re-reads a
saved log:

```bash
python3 $S/trellis.py diagnose raw/body.log
```

| Signal | Healthy | What a bad value means |
|---|---|---|
| Decimation ratio | under 45:1 | Over 60:1, drop one resolution step. The surface has been shredded. |
| Floating components | under ~5,000 | Tens of thousands means the reference was too photoreal. Fix the reference, do not fight the mesh. |
| Components at bake | 1 | More than one means it never found a coherent surface. |
| Peak VRAM | under the card | If it OOMs, drop resolution; there is no tensor-split to fall back on. |

Act on these before spending time in stage 4. Cleanup can close small holes; it
cannot reassemble a point cloud.

## The VRAM window

`trellis.py` compares free VRAM against what the resolution needs and only stops
the service if it must. Approximate needs on one card: 512 about 3.2 GB, 1024
about 7 GB, 1536 about 9.2 GB.

Force it either way with `--window` or `--no-window` when you know better.

The window closes on failure as well as success, so the service comes back even
when the run errors. After it restarts, the script probes the health endpoint;
if it does not report healthy, check before walking away, because your monitors
are still paused.

Spanning one reconstruction across two GPUs is not available. `--gpu N` selects
one card. Two cards buy you two concurrent runs, not one bigger run.

## What lands

`raw/<name>.glb` and `raw/<name>.log`. Keep both. The log is the only record of
what settings produced this mesh, and stage 7 copies its numbers into the
as-built record.

Expect the raw mesh to be open and multi-component. That is normal, and stage 4
exists to fix it. What stage 4 cannot fix is a mesh that arrived as fragments.
