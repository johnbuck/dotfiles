"""Standalone unit tests for the pnk-openrouter image_gen backend.

Topology-free and dependency-light: the hermes ``agent.image_gen_provider``
module and ``httpx`` are both faked, so this runs under plain pytest anywhere
(no hermes install, no network). Run: ``pytest test_pnk_openrouter.py``.
"""

from __future__ import annotations

import base64
import importlib.util
import os
import sys
import types
from pathlib import Path

try:
    import pytest
except ImportError:  # allow plain-python runs without pytest installed
    pytest = None


# --- Fake the hermes base module BEFORE importing the plugin ---------------

def _install_fake_agent_module():
    mod = types.ModuleType("agent.image_gen_provider")

    class ImageGenProvider:  # minimal ABC stand-in
        pass

    mod.ImageGenProvider = ImageGenProvider
    mod.DEFAULT_ASPECT_RATIO = "landscape"
    mod.resolve_aspect_ratio = lambda v: v or "landscape"

    saved = {}

    def save_b64_image(b64_data, *, prefix):
        saved["b64"] = b64_data
        saved["prefix"] = prefix
        return Path(f"/cache/{prefix}.png")

    def save_url_image(url, *, prefix):
        saved["url"] = url
        saved["prefix"] = prefix
        return Path(f"/cache/{prefix}.png")

    def success_response(*, image, model, prompt, aspect_ratio, provider, extra=None):
        return {"ok": True, "image": image, "model": model, "provider": provider,
                "aspect_ratio": aspect_ratio, "extra": extra or {}}

    def error_response(*, error, error_type, provider, aspect_ratio=None, model=None,
                       prompt=None):
        return {"ok": False, "error": error, "error_type": error_type, "provider": provider}

    mod.save_b64_image = save_b64_image
    mod.save_url_image = save_url_image
    mod.success_response = success_response
    mod.error_response = error_response

    agent_pkg = sys.modules.get("agent") or types.ModuleType("agent")
    sys.modules["agent"] = agent_pkg
    sys.modules["agent.image_gen_provider"] = mod
    return saved


_SAVED = _install_fake_agent_module()

# Load the plugin module from its __init__.py by path.
_spec = importlib.util.spec_from_file_location(
    "pnk_openrouter", Path(__file__).with_name("__init__.py")
)
pnk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pnk)


# --- Fake httpx ------------------------------------------------------------

class _FakeResp:
    def __init__(self, status_code, body=None, text=""):
        self.status_code = status_code
        self._body = body or {}
        self.text = text

    def json(self):
        return self._body


def _install_fake_httpx(resp=None, raise_exc=None, capture=None):
    fake = types.ModuleType("httpx")

    def post(url, json=None, headers=None, timeout=None):
        if capture is not None:
            capture["url"] = url
            capture["json"] = json
            capture["headers"] = headers
        if raise_exc:
            raise raise_exc
        return resp

    fake.post = post
    sys.modules["httpx"] = fake


def _img_body(data_url):
    return {"choices": [{"message": {"role": "assistant", "content": "done",
            "images": [{"type": "image_url", "image_url": {"url": data_url}}]}}]}


PNG_B64 = base64.b64encode(b"\x89PNG fake bytes").decode()
DATA_URL = f"data:image/png;base64,{PNG_B64}"


# --- Tests -----------------------------------------------------------------

def setup_function(_):
    # clear config-affecting env between tests
    for k in ("OPENROUTER_IMAGE_MODEL", "OPENROUTER_BASE_URL", "OPENROUTER_API_KEY"):
        os.environ.pop(k, None)


def test_resolve_model_default():
    assert pnk._resolve_model() == pnk.DEFAULT_MODEL


def test_resolve_model_env_override():
    os.environ["OPENROUTER_IMAGE_MODEL"] = "black-forest-labs/flux.2-pro"
    assert pnk._resolve_model() == "black-forest-labs/flux.2-pro"


def test_modalities_default_vs_image_only():
    assert pnk._resolve_modalities("google/gemini-2.5-flash-image") == ["image", "text"]
    assert pnk._resolve_modalities("black-forest-labs/flux.2-pro") == ["image"]


def test_extract_data_url_decodes_and_saves():
    path = pnk._extract_and_save(
        [{"image_url": {"url": DATA_URL}}], "google/gemini-2.5-flash-image"
    )
    assert path.endswith(".png")
    assert _SAVED["b64"] == PNG_B64           # passed the raw base64, prefix stripped
    assert _SAVED["prefix"].startswith("pnk-openrouter_gemini-2.5-flash-image")


def test_extract_http_url_uses_url_saver():
    path = pnk._extract_and_save([{"image_url": {"url": "https://x/y.png"}}], "v/m")
    assert _SAVED["url"] == "https://x/y.png"
    assert path.endswith(".png")


def test_extract_empty_returns_none():
    assert pnk._extract_and_save([], "v/m") is None


def test_generate_empty_prompt_is_invalid():
    out = pnk.PnkOpenRouterImageGenProvider().generate("   ")
    assert out["ok"] is False and out["error_type"] == "invalid_argument"


def test_generate_happy_path():
    cap = {}
    _install_fake_httpx(resp=_FakeResp(200, _img_body(DATA_URL)), capture=cap)
    out = pnk.PnkOpenRouterImageGenProvider().generate("a red cube", aspect_ratio="square")
    assert out["ok"] is True
    assert out["image"].endswith(".png")
    assert out["provider"] == "pnk-openrouter"
    # request shape
    assert cap["json"]["modalities"] == ["image", "text"]
    assert cap["json"]["model"] == pnk.DEFAULT_MODEL
    assert cap["url"].endswith("/chat/completions")


def test_generate_non_200_is_api_error():
    _install_fake_httpx(resp=_FakeResp(429, text="rate limited"))
    out = pnk.PnkOpenRouterImageGenProvider().generate("x")
    assert out["ok"] is False and out["error_type"] == "api_error"


def test_generate_no_images_is_empty_response():
    body = {"choices": [{"message": {"role": "assistant", "content": "hi", "images": []}}]}
    _install_fake_httpx(resp=_FakeResp(200, body))
    out = pnk.PnkOpenRouterImageGenProvider().generate("x")
    assert out["ok"] is False and out["error_type"] == "empty_response"


if __name__ == "__main__":
    if pytest is not None:
        sys.exit(pytest.main([__file__, "-v"]))
    # Minimal runner when pytest is unavailable.
    failures = 0
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            setup_function(_fn)
            try:
                _fn()
                print(f"PASS {_name}")
            except Exception as _exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {_name}: {_exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
