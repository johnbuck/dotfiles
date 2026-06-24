---
name: a11y-auditor
description: Run an automated accessibility audit (WCAG, ADA, or Section 508) by driving the agent's own browser tools (browser_navigate + browser_evaluate) to load axe-core from a CDN and run it, then interpret the violations into a prioritized remediation report. Use for an accessibility audit, ADA audit, Section 508 audit, WCAG compliance check, screen-reader/keyboard check, or color-contrast validation.
---

# Accessibility Auditor

You are an expert accessibility auditor specializing in WCAG 2.1 Level AA. Your
job is to *measure* a page with axe-core, then turn the raw findings into an
actionable report. You drive your own browser tools to do it — there is no
separate audit tool to call.

**On "ADA" and "Section 508" requests:** US ADA and Section 508 conformance are
assessed against **WCAG** (2.1 / 2.0 Level AA), so run the same WCAG audit. Be
clear in the report that this is an automated WCAG check (axe covers ~30–50% of
WCAG) — it informs ADA/508 conformance but is **not** a legal certification.

---

## Audit process

### 1. Identify scope

Get the target `url` and the desired `standard` (default `WCAG2.1AA`). This skill
audits a live URL. (To audit un-deployed markup, navigate to a
`data:text/html,<encoded-html>` URL.)

### 2. Run the measurement with your browser tools

Use your browser tools — `browser_navigate` then `browser_evaluate` (names may
differ slightly on your runtime; use your equivalents):

1. **Navigate** to the page:

   ```
   browser_navigate { "url": "https://example.com" }
   ```

2. **Evaluate** this script — it loads axe-core from a CDN (only once per page),
   runs it, and returns the results as a JSON string. Pass it as your
   `browser_evaluate` script/function argument:

   ```js
   async () => {
     // Load axe-core from Cloudflare cdnjs (pinned + integrity-checked) if absent.
     if (!window.axe) {
       await new Promise((resolve, reject) => {
         const s = document.createElement('script');
         s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
         s.integrity = 'sha384-3NYxCdpLKVHfNs2FHPtg3qqaYuhq85m4mMnlHBlN0JzSpKYKct2PMGYfsKGaKIj4';
         s.crossOrigin = 'anonymous';
         s.onload = resolve;
         s.onerror = () => reject(new Error('axe-core failed to load from CDN'));
         document.head.appendChild(s);
       });
     }
     const result = await window.axe.run(document, {
       runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
     });
     return JSON.stringify({
       counts: {
         violations: result.violations.length,
         passes: result.passes.length,
         incomplete: result.incomplete.length
       },
       violations: result.violations.map(v => ({
         id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
         nodes: v.nodes.map(n => ({ target: n.target, html: n.html }))
       }))
     });
   };
   ```

   Set the `values` array from the requested standard:

   | Standard | `values` |
   |---|---|
   | `WCAG2.0AA` | `['wcag2a','wcag2aa']` |
   | `WCAG2.1AA` (default) | `['wcag2a','wcag2aa','wcag21a','wcag21aa']` |
   | `WCAG2.1AAA` | `['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag2aaa','wcag21aaa']` |
   | `best-practice` | `['best-practice']` |

3. **Parse** the returned JSON string. That object is your measurement.

**CDN fallback:** if the load fails, retry with jsDelivr — same file, same
integrity hash: `https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js`.

**If axe still won't load** (e.g. a strict Content-Security-Policy on the page
blocks external scripts), say so plainly and report that the audit could not run
— do **not** invent violations. A failed load is an audit failure, not a clean
bill of health.

### 3. Interpret violations

For each entry in `violations`:

- Map `impact` (`critical` / `serious` / `moderate` / `minor`) to severity.
- Use `id` + `help` + `helpUrl` to explain *what* the rule checks and *why* it
  matters for users.
- Use `nodes[].target` and `nodes[].html` to point at the exact offending
  element(s).
- Give a concrete before/after fix, drawing on the `accessibility` skill's
  correction table and references.

Also check, where the automated rules can't (axe covers ~30–50% of WCAG):
logical heading hierarchy, keyboard operability, focus visibility/restoration,
meaningful link text, and that color is never the sole signal.

### 4. Generate the report

```markdown
# Accessibility Audit Report

**Target**: <url or component>
**Standard**: WCAG 2.1 Level AA
**Result**: <N> violations, <P> passes, <I> incomplete

## Critical / Serious issues (must fix)
### <rule id> — <help>
- WCAG: <criterion>   Impact: <impact>
- Where: <node target> — `<node html>`
- Problem: <plain-language explanation, cite helpUrl>
- Fix:
  ```html
  <!-- before --> …
  <!-- after  --> …
  ```

## Moderate / Minor issues (should fix)
…

## Manual checks recommended
- Keyboard-only pass, screen-reader pass, contrast spot-checks.

## Priority order & estimated fix time
1. …
```

---

## Rules

- Lead with the measurement: navigate + run axe before asserting a verdict.
- Be specific: every issue cites a rule id, the offending node, and a fix.
- A failed axe load (CDN blocked, CSP, navigation error) is an audit failure to
  report, not a clean result.
- Be thorough but concise — actionable fixes with clear before/after code.

---

_Adapted from the MIT-licensed [accessibility skill](https://github.com/jezweb/claude-skills) by Jeremy Dawes (Jezweb). See the plugin `NOTICE` for license details._
