#!/usr/bin/env python3
"""Drive image-to-3D reconstruction on the GPU host, safely.

    trellis.py run --image ref.png --name body --res 1024
    trellis.py run --image bust.png --name head --res 512 --no-window
    trellis.py diagnose --log body.log

Runs on your workstation and reaches the GPU host over SSH. The point of it
being a script rather than a handful of ssh commands is the window: the GPU is
usually already full of a language model, and the sequence stop-service, run,
restart-service, verify-health has to complete even when the run fails. Doing it
by hand leaves the service down when something errors, which is exactly when you
are least likely to notice.

Two things this deliberately does NOT do.

It does not touch monitoring. Pause the relevant uptime monitors first, through
whatever tool you normally use, or you will page yourself. The skill text says
which ones.

It does not choose a resolution for you. Higher is frequently worse, for a
reason that is not obvious: the decimator targets a fixed face budget regardless
of resolution, so raising resolution raises what goes in without raising the
budget, and on a complex subject the resulting ratio shreds the surface. See
`diagnose`.

Configuration lives at ~/.config/pnk-sculpt/config.json (see config.example.json).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

CFG_PATH = os.path.expanduser("~/.config/pnk-sculpt/config.json")


def load_cfg(path=None):
    p = path or CFG_PATH
    if not os.path.exists(p):
        sys.exit(f"no config at {p}. Copy config.example.json from this "
                 f"skill's scripts/ directory and fill in your GPU host.")
    return json.load(open(p))


def sh(cmd, check=True, capture=True):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=capture,
                       text=True)
    if check and r.returncode != 0:
        sys.exit(f"command failed ({r.returncode}): {cmd}\n{r.stderr}")
    return r


def ssh_script(host, script, check=True):
    """Send a bash script over stdin.

    Stdin is not re-parsed by the remote login shell, so loops, $(...) and
    quoting all survive. Passing the same script as an ssh argument does not:
    the remote shell re-parses it, and if that shell is fish rather than bash
    the bash-only syntax fails in confusing ways.
    """
    r = subprocess.run(["ssh", host, "bash", "-s"], input=script,
                       capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"remote script failed ({r.returncode}):\n{r.stdout}\n{r.stderr}")
    return r


# ------------------------------------------------------------ vram window --

def window_stop(cfg):
    g = cfg.get("vram_guard")
    if not g:
        return False
    host = cfg["gpu"]["host"]
    print(f">> stopping {g['service']} to free VRAM", flush=True)
    ssh_script(host, f"""set -e
cd {g['compose_dir']}
docker compose stop {g['service']}
sleep 4
nvidia-smi --query-gpu=index,memory.free --format=csv,noheader
""")
    return True


def window_start(cfg):
    g = cfg.get("vram_guard")
    if not g:
        return
    host = cfg["gpu"]["host"]
    print(f">> restarting {g['service']}", flush=True)
    r = ssh_script(host, f"""set -e
cd {g['compose_dir']}
docker compose start {g['service']}
for i in $(seq 1 30); do
  s=$(docker inspect -f '{{{{.State.Health.Status}}}}' {g['service']} 2>/dev/null || echo none)
  [ "$s" = healthy ] && break
  sleep 4
done
echo "health=$s"
code=$(curl -s -o /dev/null -w '%{{http_code}}' {g['health_url']} || echo 000)
echo "probe={g['health_url']} -> $code"
""", check=False)
    print(r.stdout.strip())
    if "health=healthy" not in r.stdout:
        print("WARNING: the service did not report healthy. Check it before "
              "you walk away; the monitors are still paused.")


def free_vram(cfg):
    r = ssh_script(cfg["gpu"]["host"],
                   "nvidia-smi --query-gpu=index,memory.free "
                   "--format=csv,noheader,nounits")
    out = {}
    for line in r.stdout.strip().splitlines():
        idx, free = [x.strip() for x in line.split(",")]
        out[int(idx)] = int(free)
    return out


# -------------------------------------------------------------------- run --

def cmd_run(a):
    cfg = load_cfg(a.config)
    host = cfg["gpu"]["host"]
    gpu = a.gpu if a.gpu is not None else cfg["gpu"].get("index", 0)
    t = cfg["trellis"]
    weights = os.path.join(t["weights"], a.quant)
    remote_in = f"{t['io']}/input/{a.name}.png"
    remote_out = f"{t['io']}/output/{a.name}.glb"
    remote_log = f"{t['io']}/output/{a.name}.log"

    print(f">> uploading {a.image}", flush=True)
    sh(["scp", "-q", a.image, f"{host}:{remote_in}"])

    need = a.expect_vram_mb or {512: 3200, 1024: 7000, 1536: 9200}.get(
        a.res, 9200)
    have = free_vram(cfg).get(gpu, 0)
    print(f"GPU {gpu}: {have} MiB free, this run wants about {need} MiB")

    stopped = False
    if a.window is None:
        window = have < need
        if not window:
            print("   enough headroom, running alongside the existing load")
    else:
        window = a.window
    if window:
        stopped = window_stop(cfg)

    decim = f"--decim {a.decim}" if a.decim is not None else ""
    script = f"""set -u
export LD_LIBRARY_PATH="{t['runtime']}"
cd {t['io']}
: > "{remote_log}"
( while true; do
    nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits \
      | awk -F, -v g={gpu} '$1+0==g {{print $2}}'
    sleep 5
  done > "{remote_log}.vram" ) &
SAMPLER=$!
t0=$(date +%s)
"{t['runtime']}/trellis-cli" -i "{remote_in}" -o "{remote_out}" \
  -m "{weights}" --gpu {gpu} --res {a.res} --require-gpu {decim} \
  >> "{remote_log}" 2>&1
rc=$?
kill $SAMPLER 2>/dev/null || true
t1=$(date +%s)
peak=$(sort -n "{remote_log}.vram" 2>/dev/null | tail -1)
echo "RESULT rc=$rc seconds=$((t1-t0)) peak_vram_mib=${{peak:-?}}"
ls -l "{remote_out}" 2>/dev/null || echo "NO OUTPUT"
"""
    print(f">> reconstructing at res {a.res}, quant {a.quant}", flush=True)
    t0 = time.time()
    r = ssh_script(host, script, check=False)
    print(r.stdout.strip())
    print(f"   wall clock {time.time() - t0:.0f}s", flush=True)

    if stopped:
        window_start(cfg)

    if "NO OUTPUT" in r.stdout or "rc=0" not in r.stdout:
        tail = ssh_script(host, f"tail -40 {remote_log}", check=False)
        print("\n--- remote log tail ---")
        print(tail.stdout)
        sys.exit("reconstruction failed")

    os.makedirs(a.outdir, exist_ok=True)
    for remote, local in ((remote_out, f"{a.name}.glb"),
                          (remote_log, f"{a.name}.log")):
        sh(["scp", "-q", f"{host}:{remote}",
            os.path.join(a.outdir, local)], check=False)
    print(f"\nfetched into {a.outdir}")
    diagnose(os.path.join(a.outdir, f"{a.name}.log"))


# --------------------------------------------------------------- diagnose --

PATTERNS = {
    "active_voxels": r"active voxels[^0-9]*([0-9,]+)",
    "raw_faces": r"remesh[^0-9]*([0-9,]+)\s*faces",
    "floaters": r"([0-9,]+)\s*floater",
    "components": r"uv_bake:\s*([0-9]+)\s*component",
    "decimated": r"decimate[^0-9]*([0-9,]+)\s*->\s*([0-9,]+)",
}


def num(s):
    return int(s.replace(",", ""))


def diagnose(path):
    """Read the run log and say whether the result is worth cleaning up.

    The numbers that predict a good outcome are the decimation ratio and the
    floater count, not the resolution. A ratio near 30:1 has produced clean
    surfaces; near 100:1 has produced lace. Tens of thousands of floaters means
    the reconstructor could not find a coherent surface at all, which happens
    when the reference is photoreal enough that hair strands and skin texture
    land at voxel scale.
    """
    if not os.path.exists(path):
        print(f"(no log at {path})")
        return
    text = open(path, errors="ignore").read().replace("\r", "\n")
    found = {}
    for k, pat in PATTERNS.items():
        m = re.findall(pat, text, re.I)
        if m:
            found[k] = m[-1]

    print("\n--- reconstruction diagnostics ---")
    for k, v in found.items():
        print(f"  {k}: {v}")

    verdict = []
    if "decimated" in found:
        try:
            a, b = (num(x) for x in found["decimated"])
            ratio = a / max(b, 1)
            print(f"  decimation ratio: {ratio:.0f}:1")
            if ratio > 60:
                verdict.append(
                    f"ratio {ratio:.0f}:1 is high. The decimator targets a "
                    f"fixed face budget regardless of resolution, so this "
                    f"subject lost most of its surface. Re-run one resolution "
                    f"step LOWER.")
            elif ratio > 45:
                verdict.append(f"ratio {ratio:.0f}:1 is borderline; inspect the "
                               f"clay render carefully for holes.")
        except ValueError:
            pass
    if "floaters" in found:
        f = num(found["floaters"])
        if f > 20_000:
            verdict.append(
                f"{f} floating components. The reference was probably too "
                f"photoreal: hair strands and skin texture become voxel-scale "
                f"noise. Regenerate the reference as a smooth sculpted form, "
                f"and drop the resolution.")
        elif f > 5_000:
            verdict.append(f"{f} floaters is elevated but often recoverable by "
                           f"keeping the largest component.")
    if "components" in found and found["components"] != "1":
        verdict.append(f"{found['components']} components at bake time; a "
                       f"single coherent shell is what you want.")

    if verdict:
        print("\n  verdict:")
        for v in verdict:
            print(f"   - {v}")
    else:
        print("\n  verdict: numbers look healthy; proceed to mesh cleanup.")


def cmd_diagnose(a):
    diagnose(a.log)


def main():
    p = argparse.ArgumentParser(prog="trellis.py", description=__doc__)
    p.add_argument("--config", default=None)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run")
    r.add_argument("--image", required=True)
    r.add_argument("--name", required=True)
    r.add_argument("--res", type=int, default=1024, choices=[512, 1024, 1536])
    r.add_argument("--quant", default="f16", choices=["f16", "q8", "q4"],
                   help="f16 is the FULL model, not an upgrade path")
    r.add_argument("--decim", type=int, default=None,
                   help="leave unset. 0 disables the remesh chain entirely and "
                        "produces an unusable raw voxel decode")
    r.add_argument("--gpu", type=int, default=None)
    r.add_argument("--outdir", default="raw")
    r.add_argument("--window", dest="window", action="store_true", default=None,
                   help="force stopping the VRAM-holding service")
    r.add_argument("--no-window", dest="window", action="store_false")
    r.add_argument("--expect-vram-mb", type=int, default=0)
    r.set_defaults(fn=cmd_run)

    d = sub.add_parser("diagnose")
    d.add_argument("log")
    d.set_defaults(fn=cmd_diagnose)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
