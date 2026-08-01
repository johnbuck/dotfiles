---
name: pnk-sculpt
description: >-
  End-to-end pipeline for turning a character description into a finished 3D
  model: define the subject, generate or screen a reference image, reconstruct
  it with image-to-3D, clean the mesh to a watertight solid, assemble parts,
  rig and pose, and export print or game-asset files. Use this whenever the user
  wants a 3D model, a miniature, a figurine, a printable character, a bust, a
  statue, a tabletop mini, a game-ready character, or asks to "model", "sculpt",
  "generate in 3D", or "make a print" of a person, creature or character, even
  if they do not name a tool. Also use it when they hand you a picture and ask
  for a 3D version of it. Covers TRELLIS / image-to-3D reconstruction, headless
  Blender mesh repair, watertight and manifold problems, voxel remeshing,
  head grafting, Rigify rigging and posing, part splitting, and STL/3MF export.
  Individual stages are separate pnk-sculpt-* skills; start here for the whole
  job and jump to a stage skill only when redoing one step.
---

# pnk-sculpt

Turns a character description into a finished model. The hard part is not any
one step, it is that a fault introduced early is invisible until much later and
expensive to fix, so each stage validates before handing on.

## The pipeline

| Stage | Skill | Produces |
|---|---|---|
| 1. Brief | `pnk-sculpt-brief` | `brief.md`, `run.json`: what is being built, at what size, in how many parts |
| 2. Reference | `pnk-sculpt-reference` | `ref/*.png`: a reconstruction-friendly image per part |
| 3. Reconstruct | `pnk-sculpt-reconstruct` | `raw/*.glb`: image-to-3D output plus its diagnostics |
| 4. Mesh | `pnk-sculpt-mesh` | `work/*_clean.blend`: watertight, single-shell |
| 5. Assemble | `pnk-sculpt-assemble` | `work/figure.blend`: head grafted, sockets cut, parts fused, eyes set |
| 6. Rig | `pnk-sculpt-rig` | posed-and-baked solid, or a rigged asset |
| 7. Print | `pnk-sculpt-print` | `out/*.3mf`, `*.stl`, `*.glb`, `AS-BUILT.md` |

Stages 5 and 6 are optional. A single-piece unposed figure goes 1-2-3-4-7.

**If the figure will be posed, stage 5 splits around stage 6.** Fuse the body
and head, rig, pose and bake, and only then add the base, any rigid props and
the eyes. Automatic weights are assigned by proximity, so a plinth fused on
before rigging gets weighted to the leg bones and is dragged into a warped
sliver the moment a leg moves.

Read the stage skill before running that stage. Each one carries the failure
modes that stage actually hits, and most of them are counterintuitive enough
that you will not guess them.

## Run it to completion

The default is to run the whole thing without stopping. Stop only for a genuine
fork, a hard failure, or a judgment call that is really the user's: which
reference image to use, whether a face is good enough, what pose. Everything
technical proceeds on its own evidence, because each stage prints numbers you
can act on.

## Set-up, once

```bash
mkdir -p ~/.config/pnk-sculpt
cp <this-skill>/scripts/config.example.json ~/.config/pnk-sculpt/config.json
# then edit it: GPU host, TRELLIS paths, and the service to stop for VRAM
```

The config sits outside the repo because hostnames are site-specific. If it is
missing, `trellis.py` says so and stops rather than guessing.

## Project layout

Everything for one figure lives in one directory. Keep it, because the raw
reconstruction is what you go back to when a later stage goes wrong, and
re-running it costs a GPU window.

```
<project>/
├── brief.md          the subject, fully specified
├── run.json          scale, preset, part plan, chosen settings
├── ref/              reference images, including rejected candidates
├── raw/              reconstruction output + logs
├── work/             .blend intermediates
├── renders/          QA contact sheets
└── out/              deliverables + AS-BUILT.md
```

## The scripts

All in this skill's `scripts/`. Stage skills tell you which to call and with
what. They run headless because these operations take minutes and would time
out an interactive Blender session, leaving you unsure whether it died.

| Script | Runs under | Does |
|---|---|---|
| `trellis.py` | host python | reconstruction on the GPU host, VRAM window, log diagnosis |
| `genref.py` | host python | reference image generation via OpenRouter |
| `sheet.py` | host python | contact sheets and measuring grids (needs Pillow) |
| `mesh.py` | blender | analyze, clean, landmarks, thickness, reshape, render, ortho |
| `assemble.py` | blender | socket, graft, base, fuse, eyes, findeyes |
| `prop.py` | blender | swept hard-surface props, locating pegs |
| `rig.py` | blender | metarig, generate, pose, bake, export |
| `printprep.py` | blender | gate, survey, split, export |
| `sculptlib.py` | blender | shared library, imported by the rest |

Blender invocation is always:

```bash
blender --background --factory-startup --python <script>.py -- <command> [opts]
```

`--factory-startup` matters: a user's saved preferences can change units,
add-ons and the default scene, which silently changes results.

## Three ideas that decide whether this works

**Higher resolution is often worse.** The reconstructor decimates to a fixed
face budget regardless of the resolution you asked for. Raising resolution
raises what goes into the decimator without raising the budget, so on a complex
subject the surface is shredded. A ratio near 30:1 has produced clean meshes;
near 100:1 produced lace. `trellis.py diagnose` computes it and says so.

**Decompose the subject.** Reconstruct the body, the head and each held prop
separately, then assemble. In a full-body reference the head occupies a few
percent of the frame, so after downsampling the face has almost no pixels and
comes out as a blank mask. A separate bust portrait gives the face the whole
frame. Long thin props are better built parametrically than reconstructed at
all. This is the single biggest quality lever in the pipeline.

**Measure, never guess.** Every coordinate typed by hand in the original build
of this pipeline was wrong at least once, and the errors were only visible after
a slow step had run. `mesh.py landmarks` finds the neck, hips and hands from
the silhouette; `mesh.py ortho` plus `sheet.py --grid` converts a pixel to an
exact world coordinate; `assemble.py findeyes` locates eye sockets from the
geometry. Use them.

## Jumping in mid-pipeline

Ask what the user actually has and start from the first stage that needs
redoing. Common entry points:

- "the face is bad" → stage 2 for a bust reference, then 3, 4 and the graft in 5
- "it has holes" → stage 4, and check the stage 3 diagnostics for why
- "make it printable" → stage 7, gate first
- "pose it" → stage 6
- "I have this picture" → stage 2 to screen it, then onward

## Honest limits

- Open, alert eyes are not achievable from image-to-3D. It carves a slit and
  leaves the socket flat. Stage 5 sets eyeball spheres in the sockets, which is
  what miniature sculptors do, and gets volume but not a wide gaze.
- The back of a single-view reconstruction is invented. It is plausible, not
  real. Nothing downstream fixes that; only more views would, and this
  reconstructor takes one image.
- Rigging on voxel topology is the weakest stage. There are no edge loops at
  the joints, so automatic weights bleed across them. Expect to work in the GUI
  for anything beyond a modest pose. Stage 6 says more.
- Reconstructions come out short and wide, typically 6.5 to 7 heads rather than
  the 8 that reads as heroic. `mesh.py landmarks` reports the ratio and
  `mesh.py reshape` corrects it, before anything is grafted on.
