---
name: verify
description: Build/launch/drive recipe for verifying Compound (static site) changes end-to-end in a real browser.
---

# Verifying Compound

Static site — no build step. Two layers of verification:

## 1. Engine tests (fast, not sufficient alone)

```bash
node test.js     # spec §7 + regressions + constants self-consistency; exits 1 on failure
```

## 2. Drive the real UI

Serve the repo root (Chart.js needs network for the CDN):

```bash
python3 -m http.server 8741   # background it
```

Drive with Playwright through the locally installed Chrome — there is no
Playwright-managed browser on this machine, so launch with
`chromium.launch({ channel: 'chrome' })`. `playwright` is not a repo
dependency; `npm i playwright` in a scratch dir and run the driver from there.

Flows worth driving (all state is in-memory; reload resets):

- Default load → hero shows a compact figure like `$3.6M`; no console errors.
- Assumptions → add salary milestones (`.bump-row` inputs: age, monthly salary).
  Edge: a $0 milestone followed by a recovery milestone used to NaN the
  projection — hero must stay finite and the salary chart must ramp.
- Voluntary CPF top-up input → hero rises (includes tax relief effect).
- Real/Nominal toggle buttons, "Show year-by-year breakdown" table.

Gotchas:

- A `favicon.ico` 404 in the console is pre-existing noise, not a regression.
- Hero/table money is text — assert on `.hero-num` textContent.
- Milestones at ages ≤ current age are silently ignored (by design).
