---
name: pnk-sculpt-brief
description: >-
  Stage 1 of the pnk-sculpt 3D pipeline. Turns a loose character idea into a
  fully specified build brief: silhouette, costume, proportions, pose, print
  scale, part decomposition and rig plan, written to brief.md and run.json. Use
  this when someone asks for a 3D model, miniature or figurine and has given
  only a sentence or two, when they say "make something amazing" without saying
  what amazing means, or whenever a model needs defining before any image is
  generated. Also use it to write down decisions about scale, how many separate
  printed parts a figure needs, and whether it will be posed. Do not skip it:
  the reference-image stage needs a concrete description, and the print stage
  needs the scale decided before anything is reconstructed.
---

# Stage 1: brief

A vague brief costs a GPU window. "A beautiful elven archer" gives the image
model nothing to be specific about, so it invents, and by the time the model is
wrong you have spent an hour of reconstruction on the wrong subject.

The output is two files in the project directory: `brief.md` for humans and
`run.json` for the scripts.

## Decide these, in this order

Later answers depend on earlier ones. Scale in particular changes what detail is
even physically possible, so it cannot be deferred.

### 1. Scale and preset

| Preset | Height | Feature floor | What it means |
|---|---|---|---|
| `tabletop` | 28-32 mm | 0.5 mm | Gaming mini, resin. Anything under about 3 mm at display scale vanishes here. No bowstrings, no loose straps, no individual hair strands. |
| `display` | 150-250 mm | 0.8 mm | Most detail survives. Thin props still print better separately. |

The floor is not a style choice, it is whether the feature forms at all. A 1 mm
bowstring on a 200 mm figure is 0.14 mm at 28 mm and will not exist.

### 2. Silhouette and proportions

Read at arm's length, this is what identifies the figure. Specify:

- Height in heads. 7.5 to 8 reads heroic; 6.5 reads stocky. Reconstructions come
  out short, so state the target and expect to correct it in stage 4.
- Build: slender, athletic, heavy.
- The one shape that makes the silhouette recognisable: a long cloak, a
  distinctive headdress, a hunched posture.

### 3. Costume, part by part

Go top to bottom and name material as well as shape, because material decides
how the surface reads: metal armour, tooled leather, heavy cloth, fur. Vague
costume is where generated references drift most.

Flag anything thin as you go. Straps, ribbons, chains, cords, tassels, capes
with free edges: each is either thickened, omitted, or promoted to a separate
part.

### 4. Face

Say what the face should convey, not just that it should be beautiful. Age,
expression, eye shape, brow, jaw, ear form.

Then decide: does this face warrant a separate bust reconstruction? For anything
where the face is the point, yes. It is roughly a tenfold detail increase and
costs one extra reference image and one extra reconstruction.

### 5. Pose

- **Reconstruction pose**: always a relaxed A-pose with arms clear of the body
  and empty hands. This is not the final pose, it is the pose that reconstructs
  cleanly. Limbs touching the torso fuse into one mass.
- **Final pose**: if the figure will be posed, describe it here, and note that
  posing costs surface detail because the mesh is re-remeshed after the pose is
  baked in.

### 6. Part plan

Each part is a separate reference image and a separate reconstruction, or a
parametric build. Decide now:

| Part | How it is made | Why |
|---|---|---|
| Body | reconstruct from a full-body reference | the bulk of the figure |
| Head | reconstruct from a bust reference | the face needs the whole frame |
| Held props | build parametrically with `prop.py` | long thin regular things reconstruct badly |
| Base | generated in `assemble.py base` | a plinth is a cylinder, not a sculpture |

Also decide whether the printed figure is split into keyed parts. Stage 7 can
survey the figure and tell you where a cut is clean, so the answer here is just
whether you want one at all.

### 7. Rig plan

One of three: not rigged; rigged to pose then baked back to a solid for
printing; or delivered as a rigged asset with the armature intact. The third
changes the whole pipeline's priorities, because a rigged asset wants low poly
counts and intact UVs, and a print wants neither.

## Write the files

`brief.md` in plain language, structured by the sections above, so someone can
read it cold and know what is being built.

`run.json` for the scripts:

```json
{
  "name": "elven-archer",
  "scale_preset": "display",
  "height_mm": 200.0,
  "min_feature_mm": 0.8,
  "target_heads": 8.0,
  "parts": [
    {"id": "body", "method": "reconstruct", "ref": "ref/body.png"},
    {"id": "head", "method": "reconstruct", "ref": "ref/bust.png"},
    {"id": "bow",  "method": "parametric",  "spec": "bow.json"},
    {"id": "base", "method": "generated"}
  ],
  "rig": "none",
  "split": {"enabled": true}
}
```

Later stages append what they chose (resolutions, voxel sizes, measured
landmarks) so `run.json` ends up being the as-built record that stage 7 turns
into `AS-BUILT.md`.

## Ask, briefly, only about what changes the work

Scale, whether the face matters enough to warrant a separate bust, and whether
it gets posed. Those three genuinely change the pipeline. Costume details and
colour do not: make a reasonable choice, write it in the brief, and let the
reference candidates be the conversation about taste.
