---
title: Agent-driven manual-review pass (fill the Alerts bucket)
status: idea
area: [a11y-auditor skill]
created: 2026-06-24
tags: [backlog, accessibility, manual-checks]
---

# Agent-driven manual-review pass

**One sentence:** Extend the `a11y-auditor` skill with an optional agent-driven
pass that captures the accessibility checks axe-core can't automate — keyboard
operability, the screen-reader experience, and content/visual judgment — and
files them into the report's **Alerts (needs review)** bucket instead of just
recommending "do this by hand."

## Why

axe-core covers ~30–50% of WCAG (the machine-checkable rules). The rest —
keyboard flow, what a screen reader actually announces, whether alt text is
*meaningful*, whether color is the only signal — is today left as a generic
"manual checks recommended" footer. An LLM agent with a browser can actually
*perform and triage* a good chunk of that now, turning a vague footer into
concrete, located, reviewable findings. These remain **assistive, not
authoritative** (see Limits).

## The three tiers (by how agent-able they are)

### 1. Keyboard + focus — deterministic, scriptable today
The agent drives the browser: press `Tab` through the page and at each stop
capture `document.activeElement` (tag, role, accessible name), whether the focus
indicator is actually visible (computed outline/box-shadow), and the focus order
vs visual order. From the captured sequence, detect:
- focus traps (can't `Tab`/`Esc` out of a modal),
- unreachable interactive elements,
- invisible or low-contrast focus indicators,
- focus order that doesn't match reading/visual order,
- WCAG 2.2: focus-appearance (2.4.11) and focus-not-obscured (2.4.11/2.4.12),
  target size ≥24px (2.5.8).

Mechanism: `browser_evaluate` to read state + dispatch key events (or the agent's
key/press tool), agent interprets the captured trace.

### 2. Screen-reader experience — without a real screen reader
A real NVDA/VoiceOver needs a Windows/Mac host, so it's out for headless Linux
(AgentCore). Two headless-friendly routes that capture what a screen reader
*would* get:
- **Accessibility tree** — read the computed name/role/state of nodes (Chrome
  `Accessibility.getFullAXTree` via CDP, or compute accessible name/role in-page).
  The LLM judges whether names/roles/structure make sense (empty names, generic
  roles, mislabeled controls, heading/landmark structure).
- **[Guidepup Virtual Screen Reader](https://github.com/guidepup/virtual-screen-reader)**
  — a JS screen-reader *simulator* injected into the page; it emits the announced
  phrase sequence for the agent to evaluate. Runs headless.

### 3. Content / cognitive / visual judgment — the LLM's strong suit
Pure model/vision judgment over captured artifacts:
- **Alt-text quality** — vision model: does the `alt` actually describe the image?
- **Link/button text out of context** — "click here", "read more", icon-only.
- **Color as the sole signal** — compare a normal screenshot vs a grayscale one;
  is information lost?
- **Reflow / zoom** — resize viewport to 320px and 400% zoom, screenshot, check
  for horizontal scroll / clipping / overlap.
- Reading order, reading level, error-message clarity.

## How it fits the existing skill

- Runs **after** the axe pass, only when asked ("full audit", "manual checks",
  "deep audit") or always-on via a flag — keep it opt-in so a quick scan stays fast.
- Each finding is a **needs-review** item → goes in the **Alerts** bucket of the
  existing report, with: what was checked, the element/location, the agent's
  judgment, and a **confidence** note.
- Reuses tools the agent already has: `browser_navigate`, `browser_evaluate`,
  screenshots, key/press. No new plugin infrastructure, no new connection.

## Prior art to reuse / reference

- **Guidepup** (real VoiceOver/NVDA via Playwright) + **Virtual Screen Reader**
  (headless JS simulator) — the screen-reader-automation piece.
- **Evinced / EvinceAI, Test-Lab.ai, TestSprite, CompliScan** — current "AI
  accessibility agent" products (axe + LLM reasoning for alt/link/ARIA/keyboard);
  reference for the pattern.
- **Deque axe Intelligent Guided Tests**, **Microsoft Accessibility Insights** —
  human-guided assessment flows.

## Scope

### In scope (eventually)
- Skill-level recipes for the keyboard pass, AX-tree review, and the vision/content
  checks, each emitting Alerts-bucket findings with confidence.
- Optional Virtual Screen Reader injection for announced-output checks.

### Out of scope
- Running real NVDA/VoiceOver (needs a Windows/Mac host; not headless/AgentCore).
- Any claim of legal certification or "fully accessible" — this triages manual
  items, it does not close them.

## Prefer deterministic where possible (explore BEFORE implementing)

Do not assume every check has to be an LLM judgment. Much of tier 1 (keyboard +
focus) and parts of tier 2 (accessibility tree) are mechanical and should be
captured **deterministically** — scripted browser probes that produce a concrete
trace (focus sequence, computed outline visibility, focus traps, target sizes,
AX name/role presence, color-contrast deltas, reflow overflow at a given
viewport). Deterministic checks are repeatable, cheaper, and don't suffer the
"confident-but-wrong" failure mode; the LLM should be reserved for the genuinely
judgment-heavy parts (alt-text *meaningfulness*, link purpose in context,
reading order/level, whether the announced output "makes sense").

**This split needs to be explored first.** Before building, work out which
sections can be made deterministic (and how), and which truly require model
judgment — and design so the deterministic layer carries as much as possible,
with the LLM layered on top only where mechanical checks can't decide. The goal
is the smallest LLM surface, not an all-LLM pass.

## Limits (state these in any output)

AI judgment here is **assistive, not authoritative** — its failure mode is
confident-but-wrong calls. Real users with disabilities remain the gold standard,
and ADA/508 certification still needs human experts. The pass should report
findings as *candidates to verify*, with confidence, never as pass/fail verdicts.

## Open questions

- **Deterministic vs LLM split — resolve before implementing** (see "Prefer
  deterministic where possible"): which checks become scripted probes, which
  stay model judgment, and how they layer.
- Opt-in trigger vs always-on (cost/latency: the keyboard + vision passes add
  time and screenshots).
- How much to lean on the Virtual Screen Reader vs the raw AX tree.
- Whether to cap the keyboard pass (e.g. first N focusable elements) on large pages.
