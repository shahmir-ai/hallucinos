# HANDOFF-2 — closing SPEC §10 (2026-09-17)

State handed over: 105 vitest + **29** playwright tests green on the mock engine,
`npm run build && npm start` verified from a wiped `dist/`+`public/` (`/healthz`
returns `200 ok`). **$0 spent this phase** — everything below was proved on the
mock engine.

## What this phase changed

### 1. `scripts/bakeoff.mjs` — SPEC §7's judging protocol, automated

Rewritten on top of the existing `scripts/run.mjs` harness (shared with
`smoke.mjs`; nothing duplicated). It starts its own server on a **free port**
asked of the OS, and selects the engine with `?engine=` on `/bakeoff` exactly as
a visitor would.

Per engine (default: every keyed non-mock engine in `/api/engines`), per boot
(default 5): identity → boot screen → desktop, then the four apps SPEC §7 asks
for (`browser`, `calculator`, `notes`, `store`), then inside the browser window:
its own google-shaped home, a search for "best pizza in town" typed into
whatever search box the model built (`--query=`), a click on the first result,
then `reddit.com/r/cats`, `netflix.com`, `en.wikipedia.org/wiki/Moon`.

Recorded per generation, from the server's stdout telemetry lines: `contract_ok`,
`ttfb_ms`, `total_ms`, `tok_per_s`, tokens in/out, `usd`. The HUD is read off the
screen at every step as an independent witness (its text is quoted in the
report), so the report cannot quietly disagree with either source.

Recorded per boot: time to boot-screen **first paint** (a new `onPaint` hook in
`bootOnce` also takes the boot-screen screenshot, which is otherwise gone by the
time the desktop is up), time to desktop ready, and broken-render flags.

**Broken render** = blank frame (<40 chars and <4 nodes), unstyled body (no
`<style>`, no stylesheet, no inline `style` anywhere — the browser's default
sheet is the whole design), a real JS error during that step, or a document that
never arrived. CSP refusals are explicitly **not** broken renders: a generated
document reaching for the network logs a console error, which is the sandbox
working. They are counted in their own column, because an engine that keeps
reaching for the web is a finding of its own. Without that filter every engine
scored 100% broken — the mock's own hostile probe fires in every document.

Report: `reviews/BAKEOFF-<n>.md`, next free number, never overwriting a judged
run. Shots: `reviews/shots-bakeoff/<engine>/<boot>/<step>.png`. The report ends
with a **funniness and variety** section left deliberately blank — machine names,
taglines, versions and shot paths per boot, and a scorecard for a human.

New primitives in `scripts/run.mjs` (all reusable by `smoke.mjs`): `freePort`,
`collectErrors`/`isSandboxNoise`, `frameHealth`, `hudSnapshot`, `pageStep`,
`addressBar`, `searchInPage`, `clickFirstLink`, `nextReport`, and the `onPaint`
option on `bootOnce`.

`pageStep` is the load-bearing bit: it stamps the current page document before
triggering a navigation, so the fresh document is told apart from a stale one
whose text happens to be stable. Waiting on text-stability alone (what the old
runner did) returns the *previous* page instantly whenever a step is slow.

### 2. `reviews/BAKEOFF-0-mock-rehearsal.md`

The harness driven end to end, 2 boots, on the mock engine, at $0. Not a judging
run and labelled as such in its first paragraph; it exists so the first real run
is not also the first time the code has run. `BAKEOFF-1.md` is left free.

### 3. `e2e/bakeoff.spec.ts` — three new tests

SPEC §10.2's own list was already fully covered by the previous fix (audited
item by item: boot→contract, browser→google→search→results→click→page, the
calculator/notes/store + install, reload-regenerates, the moderation reroute, the
caps 429, `/api/engines` listing only keyed engines, zero network from any
generated frame by request interception). What had **no** test was the surface
the new bake-off harness depends on:

- the engine picker exists on the boot screen and is gone once the desktop
  mounts (run against the `MOCK_DELAY_MS=60` server on 8773, which widens the
  boot window enough to look at it without racing);
- the HUD carries engine / last kind / ttfb / tok/s / tokens / contract /
  session $, and **follows** the next generation;
- `?engine=` is honoured, and an unknown engine falls back instead of hanging.

### 4. README

New Deviations lines (report numbering, six page loads instead of five, CSP
refusals not counted as broken renders), a full description of the bake-off
runner and its flags, and one warning that matters: `npm run dev` forces
`DEFAULT_ENGINE=mock`, but **`npm start` does not** — with the current `.env` it
defaults to `cerebras-oss120`, whose model id is still flagged UNVERIFIED in
`engines.json`. Set `DEFAULT_ENGINE` before running the production path locally.

DEPLOY.md needed no change: service root, watch patterns, the env table, the
healthcheck and "not deployed" were all already correct.

### 5. Housekeeping

No `.smoke*.mjs` scratch files existed at the product root any more (the
previous fix agent had already folded them into `scripts/`); confirmed and
nothing to remove. `test-results/` is empty and gitignored.

## What is left

1. **The real bake-off has not been run.** This phase's budget was $0. The keys
   present in `.env` are `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CEREBRAS_API_KEY`,
   `INCEPTION_API_KEY`, `OPENROUTER_API_KEY`; `/api/engines` therefore offers
   `cerebras-oss120`, `cerebras-qwen38`, `mercury-2.5`, `openai-small`,
   `anthropic-haiku`, `openrouter-oss120`. Run
   `npm run bakeoff -- --boots=5 --budget=<usd>` when there is money for it; the
   first thing it will discover is whether the three UNVERIFIED model ids exist.
2. **`openai-small` still fails SPEC §10.3's contract gate** (2/10 in SMOKE-1);
   `anthropic-haiku` passes 9/10. That is a prompt problem, not a harness
   problem, and it is the one §10 item still open.
3. **The desktop is same-origin with the kernel** (README Deviations) — the one
   structural compromise in the build, and a v2 change rather than a patch.
