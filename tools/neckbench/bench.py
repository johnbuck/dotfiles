"""Score every neck detector against every synthetic case.

    blender --background --factory-startup --python bench.py -- <casedir> [--json out.json]

Prints, and optionally writes, a table of absolute errors in Blender units on a
figure 1.0 tall. 0.01 is one percent of body height, which on a 200 mm print is
2 mm; a neck cut wrong by more than about 0.02 leaves a visible defect.

Scoring is numeric on purpose. The whole reason this file exists is that judging
a detector by looking at a render is not reliable.
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.expanduser("~/.claude/skills/pnk-sculpt/scripts"))
from detectors import DETECTORS  # noqa: E402
from sculptlib import clear, append_object  # noqa: E402

# Ground truth is MEASURED per mesh (see ground-truth.json, derived from exact
# plane sections), not asserted as a constant. The first version of this file
# declared one neck height for every case; an audit showed it sat below the true
# span on the easy cases and was flatly wrong on five, and that correcting it
# reversed the leaderboard. A benchmark with a guessed answer key measures
# itself.
GT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "ground-truth.json")

# Tolerance is set by the instrument, not by taste. Detectors return band
# centres, so quantisation is half a band; and the geometry's own plateau is
# ~0.015 wide, meaning two answers inside it are indistinguishable. Error is
# therefore distance to the INTERVAL, and the threshold sits one band above it.
TOL_GOOD = 0.010
TOL_OK = 0.020


def score(gt, r):
    """Grade one answer. Returns (bucket, error, note).

    Declining is graded, not tallied separately. Where no waist exists it is the
    CORRECT answer and scores good; where one does exist it is safe but useless
    and scores ok. A confident wrong answer is always worse than either, because
    a wrong neck silently ruins several slow stages downstream.
    """
    if r is None:
        return ("ok", 0.0, "declined; detectors are expected to answer")
    low = bool(r.get("low_confidence"))
    if not gt["waist"]:
        # No waist exists in the geometry. Since detectors always answer, the
        # correct behaviour is to answer AND say the answer is untrustworthy.
        # Flagging it is the whole job here; the number itself is unscoreable.
        return ("good", 0.0, "flagged as low confidence, correctly") if low \
            else ("bad", 0.0, "confident answer where no waist exists")
    z = r["neck_z"]
    err = 0.0 if gt["z_lo"] <= z <= gt["z_hi"] else \
        min(abs(z - gt["z_lo"]), abs(z - gt["z_hi"]))
    b = "good" if err <= TOL_GOOD else ("ok" if err <= TOL_OK else "bad")
    if low and b == "good":
        b = "ok"                      # right, but it told you not to trust it
    return (b, err, "low confidence" if low else "")


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    casedir = a[0]
    out_json = a[a.index("--json") + 1] if "--json" in a else None
    GT = json.load(open(GT_PATH))

    cases = sorted(f[:-6] for f in os.listdir(casedir) if f.endswith(".blend"))
    names = list(DETECTORS)
    results, tally = {}, {n: {"good": 0, "ok": 0, "bad": 0} for n in names}

    print("\nerror = distance to the mesh's MEASURED narrowest span, 0 if inside")
    print(f"  good <= {TOL_GOOD}   ok <= {TOL_OK}\n")
    head = f"{'case':<15}{'waist':>7}" + "".join(f"{n:>21}" for n in names)
    print(head)
    print("-" * len(head))

    for case in cases:
        clear()
        obj = append_object(os.path.join(casedir, case + ".blend"),
                            prefer="Figure", newname="Figure")
        gt = GT[case]
        results[case] = {"gt": gt, "detectors": {}}
        row = f"{case:<15}{('yes' if gt['waist'] else 'NO'):>7}"
        for n in names:
            try:
                r = DETECTORS[n](obj)
            except Exception as e:  # noqa: BLE001
                results[case]["detectors"][n] = {"exception": repr(e)}
                tally[n]["bad"] += 1
                row += f"{'EXCEPTION':>21}"
                continue
            b, err, note = score(gt, r)
            tally[n][b] += 1
            results[case]["detectors"][n] = {
                "bucket": b, "err": round(err, 4), "note": note,
                "answer": None if r is None else round(r["neck_z"], 4),
                "raw": None if r is None else {k: (round(v, 4)
                                                   if isinstance(v, float)
                                                   else v)
                                               for k, v in r.items()},
            }
            cell = "declined" if r is None else f"{r['neck_z']:.3f} e={err:.3f}"
            mark = {"good": "", "ok": "~", "bad": "!!"}[b]
            row += f"{cell} {mark}".rjust(21)
        print(row)

    print("\nsummary")
    for n in names:
        t = tally[n]
        print(f"  {n:<20} good {t['good']:>2}  ok {t['ok']:>2}  BAD {t['bad']:>2}")
    if out_json:
        json.dump(results, open(out_json, "w"), indent=2)
        print(f"\nwrote {out_json}")


if __name__ == "__main__":
    main()
