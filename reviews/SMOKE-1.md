# SMOKE-1 — real-engine smoke (SPEC §10.3)

Second pass, 2026-09-17. The first pass (kept below in "What the first pass
found") left `openai-small` failing SPEC §10.3's gate at **2 of 10** desktops.
It now passes, and `anthropic-haiku` went from 9/10 to 10/10.

**The gate:** both smoke engines pass the shape contract on at least 9 of 10
desktop generations.

| engine | before | after | verdict |
|---|---|---|---|
| `openai-small` (gpt-4.1-nano) | **2/10** | **8/8, and 9/10 + 10/10 on the two sweeps before the last fix** | PASSES |
| `anthropic-haiku` (claude-haiku-4-5) | **9/10** | **10/10** | PASSES |

Nothing about the *look* was touched. No colour, font, layout or wallpaper
instruction was added to any prompt; every change is about the seven hooks and
the shape of the markup that carries them.

## How it was measured

`node scripts/desktop-sweep.mjs --engines=<id> --n=10` — new in this pass, and
the reason iterating was affordable. It asks `POST /api/gen` for N desktops and
reads `contract_ok` plus the validator's own miss list out of the response's
telemetry sentinel. No browser, no apps, no pages: one generation per data
point, versus thirteen and several minutes for a bake-off boot. Three fixed
identities (a 1994 municipal office, a 2061 deep-sea hull, a 1908 pneumatic
clearing house) rotate so no engine is judged on one mood, and `DUMP=<dir>`
writes every document out — which is how each failure below was diagnosed
instead of guessed at.

## What broke, and what fixed it

Every miss had a syntactic cause. None of them was the model failing to
understand the idea; all five were the model mis-copying a notation.

| # | what the documents actually did | the fix in `prompts/system/desktop.md` | openai-small after |
|---|---|---|---|
| 0 | baseline as handed over | — | 1–2 / 10 |
| 1 | no `<template data-os-task>` at all; window template without `[data-os-drag]` | a **minimal structural skeleton** of both templates, marked "structure only — do not copy the look", with no styling in it at all; the seven-hook list restated at the top and again as a tick-list at the very end of both the system and the user turn | 6 / 10 |
| 2 | `<div [data-os-desktop]>` — the square brackets of the selector notation leaked into the tag; and `[data-os-windows]{…}` styled in the stylesheet with no such element anywhere | the hook list rewritten in **HTML form** rather than selector form, plus "a styling rule is not an element" | 7 / 10 |
| 3 | *(a regression, reverted)* a WRONG/RIGHT table whose WRONG row showed `ids.forEach(id => grid.innerHTML += …)` | the model started building launchers in a script — it copied the counter-example. **Negative examples poison small models**; the block was rewritten as positive form only: here is how the sixteen launchers are written out | 5 / 10, then 9 / 10 |
| 4 | one document invented `data-os-app="brassworks"`; others stopped at 8 or 13 of the 16 ids | the launcher ids are now spelled out literally in the prompt (`{{app_launchers}}`, new server-side var) with `{{app_count}}` stated, and the list is repeated in the closing tick-list of both turns; "the ids are a closed list, the *label* is where this machine's own name goes; count your launchers, the ones at the end of the list are the ones that get dropped" | — |
| 5 | `<div data-os-taskbar"></div>` and `<div data-os-content"></div>` — a single stray quote, generalised from the neighbouring `data-os-app="browser"`. Both of haiku's two misses were this, nothing else | every hook in the prompt is now written `name=""`, so the valueless and valued forms stop disagreeing and the quotes always come in pairs | haiku 8/10 → **10/10** |
| 6 | `{{app_launchers}}` and `{{app_count}}` were rendering as the **empty string** for three whole sweeps: `dist/server.js` is what the harness runs, and the new vars were only in `server/*.ts` | `npm run build`, and `test/launchers.test.ts` so a placeholder that renders empty fails a test instead of silently weakening the prompt | **8 / 8** |

Also added, because a screenshot showed it rather than a number: one boot put all
sixteen launchers in a single column down the left edge and the last three ran
off the bottom of the screen, unreachable. The prompt now requires every launcher
to be reachable at the given viewport without the page scrolling — fitting,
scrolling inside the launcher area, or behind a menu, the model's choice. That is
a legibility requirement, not a layout.

## Harness bugs found while doing it (`scripts/run.mjs`)

These were making the product look worse than it is, so they are worth naming:

- **Every engine scored a blank first render.** The bake-off's `url-1-google-home`
  step read the browser's nested page frame the instant the app frame settled —
  about twenty seconds before the kernel's own navigation to the google-shaped
  home had produced anything. New `waitForPage()` waits for that document;
  `url-1` is now a real measurement instead of `0 chars in 0ms BLANK`.
- **Pages were photographed half-painted.** "Wait until `innerText` stops
  growing for 1.2 s" plateaus for seconds whenever the model is streaming a long
  `<style>` block, so a finished-looking 62-character Wikipedia page was being
  recorded as the whole render. New `settleDoc()` waits for
  `document.readyState === 'complete'` — which is the injected runtime's own
  `document.close()`, i.e. the kernel telling us the generation is over — and
  keeps text-stability only as the fallback.
- **One run hung for seventeen minutes with no output.** `frame.evaluate()` has
  no default timeout and does not reject on a frame that is mid-replacement. All
  polling of generated documents now goes through `evalSafe()`.

## Server changes

- `app_launchers` / `app_count` prompt vars (the literal attribute list and the
  count, derived from the manifest — so adding an app still needs no prompt
  edit).
- Per-engine `max_tokens` overrides, which SPEC §5 already sanctions
  ("Per-engine overrides in engines.json (temperature, max_tokens, reasoning
  switches…)") but the build did not implement. `cerebras-qwen38` needs it: see
  BAKEOFF-1.
- The provider's own `finish_reason: "length"` now sets `truncated` in the
  telemetry line. Before this, a document that stopped dead at exactly
  `max_tokens` was reported as a clean contract miss with `truncated: false`,
  which is how qwen's truncation hid for a whole sweep.

## Fast engines: keys landed, all four authenticate

`CEREBRAS_API_KEY`, `INCEPTION_API_KEY` and `OPENROUTER_API_KEY` are present, so
`/api/engines` now offers ten entries. Every one was proved with a 20-token
completion that returns visible content before any boot was run, because all
three fast families spend their whole budget on reasoning tokens by default and
return `content: null`:

| engine | model, verified against the provider's own `/models` | reasoning switch | 20-token probe |
|---|---|---|---|
| `cerebras-oss120` | `gpt-oss-120b` | `reasoning_effort: "low"` — `"none"` and `"minimal"` are **rejected** (`Unsupported reasoning effort`; only low/medium/high exist) | "Hello!", 3 reasoning tokens |
| `cerebras-qwen38` | `qwen-3.8-27b` | `disable_reasoning: true`. The `chat_template_kwargs: {enable_thinking:false}` that was in `engines.json` is **rejected by Cerebras** — that config never worked | "Hello there!", 0 reasoning tokens |
| `mercury-2.5` | `mercury-2.5` (and `mercury-2`) | `reasoning_effort: "none"`. `"low"`, `reasoning:{enabled:false}`, `thinking:false` and `diffusing_effort` all leave it thinking and return empty content | "Hello!", 0 reasoning tokens |
| `or-oss20-groq`, `or-oss120-groq`, `or-oss20-fast` | `openai/gpt-oss-20b` / `-120b` via OpenRouter | `reasoning_effort: "low"` + provider routing | "Hello!", `provider: "Groq"` |

Groq direct has no developer plan, so `groq-oss20` / `groq-oss120` stay in
`engines.json` hiding themselves, and Groq is reached through OpenRouter with
`{provider:{order:["Groq"],allow_fallbacks:false}}`. `or-oss20-fast` uses
`{provider:{sort:"throughput"}}` instead, which also resolved to Groq today.
Prices came from `GET /api/v1/models/<model>/endpoints` per provider (Groq
gpt-oss-20b 0.075/0.30, gpt-oss-120b 0.15/0.60 per 1M) and Mercury's from
Inception's own `/models`, which reports **0.04/0.15** — far below the 0.25/1.00
the spec estimated.

Desktop contract, same sweep, 6–8 generations each:

| engine | before | after |
|---|---|---|
| `cerebras-oss120` | 6/6 | — (no change needed) |
| `or-oss20-groq` / `or-oss120-groq` / `or-oss20-fast` | 6/6 each | — |
| `mercury-2.5` | 5/6 | **8/8** |
| `cerebras-qwen38` | **1/6** — `finish_reason: length` on five of six | **5/8** with the desktop cap raised to 12,000; it writes past 7,000 tokens every time |

`cerebras-qwen38` is the one engine that does not pass the gate. It is not a
prompt problem: it is a verbose model against a token cap, and the honest
options are a higher cap (already 12k) or dropping it. See BAKEOFF-1.

---

## What the first pass found

Kept verbatim for the before/after, from the run of
`node scripts/smoke.mjs --engines=anthropic-haiku,openai-small --desktops=10`
on 2026-09-17T00:42Z, total spend $0.4334:

- `anthropic-haiku`: identity **Meridian** v2.4, boot screen at 14,196 ms,
  desktop live at 49,653 ms, desktop sweep **9/10**. Misses:
  `template[data-os-window] template[data-os-task]`.
- `openai-small`: identity **Nebula Forge**, boot screen at 13,790 ms, desktop at
  38,028 ms, desktop sweep **2/10**, 21 elements injected on the boot it
  photographed, and the repair pass did not recover it either (0/1). It dropped
  `template[data-os-task]`, `[data-os-drag]` inside the window template, and
  sometimes every `[data-os-app]` launcher.
- Its desktop script threw `Cannot read properties of null (reading
  'appendChild')` — a generated script's own bug, harmless — and it tried to put
  `<iframe src="https://www.google.com/">` inside a generated document, which
  that document's CSP blocked. The second is the guarantee working, not a defect.

Timings and per-kind cost tables for the current prompts are in `BAKEOFF-1.md`,
which runs the same two engines for three full boots each alongside the six fast
engines; this file is the contract gate and the story of getting through it.
