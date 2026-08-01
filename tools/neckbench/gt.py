#!/usr/bin/env python3
"""Derive ground truth from each mesh, instead of asserting a constant.

    blender --background --factory-startup --python audit/probe.py -- cases audit/probe.json
    python3 gt.py audit/probe.json ground-truth.json

The first version of this benchmark declared NECK_Z = (SHOULDER_Z + CHIN_Z)/2
and scored every detector against it. An adversarial audit showed that constant
sat at the very BOTTOM EDGE of the mesh's actual narrowest span, and was simply
wrong on the five cases where a collar or pauldron buries the neck. Correcting
it reversed the leaderboard. A benchmark whose answer key is guessed is
measuring itself.

So the key is measured, from exact plane-section areas that share no code or
assumptions with the detectors. Ground truth is the INTERVAL over which the
section stays within 3% of its minimum, because a neck is a plateau and two
answers inside it are geometrically indistinguishable. Where no prominent
minimum exists at all, the truth is that there is no waist to find.
"""
import json
import sys

FLAT = 1.03          # within 3% of the minimum counts as the same plateau
MIN_PROM = 1.25      # below this the "waist" is not a waist
BAND = (0.60, 0.99)  # search the upper body


def derive(v):
    lo, hi, H = v["lo"], v["hi"], v["H"]
    m = [(z, a) for z, a, w in v["prof"]
         if a and a > 0 and BAND[0] <= (z - lo) / H <= BAND[1]]
    if len(m) < 20:
        return {"waist": False, "reason": "not enough profile", "H": H}
    best = None
    for k in range(1, len(m) - 1):
        a = m[k][1]
        if a > m[k - 1][1] or a > m[k + 1][1]:
            continue
        pl = a
        for j in range(k - 1, -1, -1):
            pl = max(pl, m[j][1])
            if m[j][1] < a:
                break
        pr = a
        for j in range(k + 1, len(m)):
            pr = max(pr, m[j][1])
            if m[j][1] < a:
                break
        prom = min(pl, pr) / a
        if best is None or prom > best[3]:
            best = (k, m[k][0], a, prom)
    if best is None:
        return {"waist": False, "reason": "no local minimum", "H": H}
    k, z, a, prom = best
    # Walk CONTIGUOUSLY. Scanning globally for "within 3% of the minimum" leaks
    # to the crown, where a head's section falls below the neck's and trivially
    # qualifies.
    i = k
    while i - 1 >= 0 and m[i - 1][1] <= a * FLAT:
        i -= 1
    j = k
    while j + 1 < len(m) and m[j + 1][1] <= a * FLAT:
        j += 1
    return {"waist": prom >= MIN_PROM, "z_lo": m[i][0], "z_hi": m[j][0],
            "z_mid": (m[i][0] + m[j][0]) / 2, "area": a, "prominence": prom,
            "width": m[j][0] - m[i][0], "H": H, "z_floor": lo,
            "reason": "" if prom >= MIN_PROM else f"prominence {prom:.2f}"}


def main():
    src, out = sys.argv[1], sys.argv[2]
    probe = json.load(open(src))
    res = {}
    for case in sorted(probe):
        gt = derive(probe[case])
        res[case] = gt
        if gt["waist"]:
            print(f"{case:<15} waist {gt['z_lo']:.4f}..{gt['z_hi']:.4f} "
                  f"mid {gt['z_mid']:.4f} width {gt['width']:.4f} "
                  f"prom {gt['prominence']:.2f}")
        else:
            print(f"{case:<15} NO WAIST ({gt['reason']}) "
                  f"-> a detector should flag low confidence")
    json.dump(res, open(out, "w"), indent=2)
    print(f"\nwrote {out}")


main()
