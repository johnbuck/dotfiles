---
name: accessibility
description: Build and verify WCAG 2.1 AA compliant interfaces — semantic HTML, ARIA, focus management, color contrast, keyboard navigation, form labels, and live regions. Use when implementing accessible UI, fixing screen-reader/keyboard issues, or running an accessibility / WCAG audit (via the a11y-auditor skill). Triggers include "focus outline missing", "aria-label required", "insufficient contrast".
---

# Web Accessibility (WCAG 2.1 AA)

**Standards**: WCAG 2.1 Level AA · **Dependencies**: none (framework-agnostic)

This skill carries the *guidance* for writing accessible markup. To actually
*measure* a page, spawn the `a11y-auditor` skill — it drives your browser tools
to run axe-core and returns a prioritized report.

---

## Measure first: the a11y-auditor skill

Don't eyeball markup — get objective, rule-based findings. Spawn the
`a11y-auditor` skill with the target `url` and `standard` (`WCAG2.0AA`,
`WCAG2.1AA` (default), `WCAG2.1AAA`, or `best-practice`). It navigates the page
with your browser tools, loads and runs axe-core, and reports each violation
with the rule, the offending element, and a fix.

---

## The 5-Step Accessibility Process

### Step 1 — Choose semantic HTML

Don't use `div` for everything. `<button>` for actions, `<a href>` for
navigation, `<nav>/<article>/<section>/<aside>` for structure. Semantic elements
carry built-in keyboard support and roles. See `references/semantic-html.md`.

### Step 2 — Add ARIA only when HTML can't express the pattern

No ARIA is better than bad ARIA. Use `aria-label`/`aria-labelledby` for missing
names, `aria-live` for dynamic updates, `aria-expanded` for disclosure state.
Prefer native elements (`<dialog>`) over `role="dialog"`. See
`references/aria-patterns.md`.

### Step 3 — Keyboard navigation

Every interactive element must be reachable and operable by keyboard:
Tab/Shift+Tab to move, Enter/Space to activate, Arrow keys within composite
widgets, Escape to dismiss, no keyboard traps. See `references/focus-management.md`.

### Step 4 — Color contrast

Normal text ≥ 4.5:1, large text (18pt / 14pt bold) and UI components ≥ 3:1,
focus indicators ≥ 3:1. Never use color alone to convey meaning. See
`references/color-contrast.md`.

### Step 5 — Accessible forms

Every input gets a visible, associated `<label for=…>` (placeholders are not
labels). Errors use `aria-invalid` + `aria-describedby` pointing at a
`role="alert"` message. See `references/forms-validation.md`.

For the full requirement list, see `references/wcag-checklist.md`.

---

## Correction table (apply automatically)

When you would otherwise write the left column, write the right column instead.

### Interactive elements
| Instead of… | Use… |
|---|---|
| `<div onclick="doThing()">Click</div>` | `<button type="button" onclick="doThing()">Click</button>` |
| `<span onclick="submit()">Submit</span>` | `<button type="submit">Submit</button>` |
| `<a href="#" onclick="doThing()">Action</a>` | `<button type="button" onclick="doThing()">Action</button>` |
| an `<a>` whose `href` runs script instead of navigating | `<button type="button">Action</button>` |
| `<div class="button">Click</div>` | `<button>Click</button>` |

### Focus indicators
| Instead of… | Use… |
|---|---|
| `*:focus { outline: none; }` | `*:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` |
| `button:focus { outline: 0; }` | `button:focus-visible { outline: 2px solid var(--primary); }` |
| Removing outline without replacement | Always provide a custom focus indicator |

### Images
| Instead of… | Use… |
|---|---|
| `<img src="logo.png">` | `<img src="logo.png" alt="Company Name">` |
| icon `<img>` in a button | `<button aria-label="Close"><img src="icon.png" alt=""></button>` |
| `<div style="background-image:…">` for a content image | `<img src="…" alt="Description">` |
| Alt text starting with "Image of" | Describe what the image conveys |

### Form labels
| Instead of… | Use… |
|---|---|
| `<input placeholder="Email">` | `<label for="email">Email</label><input id="email" type="email">` |
| `<input aria-label="Email">` | Prefer a visible `<label for="email">Email</label>` |
| Label without for/id | `<label for="email">Email</label><input id="email">` |

### Headings
| Instead of… | Use… |
|---|---|
| `<h1>…</h1><h3>…</h3>` | `<h1>…</h1><h2>…</h2>` (don't skip levels) |
| `<h3 class="big">` for styling | Correct level + CSS |
| Multiple `<h1>` per page | One `<h1>` (the page title) |

### Color contrast
| Instead of… | Use… |
|---|---|
| `#999` text on white | `#595959` (4.6:1) or darker |
| `#4d90fe` on white (2.9:1) | `#0066cc` (5.7:1) or darker |
| `#ef4444` text on white (3.3:1) | `#b91c1c` (6.2:1) |
| Color alone for errors | Icon + text + color |

### ARIA usage
| Instead of… | Use… |
|---|---|
| `<button role="button">` | `<button>` (native role already) |
| `<div role="button">` | `<button>` |
| `aria-label` when visible text exists | Use the visible text |
| `<button aria-hidden="true">` | Remove `aria-hidden` (it hides a focusable control) |

### Keyboard, links, live regions, tables, skip links, media, language
| Instead of… | Use… |
|---|---|
| `tabindex="1"` (positive) | `tabindex="0"` / natural order |
| `<a href="/x">Click here</a>` | `<a href="/x">Read the accessibility guide</a>` |
| Dynamic content without announcement | `<div aria-live="polite">…</div>` / `role="alert"` |
| `<table>` without headers | `<th scope="col">` / `<th scope="row">` + `<caption>` |
| No skip link | `<a href="#main" class="skip-link">Skip to main content</a>` + `<main id="main" tabindex="-1">` |
| `<video autoplay>` | `<video controls>` (require user interaction) |
| root `html` element missing a language | add `lang="en"` to the root `html` element |

---

## Critical rules

**Always:** semantic HTML first · text alternatives for non-text content ·
4.5:1 / 3:1 contrast · full keyboard operability · logical heading hierarchy ·
visible focus indicators · `aria-live` for dynamic updates · restore focus when
closing dialogs.

**Never:** `div`+`onClick` for actions · remove focus outlines without
replacement · color alone for meaning · placeholders as labels · skip heading
levels · `tabindex > 0` · ARIA where semantic HTML exists · keyboard traps.

---

## References

Load these for deep dives:

- `references/wcag-checklist.md` — full WCAG 2.1 A & AA requirements
- `references/semantic-html.md` — element-selection guide
- `references/aria-patterns.md` — ARIA roles/states/properties
- `references/focus-management.md` — focus order, traps, restoration
- `references/color-contrast.md` — contrast math and safe palettes
- `references/forms-validation.md` — accessible forms and error handling

For an automated audit and report, spawn the **a11y-auditor** skill.

---

_Adapted from the MIT-licensed [accessibility skill](https://github.com/jezweb/claude-skills) by Jeremy Dawes (Jezweb). See the plugin `NOTICE` for license details._
