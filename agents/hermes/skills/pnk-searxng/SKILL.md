---
name: pnk-searxng
description: >-
  Operate a self-hosted SearXNG metasearch instance that routes its scrape engines through proxies to
  dodge datacenter-IP blocks. Covers the two egress patterns (a round-robin proxy pool vs. per-engine
  routing), the per-engine `proxies:` config schema and its sharp edges, IP rotation on block, and how to
  verify egress. Use for SearXNG engine captcha/blocking, proxy/egress configuration, or per-engine routing.
version: 0.1.0
metadata:
  scope: operational-knowledge
  service: searxng
---

# SearXNG with proxy egress — portable operations

> Portable / topology-free. This is the reusable pattern. Site-specific values (hosts, IPs, container
> names, paths, monitor IDs) belong in a private/infra repo, not here.

Self-hosted [SearXNG](https://github.com/searxng/searxng) shouldn't scrape from your server's own IP —
many engines (startpage, brave, google, mojeek, …) CAPTCHA/deny datacenter ASNs. Route scrape traffic
through proxies instead. Config lives in `settings.yml`.

## Two egress patterns

1. **Proxy pool (global).** `outgoing.proxies` round-robins all outbound engine requests across a list of
   HTTP/SOCKS proxies, with automatic retry to the next on failure. Good default; one knob for every engine.
   Give SearXNG its **own** networking (don't bind it into a single proxy's network namespace) so it
   survives a proxy container being recreated.
2. **Per-engine routing.** Route only the chronically blocked engines down a stronger/cleaner egress
   (e.g. a residential or cellular SOCKS proxy) while leaving API/academic engines on the default path.

## Per-engine `proxies:` schema — the sharp edges

- The per-engine egress key is a **`proxies:` dict** (`{http, https}`) placed **inside that engine's own
  stanza** in the existing `engines:` list. It is **NOT** a `network: <string>` key (verified against
  `searx/enginelib`). Example:
  ```yaml
  - name: startpage
    engine: startpage
    proxies:
      http:  socks5://my-proxy:1080
      https: socks5://my-proxy:1080
  ```
- **Never add a second top-level `engines:` key.** YAML is last-wins: a second `engines:` block silently
  replaces the whole list and **wipes every engine you didn't re-list**, breaking the instance. Splice
  `proxies:` **in place** into each routed engine (a marker-guarded edit), never by appending a new block.

## Operate / verify

- **Always verify the egress IP + ASN** before trusting a proxy path — a misconfigured or leaking proxy
  silently falls back to a blocked ASN. Curl `ipinfo`/`ip-api` *through the proxy* and assert the org/ASN
  is what you expect (e.g. the residential/cellular carrier, not your datacenter or a VPN you meant to avoid).
- **Rotate on block:** when an engine starts returning captcha/empty in a sustained way, rotate the egress
  IP (proxy reconnect, or carrier re-validation for cellular) and confirm the IP changed and the ASN held.
  Bound auto-rotation by a cooldown + max-per-hour so a flapping engine can't thrash it.
- **Characterise first:** before splicing, sweep each engine on each candidate path (baseline vs. proxy)
  and classify works/captcha/empty — only route the engines that actually benefit.

## Monitor

Track two things: the **service** itself (an HTTP keyword check that a known query returns results) and
the **egress health** (proxy reachable + egress ASN is the intended one). A proxy on a private network the
monitor can't reach is best fed as a **push** monitor from a host-side probe. A "no heartbeat" on a push
monitor usually means the probe/wiring broke, not that the egress itself failed — verify before concluding.
