# SERVER-v04 — five measurements, four of them answering a HANDOFF-5 issue

2026-09-17, ~20:24–21:20 PKT. Server-side pass over HANDOFF-5's brief:
per-kind token budgets, the ICON RULING in the prompts, a server-owned map
surface, an image-endpoint A/B with the endpoint made configurable, and a
re-measurement of `auto` against unhedged with the hedge trigger finally alive.

Scope held: `server/**`, `engines.json`, `test/**`, `scripts/**`, `prompts/**`.
`kernel/**` and `e2e/**` were read, never written. Nothing committed. Port 8799
and `dist/play.js` untouched; the probes used 8793 and 8794 and the e2e suite
its own 8770–8780. No caching added. No design instruction beyond §12.3's
structure and chrome legibility. Prompts stayed positive-form with no concrete
content examples.

**Spend: $0.457** — $0.137 tokens (BUDGET-2), $0.149 images (IMG-LATENCY-2),
$0.137 tokens (HEDGE-3), $0.034 for the live verification boot (§6). Each probe
prints its bill before it buys anything.

**Tree: green.** `npm test` **305 unit** (30 files, was 291/29 — 13 of the new
tests are mine; `test/trace.test.ts` arrived from the parallel kernel pass and
is not) · `npm run test:e2e` **100 passed / 2 failed, both transient**
(`e2e/apps.spec.ts` "reloading an app regenerates it" and "the updater can
reboot the machine": 5 of 5 pass on an immediate isolated re-run — the parallel
kernel pass rebuilt `public/kernel.js` mid-suite, which swaps the served kernel
under a running test) · `npm run build` clean · `npx tsc --noEmit` clean · one
live boot, 0 JS errors, 0 CSP refusals.

---

## 1 · Token budgets — one kind was starved and it is the one HANDOFF-5 saw

Full report: **`reviews/BUDGET-2.md`**, raw rows `reviews/budget-2-calls.json`,
instrument `scripts/kind-budget.mjs` (new). 54 calls, $0.137.

The probe **reproduced HANDOFF-5's truncated app window**: `kind=app` on
`photos` hit `finish_reason=length` **1 of 3** at 2,500 and left an *unclosed*
document; the same app at 4,000 stopped on its own three times out of three at
1,927–2,278 tokens. Nothing else measured is anywhere near its cap — desktop
p100 1,864 of 3,500, `notes` 1,703, `browser` 1,034, a reference page 1,604, a
search-results page 1,366.

The finding that decides the ruling: **raising a cap does not raise output.**
Medians were flat or lower at the higher budget in 8 of 9 pairs. These
documents are prompt-bound, not budget-bound — SPEC §12.1's brevity is being
enforced where SERVER-v03 argued it should be, and the cap is therefore
headroom rather than an invitation.

`engines.json` `defaults.max_tokens`: **app 2,500 → 4,000**, **page 2,500 →
3,200**, **repair 3,500 → 4,000** (a repair rewrites the document that ran out
of room, so it needs the largest document cap). `desktop` stays 3,500 and
`boot` stays 1,600 (53 clean boots). The measurement note is in `engines.json`
beside the numbers and the assertions in `test/engines.test.ts` carry it too.

**What the raise costs:** nothing per token — billing is on tokens produced.
The real price is the pre-reservation, `costUsd(engine, promptTokens,
maxTokensFor(kind))` held against `MAX_USD_PER_DAY` until the stream settles:
**+$0.001 reserved per app generation**, released immediately. The stream's
byte ceiling (`maxTokens × 5`) goes from 12,500 to 20,000 for an app; the
longest document in the whole probe was 6,917 characters.

**What it rules out:** HANDOFF-5 #1, the app window that paints nothing. A
starved generation produces a *truncated* document with `finish_reason=length`
and a telemetry line, which is not what boot A showed. "The budget starved it"
is off that hypothesis list.

## 2 · The ICON RULING, in the prompts

`prompts/images/icons.md` is rewritten. Sixteen numbered app shapes in manifest
order are **gone**; the sheet now asks for *sixteen identical blank icon
plates* — same shape, size, material and finish, `{{era_decade}}` interface
hardware, the boot's palette, the middle of every plate left clear, and no
symbols, pictograms, marks, objects, text, letters or numbers. The geometry
clauses the kernel's quarter-slicing depends on (`edge to edge`, `no gutters`,
`no grid lines`, `no frames`) survive untouched — that is mechanical, not
decorative, and it is the one clause that must never be trimmed. The prompt
went from ~1,200 characters to ~490.

The division of labour is inverted: **the picture supplies the plate, the model
supplies the meaning.** Because every cell is now the same, a mis-ordered sheet
is no longer possible — the failure the old prompt could not prevent has been
designed out rather than argued with.

`prompts/system/desktop.md` holds up the other half: the glyph inside
`[data-os-icon]` is now described as what tells a person which app this is
**permanently**, with the plate landing *behind* it, and the prompt asks for a
`font-size` around two thirds of the icon's box, `line-height:1`, a palette
colour and one `text-shadow` or outline, so the character holds whether the
plate turns out light or dark — one rule on `[data-os-icon]` for all of them.
The nine-item checklist gained the line. `prompts/system/voice.md`'s picture-slot
rules were corrected too: the launcher glyph is no longer "a glyph of yours
until the picture covers it".

`BUILTIN_ICONS` in `server/imgprompt.ts` matches, so a tree with no
`prompts/images/` still asks for plates. The kernel half of the ruling
(`centreGlyph`, and the removal of the two lines that set `color: transparent`)
was landed by the parallel kernel pass in `kernel/img.ts` — the two halves
agree.

## 3 · The map surface joins seam S3

`prompts/images/map.md` (new) and `map` added to `SERVER_OWNED_KINDS`.

The map was one of the three slots the *model* described, and
`prompts/apps/maps.md` asked it to name "the terrain this place sits in". Two
things were wrong with that. A terrain brief gets **terrain** — an honest answer
is "a cold estuary, low farmland, lightly built up", which from above is an
aerial photograph, which has no street network a route can follow. And the
model's SVG overlay (pins, labels, routes, scale bar) only reads over a flat
straight-down **plan**, which nothing in a per-document prompt guaranteed.

So the server writes it: a flat top-down illustrated street map of a city that
does not exist, printed cartographic style, a street network drawn as lines,
blocks, a river or coast, parks, the identity's palette, muted and low contrast
— with the projection stated three ways and `no aerial photography, no
satellite imagery, no photograph` said outright. Text, letters, numbers, legend,
compass, pins and markers are all banned, because every one of them is the
overlay's job in this machine's own language.

`prompts/apps/maps.md` was rewritten to match: the overlay is now explicitly
drawn *for a plan* (pins upright, labels flat and horizontal, routes along the
streets, the scale bar in a straight line, nothing in perspective), and route
distances and durations are in this reality's own units rather than the `km`
the old file asked for, which contradicted H5's reality offset.

**One loose end, left in the prompt on purpose.** The runtime collects picture
slots with `querySelectorAll('[data-os-img][data-os-prompt]')` and skips empty
prompts (`kernel/injected/runtime.ts`), so a map slot with no `data-os-prompt`
would never be requested at all. Until the kernel collects `map` without it,
`maps.md` asks the model to write the literal word `map` in the attribute — a
collection marker whose text the server discards. The alternative was a kernel
change this pass does not own; it is noted in `prompts/images/map.md` too.

## 4 · The image endpoint is a variable, and #6 is answered

Full report: **`reviews/IMG-LATENCY-2.md`**, raw rows
`reviews/img-latency-2-calls.json`, instrument `scripts/img-latency2.mjs`
(new). 48 images, $0.138.

**HANDOFF-5 #6 is answered and the answer is fal's queue, not our model.**
Every endpoint on the shelf — schnell included — sits at a **2.4–2.9 s median**
with a p100 of 3.2–3.6 s on the sync path, with **0 failures in 48 calls**.
BAKEOFF-4's 8.9 s median and 13.7 s worst on the same code and the same model
was therefore the provider's weather. There is nothing left to optimise here,
and the product's answer to a bad hour is already built (pictures fade in late;
nothing on screen waits for one).

| model | $/img | median | p100 | bytes | verdict |
|---|---|---|---|---|---|
| fal-ai/sana/sprint | $0.0025 | 2,447 ms | 3,571 | 269 KB | challenger |
| **fal-ai/flux-1/schnell** | $0.003 | 2,595 ms | **3,249** | **144 KB** | **default, unchanged** |
| fal-ai/sana | **$0.001** | 2,900 ms | 3,349 | 259 KB | challenger — 3× cheaper, tightest variance |
| fal-ai/z-image/turbo | $0.005 | 6,272 ms | 7,676 | 253 KB | rejected |

`sync_mode` is confirmed for the fourth time: the queue path is slower at all
four endpoints (`queue.fal.run` hands back a CDN URL, so we then pay a measured
1.2–1.8 s second round trip that `sync_mode` deletes), and every one of the
eight worst calls in the run — up to **21.4 s** — is on it.

The brief said "pick the fastest at ≤ $0.006". At n=6 that is **not resolvable**:
sprint and schnell are 162 ms apart on means of 2,573 ± 545 and 2,735 ± 396.
So the default did not move on an unresolvable 6% median with nobody having
looked at a single output, and the endpoint became a variable instead.

Mechanics, in `server/img.ts`: `IMG_MODELS` (each endpoint's own per-MP rate,
documented default steps and documented ceiling, read from its OpenAPI schema),
`resolveImgModel()` which **falls back to the default on anything unknown**,
`imgUsd(model)` which the route now reserves and bills with (replacing the flat
`IMG_USD`), `imgEndpoint()`, and `stepsFor(kind, model)` — which keeps the
measured 4/4/3/3/3 table for the default model only and gives every other
endpoint its own default clamped to its own ceiling, because a two-step
distilled model and an eighteen-step one do not mean the same thing by "3".
Telemetry carries `img_model`; `imgLog`'s hard-coded `engine: 'fal-schnell'` is
now `'fal'`.

## 5 · `auto` re-measured, alternated, with the trigger alive

Full report: **`reviews/HEDGE-3.md`**, raw rows `reviews/hedge-4-arms.json` and
`reviews/hedge-5-notrigger.json`. 56 generations, $0.137.
`scripts/hedge-probe.mjs` now takes comma lists for `--engine` and `--kind` and
**alternates** the arms one generation at a time — which is the whole
methodology, because HEDGE-2 measured the same provider at 798 and 1,047 ms of
median TTFB four minutes apart.

| arm | n | hedged | median first doc | p100 | **$/gen** |
|---|---|---|---|---|---|
| boot / auto | 10 | 6 | 1,408 ms | 2,504 ms | $0.002525 |
| boot / cerebras-oss120 | 10 | — | **980 ms** | **1,498 ms** | **$0.001990** |
| page / auto | 10 | 5 | 929 ms | **2,105 ms** | $0.003347 |
| page / cerebras-oss120 | 10 | — | **801 ms** | 2,311 ms | **$0.002791** |

**`auto` is +27% on a boot and +20% on a page, and bought no median speed in
either kind.** The primary won 19 of 20. BAKEOFF-4's "+55%" was a broken
trigger; this is the real premium.

**Recommendation for `/`: `DEFAULT_ENGINE=cerebras-oss120`, unchanged** — now
for a measured reason rather than an inherited one. `auto` stays the lever for
a bad hour and `ROUTING=off` the kill switch.

Two things this run got that no previous one did:

- **The hedge paid out twice**, which is HANDOFF-5 #3 becoming specific rather
  than closed: one **failover** (boot #3 — the lane that inked first did not
  finish the document) and one **Groq win** (page #5 — 4,349 characters, with
  Cerebras aborted at 0 output tokens). Both are still unlooked-at, and the raw
  rows name exactly which ones to open.
- **A control that says the routed path is free.** Run A's slow rows were all
  hedged rows, which could mean the routed code path costs something (the
  64-character commit hold) or that the trigger selects slow draws by
  construction. Sixteen more generations at `HEDGE_AFTER_MS_BOOT=60000` — the
  routed path and the hold fully exercised, no second lane possible — came back
  **indistinguishable** from unhedged (median 1,313 vs 1,119 ms, $0.00194 vs
  $0.00190). Routing is free; every cost belongs to the second lane. It also
  means run A's median column is confounded and the cost column is the one to
  quote.

The **code default for `HEDGE_AFTER_MS_BOOT` is still `0`**, and this pass
deliberately did not change it: the brief asked for a recommendation and a
documentation change. The recommendation is **1,200**, and until someone
changes the code, `auto` is only safe to deploy with the variable set
explicitly. `.env.example` and `DEPLOY.md` now say exactly that.

---

## 6 · The live boot — both prompt changes verified on a real machine

`node scripts/integrate.mjs --engines=cerebras-oss120 --apps=maps,photos,notes
--budget=1 --shots=server-v04`, viewport 1440×900, 21:00 PKT. **$0.034.**
Raw: `reviews/shots-server-v04/integrate.json`; shots in
`reviews/shots-server-v04/cerebras-oss120/`.

**Gold 1.3.0-rc4 (Δ-Cobalt)**, "Silent lines over static wires", a 1970s
village telephone exchange, `dock`, palette cork / sun-bleached / cream /
board. 7 images ($0.021): wallpaper, icons, **map**, 4 photos.
**0 JS errors, 0 CSP refusals, 0 blank windows, 3 of 3 windows focused.**

**The icon plates work.** `iconsFilled: 16` of 16 after the sheet landed, 0
launchers off screen and 0 overlapping across an 11×3 grid — and on
`03-desktop-settled.png` **every launcher shows the model's own glyph on top of
an identical cream plate**: a `B` for Browse, a framed picture for Gallery, a
wastebasket for Bin, a dotted calculator for Calc, a trolley for Market, an
envelope for Post, a speech bubble for Chat. Sixteen plates, one shape, one
material, one palette, no symbols in the picture — and the meaning is the
model's, legible, on top. This is the ruling working end to end on the first
real boot after it.

**The map surface works.** `04-app-maps-late.png` is a flat top-down street
plan — streets as lines, blocks between them, a river, parks, muted
cartographic colour — with the model's SVG overlay sitting correctly *on a
plan*: two upright pins labelled **Long Harrow** and **Skellow** (the session's
own `place_pair` die), a green route between them, and a route panel reading
"Distance: 12 thrum · Duration: 5 sight" — this reality's units from the Relay
Table, which is `maps.md`'s other fix landing at the same time. A layer
switcher offers Routes / Relief / Wash. `imgSlots: 1, imgFilledLate: 1`.

Two honest blemishes, neither a regression and neither in this pass's scope:

- **flux did not fully honour `no text` on the map.** A word or two of baked
  lettering and a faint attribution-shaped line survive at the bottom of the
  picture, small and low contrast. It is the same partial compliance the icon
  sheet used to show; at map scale it reads as map furniture rather than as a
  mistake, but it is worth a look before anyone calls the clause sufficient.
- **`photos` declared 4 slots and 1 landed** (`imgSlots: 4, imgFilledLate: 1`),
  with all four `photo` calls made and billed. That is BAKEOFF-4 #5's
  measurement finally being taken, and it is a different open issue from mine.

§12.1 timings on this boot, for the record: boot paint **1,182 ms** (target
< 1.0 s, provider-bound), desktop interactive **4,793 ms** (target < 4 s, miss),
apps 3,229 / 2,827 / 2,424 ms (target < 2.5 s, one inside). Connection ledger
peak 5. Those are HANDOFF-5's numbers and this pass did not move them.

---

## Files this pass changed

| file | change |
|---|---|
| `engines.json` | `app` 2,500 → 4,000, `page` 2,500 → 3,200, `repair` 3,500 → 4,000, with the measurement note |
| `server/img.ts` | `IMG_MODELS`, `IMG_MODEL_DEFAULT`, `resolveImgModel`, `imgUsd`, `imgEndpoint`, `stepsFor`; `falImage` takes a `model` |
| `server/imgprompt.ts` | `map` is server-owned; `BUILTIN_ICONS` rewritten to the ICON RULING; `BUILTIN_MAP` added; `BUILTIN` lookup table |
| `server/index.ts` | `/api/img` resolves `IMG_MODEL` per request and reserves/bills/logs at that model's rate; `img_model` in telemetry; `engine: 'fal'` |
| `server/telemetry.ts` | `img_model` field |
| `prompts/images/icons.md` | **rewritten** — sixteen matching blank plates |
| `prompts/images/map.md` | **new** — the server-owned map surface |
| `prompts/apps/maps.md` | rewritten for a plan-projection overlay and this reality's units |
| `prompts/system/desktop.md` | the glyph is permanent, sized and shadowed to read on a plate; checklist line |
| `prompts/system/voice.md` | three shell-owned slots, two self-described; the launcher-glyph exception corrected |
| `scripts/kind-budget.mjs` | **new** — the per-kind budget probe |
| `scripts/img-latency2.mjs` | **new** — the four-endpoint image A/B, sync vs queue |
| `scripts/hedge-probe.mjs` | comma lists for `--engine`/`--kind`, alternating plan, per-arm statistics |
| `test/engines.test.ts` | the new caps, with the measurement in the comments |
| `test/img.test.ts` | +5 tests for `IMG_MODEL` (fallback, pricing, steps, endpoint, request body) |
| `test/imgprompt.test.ts` | the plate assertions replace the manifest-order ones; +1 test for the map prompt; every loop covers three kinds |
| `.env.example` · `DEPLOY.md` | `IMG_MODEL` with the measured table, the hedge recommendation, `IMG_TIMEOUT_MS` corrected 10,000 → 18,000 (the docs had drifted from the code) |
| `reviews/BUDGET-2.md` · `IMG-LATENCY-2.md` · `HEDGE-3.md` + four raw JSON files | the measurements |

## Open, ranked, for the next pass

1. **HANDOFF-5 #1 is still the top issue** and this pass narrowed it rather than
   fixing it: the budget is now ruled out (BUDGET-2 finding 2). The next step is
   still HANDOFF-5's own — telemetry lines on `netOpen`/close and entry/exit
   logging around `openApp`'s four steps.
2. **The icon plates and the map surface now have one live boot each** (§6) and
   both did exactly what the ruling asked. What is still unjudged is *taste*:
   whether sixteen cream plates with the model's glyphs on them look better to
   Shahmir than sixteen wrong symbols did. One `/bakeoff` boot answers it.
   Also open from §6: flux leaves a word or two of baked lettering on the map
   despite `no text` three times over.
3. **`fal-ai/sana` is a 3× cut on the image line of every boot** for +305 ms of
   median and the tightest variance in the run. One `IMG_MODEL=fal-ai/sana`
   boot with someone looking at the wallpaper and the plate sheet is a
   ten-minute, six-cent decision.
4. **The Groq payouts are named and unopened** (HEDGE-3, `hedge-4-arms.json`).
5. **`HEDGE_AFTER_MS_BOOT`'s code default of 0** — the one decision left to the
   architect, with three runs of evidence against it.
6. **`auto` has never been measured on a bad hour**, which is the only hour it
   exists for. Not schedulable.
7. **`photos` still is not in `scripts/integrate.mjs`'s default `--apps`**
   (HANDOFF-5 #5). It is the app that truncates and the app that buys pictures,
   and it has to be in the protocol rather than remembered.

## Traps this pass walked into

- **A middling shape hides a per-kind fault.** `notes` at 2,500 is clean three
  times out of three; `photos` at the same budget truncates. A per-kind budget
  is a claim about the *longest* document of that kind, so the probe has to be
  pointed at the longest one — which is why `--app-id` and `--page-url` exist.
- **"Pick the fastest" can be an unanswerable instruction at n=6**, and the
  useful output is then the rejection (z-image, 2.4× slower) plus a variable,
  not a coin flip dressed as a decision.
- **An absurd parameter value is still the cheapest instrument in this repo.**
  `HEDGE_AFTER_MS_BOOT=60000` cost 3 cents and removed two hypotheses that
  reading `hedge.ts` had not settled — the same trick that found the dead
  trigger.
- **A prompt change can be silently inert because of a selector in another
  layer.** Telling the model to stop writing `data-os-prompt` on the map slot
  would have stopped the map being requested at all, because the runtime
  selects on that attribute's presence. Prompt edits need the consuming code
  read, not assumed.
