---
name: pnk-sculpt-reference
description: >-
  Stage 2 of the pnk-sculpt 3D pipeline. Produces or screens the reference
  image that image-to-3D reconstruction will be run on, which is the single
  biggest determinant of the result. Generates candidates through OpenRouter
  image models using prompt templates tuned for reconstruction, and judges any
  image (generated or supplied) against the rules that decide whether it will
  reconstruct cleanly. Use this whenever a reference image is needed for 3D
  reconstruction, when someone hands you a picture and wants a 3D model of it,
  when a reconstruction came out shattered, blank-faced or fused, or when
  someone asks why their image-to-3D result looks bad. Also covers generating a
  matching bust portrait so a face can be reconstructed separately, and knowing
  when an image should be rejected before wasting a GPU window on it.
---

# Stage 2: reference

The reconstructor infers three-dimensional shape from shading in one image. Give
it an image that shades like a solid object and it does well. Give it beautiful
flat art and it has nothing to read.

Almost every disappointing result traces back to here rather than to the model
or its settings.

## The rules, and why each exists

Screen every image against these, whether you generated it or someone handed it
to you.

| Rule | Why |
|---|---|
| A 3D render, not an illustration | Depth comes from shading. Cel shading, ink outlines and flat colour fills carry almost no depth information. Painted concept art is the classic failure. |
| Even, soft, diffuse light | Hard shadows read as geometry that is not there; blown highlights erase geometry that is. |
| Arms clearly away from the body, legs apart | Anything touching fuses into one mass, and no cleanup separates it afterwards. |
| Hands empty | Held objects fuse to the hand and to each other. Props are built separately in stage 5. |
| The complete subject, inside the frame, with margin | A hard crop at the frame edge becomes an invented flat wall. |
| Plain empty background, no floor, no cast shadow | A ground shadow reconstructs as a slab attached to the feet. |
| Hair as solid masses, cloth as thick folds | Individual strands and thin fabric fall below voxel scale and become thousands of floating fragments. |
| Smooth sculpted forms, not photoreal | This is the one people resist. Photoreal skin pores and hair strands land at voxel scale and shatter the mesh. A smooth sculpt reconstructs cleanly; a gorgeous photo does not. |
| Eyes wide open | The reconstructor already tends toward closed, sunken eyes. Starting from open eyes gets you closer. |
| No thin protrusions | Bowstrings, ribbons, chains, antennae. Below the grid resolution they come out dotted or absent. |

## Generating candidates

Prompt templates are in this skill's `assets/`:

- `body-prompt.txt` for the full figure
- `bust-prompt.txt` for a matching head-and-shoulders portrait

Substitute the character description from `brief.md` for `{CHARACTER}`, keep
everything else, and generate several. Generation is cheap and a bad reference
is not.

```bash
S=~/.claude/skills/pnk-sculpt/scripts
A=~/.claude/skills/pnk-sculpt-reference/assets

sed "s|{CHARACTER}|$(cat character.txt)|" $A/body-prompt.txt > /tmp/body.txt
python3 $S/genref.py --out ref/candidates --prompt-file /tmp/body.txt -n 3 --stem body

python3 $S/sheet.py ref/candidates/sheet.png ref/candidates/body*.png --cols 3
```

Then look at the sheet and pick against the rules, not against which is
prettiest. A picture that would win on artistic merit routinely reconstructs
worse than a plainer one that obeys the rules.

## The bust, and keeping it the same character

Generate the bust **from** the chosen body image, not independently, or you get
two different people and the graft in stage 5 looks exactly as wrong as it is.

```bash
sed "s|{CHARACTER}|$(cat character.txt)|" $A/bust-prompt.txt > /tmp/bust.txt
python3 $S/genref.py --out ref/candidates --prompt-file /tmp/bust.txt \
        --ref ref/body.png -n 2 --stem bust
```

Two extra requirements for a bust beyond the general rules:

- **Smoother than you think.** A photoreal portrait is the most common cause of
  a shattered head. Hair should be a few large sculpted lobes.
- **A complete bust on a plinth**, not a portrait cropped at the chest. A crop
  forces invented geometry along a straight edge, which it does badly.

## Screening an image someone gave you

Walk the table above out loud and name specifically what fails. If it passes,
use it. If it fails on style only, the fix is usually to regenerate from it with
`--ref`, which keeps the character while fixing the presentation.

Reject rather than proceed when the subject is cropped, the arms are pressed to
the body, the hands hold something, or the art is flat and outlined. Those four
cannot be recovered downstream, and running anyway costs a GPU window and
produces something nobody wants.

## When the OpenRouter call returns no image

Two usual causes. The model may be text-only, so check that the id is an image
model. Or the account's data policy may block that provider: a zero-retention
setting refuses some models outright. Both are configuration, not code. Try a
different image model rather than relaxing a privacy setting.

The API key comes from `$OPENROUTER_API_KEY` or from `openrouter.key_command` in
`~/.config/pnk-sculpt/config.json`. `genref.py` captures it and never prints it.
Do not pass a key on a command line and do not run the script under shell
tracing: both put the value somewhere it can be read.

## What to record

Copy the chosen images to `ref/body.png` and `ref/bust.png`, and keep the
rejected candidates. When a reconstruction disappoints, the first question is
whether the reference was the problem, and you cannot answer that from a
deleted file.
