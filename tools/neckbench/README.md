# neckbench

A benchmark for finding the **neck** of a standing humanoid mesh: the height
where the head meets the body. Built for the `pnk-sculpt` pipeline, whose
production detector was landing on the **jaw** and leaving a figure with two
chins after a head cut.

Generated `.blend` cases and the large probe JSONs are not committed; they are
reproducible from `synth.py` and `audit/probe.py`.

```bash
B="blender --background --factory-startup --python"
for c in $($B synth.py -- list | tail -1); do $B synth.py -- $c cases/$c.blend; done
$B audit/probe.py -- cases audit/probe.json      # exact plane-section profiles
python3 gt.py audit/probe.json ground-truth.json # answer key
$B bench.py -- cases --json results.json
```

## Read this before believing any result it prints

**This benchmark has produced a confident, wrong answer three times.** It is kept
because that history is more useful than its leaderboard, and because the same
traps recur in any measured comparison. Every one of these passed my own review
and was caught only by an adversarial agent told to assume the benchmark was
broken.

1. **The answer key was asserted, not measured.** `NECK_Z = (shoulder + chin)/2`
   sat *below* the mesh's real narrowest span and was wrong by 3-4x the section
   area on the five cases where a collar buries the neck. Correcting it reversed
   the leaderboard.
2. **The replacement key was one candidate's own algorithm.** `gt.py::derive`
   and detector C's `local_minima` + `_plateau` were the same procedure line for
   line, so C was scored against itself. Strip its confidence flag and it ties
   the detector it "beat". The docstring asserting the key shared no assumptions
   with the detectors was written while fixing trap 1.
3. **The scoring rewarded a strawman.** A detector returning a constant and
   always flagging low confidence scored zero bad answers, tying the winner. The
   ranking was being read off a column that a constant could win.

Three more that changed results without changing any method:

- **Band count past the mesh's sampling limit.** At `nbands=300` against a
  median edge of 0.0039, bands under-sample the section ring; a band surviving
  on a few stray vertices reads narrower than its properly sampled neighbours.
  At 250 bands one detector goes from 10/1/2 to a perfect 13/0/0.
- **A single unjustified threshold decided the winner.** `MIN_PROM=1.25`; move
  it to 1.10 and a different detector wins outright.
- **Cases that look like tests and are not.** `cape` was byte-identical to
  `plain` through two attempted fixes (Blender's `primitive_cube_add` takes
  half-extents, and the slab then landed inside the torso). `jaw_trap`, the one
  case the whole exercise exists for, was built to a 0.0001 margin and landed
  the wrong side.

## Rules that fall out of the above

- Derive ground truth by measurement, from code that shares nothing with any
  candidate. If you cannot, say the benchmark cannot decide.
- Always include a strawman. If a constant ties your winner, the scoring is
  measuring the wrong thing.
- Sweep every constant you did not justify, and report the leaderboard as a
  range over it.
- Verify each case actually reproduces its failure before trusting it. A case
  that inflates a metric without moving its argmin tests nothing.
- Emit one scalar. A human choosing which column to read is a degree of freedom.

## Current state

`B_area_min` was chosen for production on aggregate reliability across 18
sampling and yaw conditions (6 bad in 234 gradings, never more than one in any
condition, never bad on 12 of 13 figures, rotation-stable where width is not),
**not** on this benchmark's headline ranking, which is not yet trustworthy.

Remaining work is tracked in the homelab backlog under
`2026-08-01-pnk-sculpt-neck-detection.md`.
