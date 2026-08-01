#!/usr/bin/env python3
"""Generate reference images for reconstruction, via OpenRouter.

    genref.py --out DIR --prompt-file p.txt --model google/gemini-3-pro-image -n 3
    genref.py --out DIR --prompt-file bust.txt --ref body.png -n 2

Two things make this different from asking for a nice picture.

First, the prompt is written for a reconstructor, not for a viewer. What the
reconstructor needs is volumetric shading, separated limbs, a complete
self-contained subject and no ground shadow. `prompts/` in this skill holds the
templates; pass one with --prompt-file and substitute the character description.

Second, --ref feeds an existing image back in, so a bust portrait can be
generated from the body reference and stay the same character. Generating them
independently produces two different people, and grafting one onto the other
then looks exactly as wrong as it is.

The API key is read from the environment or from a command, and is never
printed, logged, or passed as a command-line argument, because argv is visible
to any process on the machine.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://openrouter.ai/api/v1/chat/completions"
CROP = True


def get_key(env_name, key_command):
    k = os.environ.get(env_name)
    if k:
        return k
    if key_command:
        # Captured, never echoed. Do not add a print here, and do not run this
        # under `set -x`: a shell trace would put the key in the transcript.
        r = subprocess.run(key_command, shell=True, capture_output=True,
                           text=True)
        if r.returncode != 0:
            sys.exit(f"key command failed with status {r.returncode} "
                     f"(stderr suppressed to avoid leaking a partial value)")
        k = r.stdout.strip()
        if k:
            return k
    sys.exit(f"no API key: set ${env_name} or configure openrouter.key_command")


def data_url(path):
    ext = os.path.splitext(path)[1].lower().lstrip(".") or "png"
    if ext == "jpg":
        ext = "jpeg"
    with open(path, "rb") as f:
        return f"data:image/{ext};base64," + base64.b64encode(f.read()).decode()


def generate(key, model, prompt, ref=None, timeout=300):
    content = [{"type": "text", "text": prompt}]
    if ref:
        content.append({"type": "image_url",
                        "image_url": {"url": data_url(ref)}})
    body = json.dumps({
        "model": model,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": content}],
    }).encode()
    req = urllib.request.Request(
        API, data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        raise SystemExit(f"HTTP {e.code}: {detail}")


def autocrop(path, margin=0.08, portrait=0.62):
    """Crop a generated image down to the subject.

    Image models ignore aspect-ratio instructions: asking for portrait still
    returns 16:9, so a standing figure occupies the middle third and two thirds
    of the pixels are empty background. The reconstructor downsamples whatever
    it is given, so that wasted frame is resolution taken straight off the
    subject. Cropping is mechanical, so do it rather than re-prompting.
    """
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return path
    im = Image.open(path).convert("RGB")
    w, h = im.size
    bg = Image.new("RGB", im.size, im.getpixel((4, 4)))
    mask = ImageChops.difference(im, bg).convert("L").point(
        lambda p: 255 if p > 18 else 0)
    box = mask.getbbox()
    if not box:
        return path
    x0, y0, x1, y1 = box
    mh, mv = int((x1 - x0) * margin), int((y1 - y0) * margin * 0.6)
    x0, y0 = max(0, x0 - mh), max(0, y0 - mv)
    x1, y1 = min(w, x1 + mh), min(h, y1 + mv)
    want = int((y1 - y0) * portrait)
    if (x1 - x0) < want:
        cx = (x0 + x1) // 2
        x0, x1 = max(0, cx - want // 2), min(w, cx + want // 2)
    im.crop((x0, y0, x1, y1)).save(path)
    return path


def save_images(resp, out, stem):
    msg = (resp.get("choices") or [{}])[0].get("message") or {}
    imgs = msg.get("images") or []
    written = []
    for i, im in enumerate(imgs):
        url = (im.get("image_url") or {}).get("url", "")
        if not url.startswith("data:"):
            continue
        head, b64 = url.split(",", 1)
        ext = "png"
        if "jpeg" in head:
            ext = "jpg"
        path = os.path.join(out, f"{stem}{'' if i == 0 else f'_{i}'}.{ext}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        if CROP:
            autocrop(path)
        written.append(path)
    if not written:
        txt = (msg.get("content") or "")[:300]
        print(f"  no image returned. Model said: {txt!r}")
        print("  Common causes: the model is text-only, or the account's "
              "data policy blocks this provider (a zero-retention setting "
              "will refuse some models). Try another image model.")
    return written


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--prompt-file", required=True)
    p.add_argument("--model", default="google/gemini-3-pro-image")
    p.add_argument("--ref", default=None,
                   help="existing image to keep the character consistent")
    p.add_argument("-n", "--count", type=int, default=3,
                   help="candidates; generation is cheap, a bad reference is not")
    p.add_argument("--stem", default="cand")
    p.add_argument("--no-crop", action="store_true",
                   help="keep the full frame instead of cropping to the subject")
    p.add_argument("--key-env", default="OPENROUTER_API_KEY")
    p.add_argument("--key-command", default=None)
    p.add_argument("--config", default=os.path.expanduser(
        "~/.config/pnk-sculpt/config.json"))
    a = p.parse_args()

    key_command = a.key_command
    if not key_command and os.path.exists(a.config):
        cfg = json.load(open(a.config)).get("openrouter", {})
        key_command = cfg.get("key_command")
        if cfg.get("key_env"):
            a.key_env = cfg["key_env"]
        if cfg.get("image_model") and a.model == p.get_default("model"):
            a.model = cfg["image_model"]

    global CROP
    CROP = not a.no_crop
    key = get_key(a.key_env, key_command)
    prompt = open(a.prompt_file).read()
    os.makedirs(a.out, exist_ok=True)

    all_written = []
    for i in range(a.count):
        stem = f"{a.stem}{chr(ord('a') + i)}"
        print(f"[{i + 1}/{a.count}] {a.model} -> {stem}", flush=True)
        resp = generate(key, a.model, prompt, a.ref)
        w = save_images(resp, a.out, stem)
        for path in w:
            print(f"  wrote {path}")
        all_written += w

    if not all_written:
        sys.exit("no images generated")
    print(f"\n{len(all_written)} candidates in {a.out}")
    print("Now screen them: build a contact sheet with sheet.py and check each "
          "against the reference rules before picking one. A reference that "
          "fails the rules wastes a whole GPU window downstream.")


if __name__ == "__main__":
    main()
