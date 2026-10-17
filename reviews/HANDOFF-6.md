# HANDOFF-6 — the blank app window is gone, measured by an impatient visitor

2026-09-17, ~21:05–00:xx PKT. Integration pass over the two parallel v0.4
builds (`reviews/KERNEL-6.md` — the blank-window fix, the trace, the ICON
RULING's kernel half; `reviews/{BUDGET-2,IMG-LATENCY-2,HEDGE-3}.md` — the
budgets, the image endpoints, the hedge arms and the map prompt), then the
stress run the brief asked for and the full verification from a wiped tree.

**Headline: 64 app opens on 8 real boots, 0 blank windows, 0 opens lost.**
KERNEL-6 found the cause on mock (the desktop's click delegation skipped
anything inside `[data-os-dock]`, an attribute in the MODEL's namespace) and
this pass is the real-engine proof: **4 of the 8 boots were `dock`
archetypes** — the shape that lost 4 of 4 windows in HANDOFF-5's boot A — and
every launcher inside a dock or a bar that was clicked opened and filled.

**Second finding, from the verification and not from the code: the deployment
recommendation everyone has been writing down does not work.**
`DEFAULT_ENGINE=cerebras-oss120` does **not** take `/` off the router. A live
boot of `/` with that variable set was served by `auto` and **hedged**
(§"The variable that does nothing").

**Tree state: green.** `npm test` **305 unit** (30 files) · `npm run test:e2e`
**102 e2e** on mock · `npm run build` clean · `npx tsc --noEmit` clean.
Nothing committed. Port 8799 and `dist/play.js` untouched; the stress and
probe runs used ephemeral ports, the verification server 8790, and the suite
its own 8770–8780.

**Spend: $0.93** against the $4 ceiling. $0.43 the stress runs (8 boots ×
8 opens, images on), $0.25 three rehearsals that turned out to be on a real
engine (see Traps), $0.03 the map probe, $0.22 the final verification
(2 boots + one boot of `/`). No image was bought on a mock run once the
rehearsal bug was fixed.

---

## 1. The stress run — an impatient visitor, 8 apps a boot

`scripts/stress.mjs` (new). Six boots on `engine=auto`
(`reviews/shots-stress-1/`), then two more with refusal instrumentation
(`reviews/shots-stress-2/`); raw rows in each directory's `stress.json`.
Per boot: eight apps opened on a ~420 ms cadence with no wait for anything to
settle, in four patterns —

| pattern | what it does | opens | painted |
|---|---|---|---|
| `plain` | one hit-tested click | 16 | **16** |
| `cross` | mouse **down on one launcher**, up over another, then click the target — §12.1's speculative generation is started for an app the visitor never opens | 16 | **16** |
| `double` | a real double click | 16 | **16** |
| `rapid` | fired 60 ms after the previous open, while that window is still streaming | 16 | **16** |

What the runner does differently from the suite, on purpose (KERNEL-6's
remaining issue 2): the clicks are **real, hit-tested mouse events at the
launcher's coordinates**, not `dispatchEvent`. A dispatched click cannot
reproduce the bug that cost four windows, and the whole e2e suite dispatches.
**44 of the 64 opens were real clicks**; the other 20 were on launchers buried
under a window even after the runner dragged the covering window aside (a shove
by the model's own `[data-os-drag]`, 20 times, which is also the only exercise
`drag` gets in this pass), and those fall back to the dispatched pair and say
so.

| reading | value |
|---|---|
| opens | **64** (8 boots × 8) |
| **painted** | **64 / 64** |
| **blank windows** (a window created that never inked) | **0** |
| clicks that reached no launcher at all | **0** |
| archetypes | **4 `dock`, 4 `taskbar`** |
| opens on a launcher inside a dock/bar | 5, **5 painted** |
| app ink, kernel's own `ink_ms` | median **1,425 ms**, p90 4,437 ms, p100 10,708 ms; **50 of 64 inside §12.1's 2.5 s** |
| boot screen ink | 906–2,638 ms (median ~1,250) |
| desktop interactive | 2,274–8,670 ms |
| connection ledger peak | **6–16** requests open at once, no starvation, no queue screen |
| JS errors | model scripts only (`openAlbum is not defined`, `<circle> attribute r`), 0 kernel errors |
| CSP refusals from generated documents | 0 |

Two things in that table are worth more than the pass/fail:

- **`net.peak` reached 16** — a boot generation, a desktop generation, eight app
  generations and the pictures, all live. HANDOFF-4's invariant ("never more
  than three live generations") is comprehensively false under an impatient
  visitor, and **nothing starved**. That is the last nail in the HTTP/1.1
  socket-exhaustion hypothesis three passes spent on: the blank window was
  never about connections (KERNEL-6 proved the cause; this proves the load).
- **The ink distribution has a tail, not a floor.** The median app is inked in
  1.4 s with seven other documents streaming; the p100 of 10.7 s is a provider
  serving eight concurrent streams to one visitor. Nothing was lost — they all
  arrived — but §12.1's 2.5 s app target holds for 50 of 64 opens, not all of
  them.

### Blank-window rate, before and after

| run | archetypes | app opens | blank windows |
|---|---|---|---|
| HANDOFF-5 boot A (v0.3) | `dock` | 4 | **4** (no window ever existed) |
| HANDOFF-5 boot B (v0.3) | `taskbar` | 4 | 0 |
| KERNEL-6 repro on mock, v0.3 guard restored | `dock` fixture | 2 | **1–2** |
| KERNEL-6 after the fix, mock | `dock` fixture | 2 | 0 |
| **this pass, real engines** | **4 `dock` + 4 `taskbar`** | **64** | **0** |

## 2. The variable that does nothing — `DEFAULT_ENGINE` vs `/`

HEDGE-3's recommendation and HANDOFF-5's Railway table both say
`DEFAULT_ENGINE=cerebras-oss120`, "`auto` is the lever, not the default". The
verification server was started with exactly that, and:

- `GET /api/engines` answers **`default: auto`**, `routing: true`, `auto` first
  in the list.
- A real boot of **`/`** (not `/bakeoff/run`) with that variable set produced
  `{"kind":"boot","engine":"cerebras-oss120","hedged":true,...,"usd":0.00301}` —
  the routed, hedged path, at the hedged price ($0.0030 against $0.0019).

The cause is two deliberate lines:

- `server/index.ts` `advertisedDefault()` honours `DEFAULT_ENGINE` **only when
  it names a mock engine**, and otherwise returns `auto` whenever routing is
  usable.
- `kernel/index.ts` `chooseEngine()` prefers `auto` on `/` (`MODE === 'plain'`)
  whenever `/api/engines` lists it, before it ever looks at the server default.

So today there are exactly two ways to put `/` on a single engine, and neither
is the documented one:

| want | do |
|---|---|
| `/` unhedged on the primary | **`ROUTING=off`** — verified: `default: cerebras-oss120`, `routing: false`. It also removes the hedge everywhere, which is the point of the kill switch and not a setting |
| `/` routed and hedged only when the primary is slow | what you already have — plus **`HEDGE_AFTER_MS_BOOT=1200`, `HEDGE_AFTER_MS=900`**, without which every boot buys two lanes |

**This is the architect's decision, not mine, so nothing was changed.** The
honest reading of HEDGE-3 is that `/` is meant to be `cerebras-oss120` and the
code does not allow it without also throwing the hedge away; the fix is one
clause in each of the two functions above (honour a real `DEFAULT_ENGINE`), and
it is the first thing to decide before a deploy, because the money and the
first second both hang off it.

## 3. The ICON RULING, on live desktops

The plate/glyph division of labour (architect, 2026-09-17: the picture supplies
sixteen identical blank plates, the model's glyph supplies the meaning, the
kernel puts the plate *behind* the glyph) is verified on every boot this pass.

| reading | before (HANDOFF-5 / BAKEOFF-4) | after (8 stressed boots + verification) |
|---|---|---|
| glyph visible after the sheet lands | **hidden** — the kernel set `color:transparent` and painted the cell over it | **visible in 100% of slots**, its own colour, `visibility:visible`, opacity 1 |
| glyph semantics | perfect, then covered by a picture in the wrong cell (weather got a music note) | perfect and **left alone**: 🧭 browser, 📷 photos, 🗑 trash, 🧮 calculator, 🏬 store, ✉️ mail, 🗺️ maps, ☁️ weather, 📰 news, 📝 notes, 🎲 games, 🔄 update, ℹ️ about |
| glyph size / box | — | `32px` in a `48×48` box on every launcher of every boot — exactly what `prompts/system/desktop.md` asks for |
| plate | sixteen *named subjects*, mis-ordered | sixteen **identical blank plates**; where it landed, the set reads as one set |
| box moved when the picture landed | — | **0 slots moved** (the kernel's centring reverts itself if it moves anything) |
| sheet landed | 16/16 | **plates on 5 of 8 stressed boots**, 16/16 cells when it landed (24-slot desktops fill their 16 launchers and leave the surplus, as designed) |

The eye check: `reviews/shots-stress-2/boot-1/02b-desktop-plates.png` is the
frame to look at — sixteen identical teal plates, each with the model's own
glyph centred on it, labels under them, on a photographic wallpaper.

**The one defect: the sheet is the picture most likely to be lost.** The icon
sheet is 1024×1024, the largest of the boot's pictures, and under stress it took
**5.3 s and 14.2 s** in the two instrumented boots while `IMG_TIMEOUT_MS`
defaults to 10 s; the boots with no plates carry an image `504` (timeout) or an
`engine_dead` image refusal in their logs. The failure is graceful — the
desktop keeps the model's own icon art, and after this ruling the glyph is
still there, which is exactly what the ruling bought — but three of eight
stressed desktops paid for a sheet they did not get. `IMG_TIMEOUT_MS=20000` is
a one-variable mitigation; the structural answer is to ask for the sheet at
768×768, which IMG-LATENCY-2's numbers say is ~2.5 s.

## 4. The map surface, before and after

`prompts/images/map.md` (new, server-owned, seam S3) and the rewritten
`prompts/apps/maps.md` were verified live twice.

- **Before (BAKEOFF-4):** the model described "the terrain this place sits in"
  and got a landscape — from above, an aerial photograph, with no street network
  a route could follow, under an overlay drawn for a plan.
- **After:** `reviews/shots-map-probe/map-24s.png` — a **flat top-down printed
  street plan**: street network, blocks, a river, a plaza, in the machine's own
  blue, no perspective, no photograph, no text of its own. The model's SVG
  overlay (pins, route, labels, scale bar in this reality's units) sits on it in
  the projection it was drawn for.

Mechanically: `scripts/map-probe.mjs` (new) reads the slot itself. The slot is
asked for (`data-os-img-slot="s1"`, `data-os-prompt="map"` — the collection
marker the server discards), the picture arrives (`data-os-img-filled="map"`,
a `data:image/jpeg` background, `background-size:cover`), and
`elementsFromPoint` at the middle of the surface returns **the slot itself** —
nothing of the model's covers it.

**But it arrives at 6–10 s.** In the stress runs the map picture was bought on
every boot that opened `maps` (633 KB, 8.1 s) and was not yet on screen when
the window was photographed — which is why `shots-stress-1/boot-*/04-maps.png`
shows a paper-coloured surface with the overlay on it and looks like a failure.
It is not a failure; it is the picture being slower than the document by a
factor of four. Anybody judging a map surface has to wait for it.

## 5. Budgets (from BUDGET-2, integrated and re-verified)

`engines.json` `defaults.max_tokens`: `app` 2,500 → **4,000**, `page` 2,500 →
**3,200**, `repair` 3,500 → **4,000**; `boot` 1,600 and `desktop` 3,500
unchanged. The one measured truncation was `kind=app` on `photos`
(`finish_reason=length` at exactly 2,500, 1 of 3, unclosed document); nothing
else measured is within 1.9× of its cap, and raising a cap did **not** raise
output in 8 of 9 pairs — these documents are prompt-bound, not budget-bound.
In this pass's 64 app generations at the new cap there were **0 truncations and
0 unclosed documents**, including eight `photos` opens.

## 6. Images — the endpoint pick (from IMG-LATENCY-2)

`fal-ai/flux-1/schnell` stays the default, now with numbers under it: 48 calls
across four endpoints, 0 failures, every endpoint's median 2.4–2.9 s, and
**`fal.run` with `sync_mode` beats `queue.fal.run` at every endpoint** (worst
queue call 21.4 s) — which is the answer to BAKEOFF-4's 8.9 s median: it was
fal's queue, not the model. `z-image/turbo` is rejected (2.4× slower and
dearer). `IMG_MODEL` is now an environment variable with per-model price, steps
and a fallback on a typo, so `sana` ($0.001, 3× cheaper) and `sana/sprint` are
one variable away if the picture bill ever matters. This pass's own image
numbers agree: wallpaper 2.6–6.0 s, photos 2.9–6.8 s, the map 8.1 s, the
1024×1024 icon sheet 5.3–14.2 s (§3).

## 7. `auto` vs unhedged — the recommendation

**`/` should be a single engine (`cerebras-oss120`), and `auto` is the lever.**
HEDGE-3 measured it on 40 generations with a working trigger: `auto` is 20–27%
dearer, is not faster at the median in either kind, is worse at the boot p100,
and its primary won 19 of 20. This pass adds two data points and does not
change that verdict:

- 8 boots × 10 generations on `auto` at `HEDGE_AFTER_MS_BOOT=1200`: every
  document that carried an engine came from **`cerebras-oss120`**, the hedge
  appearing only as `lost or-oss120-groq` in the HUD. Cost $0.037–$0.061 a
  boot, images included.
- The live `/` boot in §2 shows what "hedged" costs when the trigger is at its
  code default of 0: **$0.0030 for a boot that is $0.0019 unhedged.**

So: `ROUTING=off` for the cheapest, judgeable `/` today; or the one-clause fix
in §2 plus `HEDGE_AFTER_MS_BOOT=1200` to keep the insurance armed for a bad
afternoon. Either way **`HEDGE_AFTER_MS_BOOT` must be set explicitly** — the
code default buys a second full input pass on every boot.

## 8. The verification sequence, step by step

From a wiped tree: `rm -rf node_modules dist/server.js public/kernel.js`
(`dist/play.js` left alone), `npm ci`, `npm run build`, `npx tsc --noEmit`,
then `PORT=8790 DEFAULT_ENGINE=cerebras-oss120 HEDGE_AFTER_MS_BOOT=1200
HEDGE_AFTER_MS=900 node dist/server.js`.

| check | result |
|---|---|
| `npm ci` | 7 top-level packages, clean |
| `listening` line | 9 keyed engines, `moderation: auto`, caps `60/h · 10,000/day · $25`, `kernel public/kernel.js 123,496 b` |
| `GET /healthz` | 200 |
| `GET /api/engines` | 200 — **`default: auto`** (§2), `routing: true`, `auto` first, per-kind routes published |
| `GET /` | 200, 948 b (the kernel page is meant to be empty) |
| `GET /bakeoff` | 200, 6,740 b |
| `GET /bakeoff/run?engine=cerebras-oss120` | 200, 950 b |
| `GET /api/stats` · `/robots.txt` | 200; `Disallow: /api/`, `Allow: /` |
| `ROUTING=off` control | `default: cerebras-oss120`, `routing: false` |
| a real boot of `/` | booted, named itself, hedged — §2 |
| `npm test` | **305 passed**, 30 files, 8.6 s |
| `npm run test:e2e` | **102 passed** on mock, 5.7 min |

## 9. The two verification boots

Two boots on the wiped tree at 21:37 (`auto`, `cerebras-oss120`), and two more
at 22:30 on a second wipe (`verify-b/`, the integration pass below). All four
opened `browser`, `calculator`, `notes`, `store` and walked the browser through
home → search → result → two URLs.

| | v04 `cerebras-oss120` | v04 `auto` | verify-b `cerebras-oss120` | verify-b `auto` |
|---|---|---|---|---|
| identity | **`UNNAMED/0OHK` · "it boots."** — the kernel's fallback | FORGECAST · 2020s bell foundry | Pine | Ada |
| archetype | dock | dock | taskbar | taskbar |
| boot frame inked | **never** (no `01-boot.png` to shoot) | 963 ms | 3,401 ms | 1,943 ms |
| desktop interactive / revealed | 9,577 / 9,885 ms | 4,473 / 4,834 ms | 7,494 / 7,882 ms | 5,399 / 5,833 ms |
| desktop contract | ok | **miss**, 8 launchers injected | ok | ok |
| launchers, and how many off screen | 24, **0** | 16, **all 16** | 16, **0** | 16, **0** |
| icon plates | 16/24 | 16/16 | 16/16 | 16/16 |
| wallpaper | **none** (2 × `/api/img` 504) | slot | none | slot |
| apps painted | 4/4 | 4/4 | 4/4 | 4/4 |
| app ink | 2.0–2.4 s | 2.0–2.4 s | 3.6–8.9 s | 3.6–5.2 s |
| pages | 5/5 | 5/5 | 5/5 | 5/5 |
| clock ticks | yes | yes | yes | yes |
| JS errors / CSP blocks | 2 (both the image 504) / 0 | 0 / 0 | 2 (both the image 504) / 0 | 0 / 0 |
| $ | 0.0190 | 0.0348 | 0.0366 | 0.0466 |

Every app and every page arrived on all four. The two defects in that table are
not in the window path and are ranked below: the **identity fallback** on the
v04 `cerebras-oss120` boot (`UNNAMED/0OHK` is `kernel/contract.ts`'s default —
the first one measured since `server/identity.ts`'s rescue landed, and HANDOFF-5
reported 0 in 32 boots), and the v04 `auto` boot whose **sixteen launchers were
all off screen**: `contract: miss`, eight launchers injected, `icons applied:
16` — and a visitor looking at `shots-final-v04/auto/03-desktop-settled.png`
sees a photograph, an empty bar and nothing to click. Its four apps opened only
because the harness does not need a launcher.


---

## Remaining issues, ranked

**1. A desktop with nothing to click — 2 of 9 `dock` boots, 0 of 9 `taskbar`
boots.** Both losses put *every* launcher off screen (16/16), both reported
`contract: ok` or a miss the kernel had already repaired, both applied their 16
plates to launchers no visitor can see, and one of them
(`shots-desk-probe-1/boot-7`, "Luna Watch") offers a single 10-pixel hamburger
as the only affordance on the screen. This outranks everything else here: the
open path this pass proved (64/64) cannot be reached at all on such a boot, and
it is ~20% of the archetype that SPEC §12.3 describes as a dock.
The kernel measures it and deliberately does not repair it
(`kernel/index.ts` `offscreenLaunchers`, "Measured, never repaired"), and
`prompts/system/desktop.md` already forbids it twice, in its own section
("The launcher grid — the rule that is broken most often", plus the dock's
"a second row … puts its own icons below the bottom of the screen"). So the
next move is a ruling, not a repair, and there are only three:
(a) let the kernel scroll or clamp the launcher area into view — it already
clamps `html`/`body` and grows the taskbar, so the precedent is there and the
line to argue is whether launchers are "geometry, not style";
(b) another prompt iteration on the dock split (the two failures are both
docks, and the prompt's dock branch is where the arithmetic is hardest);
(c) accept it as this machine's own design and let 1 boot in 5 be unusable.
`scripts/desk-probe.mjs` now records the launcher's box and its ancestor chain
on any boot that loses one, so the next occurrence names the element instead of
the count — the two we have were caught before that instrument existed.

**2. `DEFAULT_ENGINE` cannot put `/` on one engine** (§2, re-verified on a
second wiped tree at 22:27: `DEFAULT_ENGINE=cerebras-oss120` → `/api/engines`
answers `default: auto`, `routing: true`). Two clauses, one in
`server/index.ts` `advertisedDefault()` and one in `kernel/index.ts`
`chooseEngine()`. Until one of them changes, the deploy has exactly two shapes —
`ROUTING=off` (cheapest, no hedge anywhere) or routed-and-hedged with
`HEDGE_AFTER_MS_BOOT=1200` — and the *code default* of 0 buys a second full
input pass on every boot. Decide this before Railway, because it is the money
and the first second at once.

**3. The icon sheet and the wallpaper are the two pictures that go missing, and
the 10 s timeout is the reason.** Quiet boots: plates landed **13 of 14**,
median **2.5 s** — but two of the thirteen took **11.6 s and 12.1 s**, i.e.
past `IMG_TIMEOUT_MS`'s 10 s default and only alive because the kernel applies
a picture whenever it lands. The one loss and one of the four verification
boots carry `/api/img 504`. Under the stress runner (eight app generations in
flight) the sheet took 5.3–14.2 s. `IMG_TIMEOUT_MS=20000` is the one-variable
mitigation; asking for the sheet at 768×768 instead of 1024×1024 is the
structural one (IMG-LATENCY-2: ~2.5 s). Separately, `wallpaperOn: none` on
**5 of 14** quiet boots with no HTTP refusal in four of them — either the model
declared no wallpaper slot or the picture was never applied, and the instruments
cannot currently tell those apart. Worth one cheap probe before anyone calls it
a defect.

**4. The app-ink tail, not the floor.** 50 of 64 stressed opens inked inside
§12.1's 2.5 s; the p90 is 4.4 s and the p100 10.7 s, with eight documents
streaming to one visitor. Nothing was lost and nothing starved (`net.peak` 16).
If the 2.5 s target is meant to hold under an impatient visitor rather than at
the median, the lever is the per-kind concurrency the kernel allows, not the
budgets (BUDGET-2: these documents are prompt-bound).

**5. One identity fallback in 18 real boots today** (`UNNAMED/0OHK`, §9) after
0 in HANDOFF-5's 32. Not a regression anyone can act on yet — one event — but
`server/identity.ts` exists precisely to make this 0, so it needs a counter in
the next sweep rather than a shrug. The same boot never inked its boot frame
and took 9.6 s to an interactive desktop: worth checking whether the three ride
together (a slow, reasoning-heavy generation losing identity, boot ink and time
at once) before treating them as three findings.

**6. A double click opens two windows** (10 of 16 real double clicks). Not a
blank window — both painted — but it doubles the cost of an impatient visitor
and puts a duplicate in the bar. A 300 ms per-app guard in the kernel's own
delegation would end it; whether a machine of this era *should* swallow the
second click is a design question, which is why this pass only measured it.

**7. The e2e suite still dispatches its clicks** (KERNEL-6 #2). 102 tests pass
on a code path that cannot reproduce the bug that cost HANDOFF-5 four windows;
`scripts/stress.mjs` is the only hit-tested clicker in the tree and it needs a
real engine to run. One e2e spec that clicks a dock launcher by coordinate on
the mock engine would close the loop for free.


## Rules this pass worked under

No pixel of ours except queue/error text and the `/bakeoff` surfaces — the new
instruments (`window.__osTrace`, the runner's own pointer probe) paint nothing
and the probe is installed by the harness in the page, never by the kernel. No
caching. No prompt was written this pass (`prompts/**` was read only). No
design instruction beyond §12.3 and the ICON RULING already in the tree.
`dist/play.js` untouched, port 8799 never used, nothing with `play.js` in its
command line signalled. Nothing committed.

## Files this pass changed

| file | change |
|---|---|
| `scripts/stress.mjs` | **new** — the impatient visitor: real hit-tested clicks, four patterns, per-open painted/ink/trace, the shove, the pointer probe, `--images=off`, `--engine=mock` that is actually mock |
| `scripts/map-probe.mjs` | **new** — where the map picture goes: the slot, its `data:` background and what is in front of it, read at 2/6/10/16/24/32 s |
| `reviews/shots-stress-1/` · `shots-stress-2/` | 8 boots, 64 opens, shots + `stress.json` |
| `reviews/shots-map-probe/` | the map surface at six ages + `map-probe.json` |
| `reviews/shots-final-v04/` | the two verification boots and the `/` boot |
| `reviews/HANDOFF-6.md` | this file |

Nothing under `kernel/`, `server/`, `prompts/`, `engines.json`, `test/` or
`e2e/` was touched by this pass: the two builds it integrates were already
green, and the one defect it found in them (§2) is a ruling, not a repair.

## Traps this pass walked into, for the next one

- **`?engine=mock` silently boots a real provider.** `mock` only appears in
  `/api/engines` when `ALLOW_MOCK=1`, `NODE_ENV=test` or `DEFAULT_ENGINE=mock`
  (`server/engines.ts` `mockAllowed`), and `chooseEngine` drops a query engine
  that is not in the list — so a rehearsal asking for `mock` runs on
  `cerebras-oss120` and buys tokens and pictures. Three of this pass's
  rehearsals did exactly that ($0.25). A harness that says `mock` must set
  `ALLOW_MOCK=1` and assert the engine in the telemetry, which
  `scripts/stress.mjs` now does.
- **A launcher's box goes stale within a second.** The desktop-time snapshot is
  wrong by the time the pictures land, and a dock with hover magnification moves
  its icons under the pointer; a coordinate click on a stale box lands on
  nothing and leaves **no line in the kernel's trace**, which looks exactly like
  the bug being hunted. Re-measure the box immediately before every click, and
  record what the pointer actually hit.
- **A double click opens two windows** (10 of 16 real double clicks). Any
  harness that counts windows has to expect that, and any cost measured from a
  double-clicking visitor is double.
- **macOS `sharingd` takes port 8770.** The e2e suite binds `::` and fails to
  start with `EADDRINUSE` from a system service, not from another agent. Check
  `lsof -nP -iTCP:8770` before blaming a neighbour.
- **A screenshot of a map is a screenshot of the wrong thing for eight
  seconds.** Wait for `[data-os-img-filled]`, do not trust the frame the
  document settles in.

---

# Second pass — independent replication, three amendments, one new cause

2026-09-17, ~22:40–23:20 PKT. The same brief, run again from a cold start by a
second integrator with no state from the pass above. Everything from §1 to §9
was re-tested rather than read. **Spend: $0.383** ($0.312 the stress
replication, $0.071 the two verification boots) — the pass total is now $1.31
against the $4 ceiling.

## R1. The tree, verified twice

| check | current tree | wiped tree (`rm -rf node_modules public/kernel.js dist/server.js`, `dist/play.js` left) |
|---|---|---|
| `npx tsc --noEmit` | clean | clean |
| `npm ci` | — | 7 top-level packages, clean |
| `npm run build` | clean, `public/kernel.js` 123,496 b | same byte count |
| `npm test` | **305 passed** (30 files, 8.6 s) | **305 passed** (8.5 s) |
| `npm run test:e2e` (mock) | **102 passed** (5.8 min) | **102 passed** (5.7 min) |

Server on **8790** with `PORT=8790 DEFAULT_ENGINE=cerebras-oss120
HEDGE_AFTER_MS_BOOT=1200 HEDGE_AFTER_MS=900`: `/healthz` 200, `/api/engines`
200 (2,914 b), `/` 200 (948 b), `/bakeoff` 200 (6,740 b),
`/bakeoff/run?engine=cerebras-oss120` 200 (950 b), `/api/stats` 200,
`/robots.txt` 200 (`Disallow: /api/`, `Allow: /`). Port 8799 and `dist/play.js`
untouched throughout; nothing committed.

## R2. The stress run, replicated — 48/48, 0 blank windows

`node scripts/stress.mjs --boots=6 --engine=auto --opens=8 --shots=stress-3`
(`reviews/shots-stress-3/`, raw rows in `stress.json`). Six boots on `auto`,
eight opens each on a ~420 ms cadence, the four patterns of §1.

| reading | this run | §1 (first pass) |
|---|---|---|
| opens | **48** (6 × 8) | 64 |
| **painted** | **48 / 48** | 64 / 64 |
| **blank windows** | **0** | 0 |
| clicks that reached no launcher | **0** | 0 |
| real hit-tested clicks | 22 of 48 | 44 of 64 |
| archetypes | **3 `dock`, 3 `taskbar`** | 4 / 4 |
| app ink (kernel `ink_ms`) | median **1,031 ms**, p90 2,128, p100 5,278 (n=47) | median 1,425, p100 10,708 |
| connection-ledger peak | 6–25 | 6–16 |
| CSP refusals from generated documents | 0 | 0 |
| kernel JS errors | 0 (18 console lines, all `/api/img 429` — R3) | 0 |

Every launcher inside a dock or a bar that was clicked opened and filled, on
three fresh `dock` boots. **The combined real-engine sample is now 112 opens on
14 boots (7 of them `dock`) with 0 blank windows.** KERNEL-6's cause and fix
stand; I found nothing to add to them.

The ink distribution is *better* than §1's, on the same script and the same
engine — median 1.03 s against 1.43 s, p100 5.3 s against 10.7 s. §4's
"impatient visitors see a tail" is real but it is provider weather, not a
property of the code.

## R3. New cause of a picture-less desktop: our own 30-image session ceiling

Boot 5 lost 8 pictures and boot 6 lost **all 11** — including the wallpaper and
the icon sheet — to `HTTP 429`, `blocked: "session"`, `refusal: "queue"`. Boot
6's desktop therefore has **0/16 plates and no wallpaper**, and it is the one
boot in this run that looks unfinished.

The cause is `server/img.ts` `SESSION_LIMIT = 30`, charged to the **ip hash**
with a 30-minute TTL. Six boots from one machine through one server share that
bucket: boots 1–4 spent exactly 30 images, and boots 5–6 got the backstop.

Two consequences, and the second is the bigger one:

1. **In production this is correct behaviour**, and it is also a real edge for
   visitors behind one NAT — the 31st picture of the half-hour is refused
   whoever asks for it. The refusal is graceful (the desktop keeps the model's
   own icon art and CSS wallpaper) but it is 8 console errors a visitor's
   devtools would show.
2. **Every multi-boot measurement in this repo run from one machine is capped
   at 30 pictures**, so the image statistics of any sweep past its ~7th boot are
   an artefact of our own ceiling. §3's "three of eight stressed desktops paid
   for a sheet they did not get" and remaining issue 3's "5 of 14 quiet boots
   with `wallpaperOn: none`" are both from sweeps long enough to hit it — that
   open question ("the instruments cannot tell those apart") now has a candidate
   answer that costs nothing to test: the probes must restart the server between
   boots, or run with a raised `SESSION_LIMIT`, before any of those rates mean
   anything.

Image outcomes, all 50 requests of this run: **23 delivered · 19 refused by our
own session ceiling · 8 upstream `engine_dead`** (6 `photo`, 2 `map`, all
0 bytes, 0.9–7.6 s). Of the 31 that were not session-refused, **26% failed
upstream** — against IMG-LATENCY-2's 0 failures in 48 serial calls. Concurrency
is the difference, and that is a new ranked issue below.

## R4. Three amendments to §3 and remaining issue 3 — the numbers there are stale

Read off the current tree, not from the report:

- **The icon sheet is already 768×768**, and the wallpaper 768×432
  (`server/img.ts` `IMG_SIZES`). §3's "the icon sheet is 1024×1024, the largest
  of the boot's pictures" and its "structural answer … ask for the sheet at
  768×768" describe a change that landed in v0.2 (IMG-LATENCY-1). There is no
  1024 picture in this product.
- **`IMG_TIMEOUT_MS` defaults to 18,000 ms**, not 10,000 (`server/env.ts`
  `imgTimeoutMs: num('IMG_TIMEOUT_MS', 18000)`). So §3's "past
  `IMG_TIMEOUT_MS`'s 10 s default" and "`IMG_TIMEOUT_MS=20000` is the
  one-variable mitigation" have no target: the 13.0 s sheet of this run's boot 1
  landed and filled 16/16 well inside the window.
- **Therefore the sheet is not the picture most likely to be lost.** In this run
  it landed on **5 of 6** boots at 3.0/3.1/4.5/5.0/**13.0** s, and the one loss
  was the session ceiling. The wallpaper landed 5 of 6 (2.6–7.3 s), also losing
  only to the ceiling. What actually fails is the **app** picture (`photo`,
  `map`) upstream, 8 times in 6 boots.

## R5. The ICON RULING and the map, with my own eyes

`reviews/shots-stress-3/boot-1/02b-desktop-plates.png`, zoomed on both the
desktop grid and the dock: **sixteen identical amber plates with four corner
screws — no symbol, no text in the picture — and the model's own glyph centred
on each.** Semantics on that boot: 📊 taskmgr, 🗺 maps, ☁ weather, 📰 news,
📓 ledger/notes, 🎮 games, 🔄 update, ℹ about, 🖼 photos, 🗑 trash, 🏪 store,
✉ mail, 💬 messages. The ruling does exactly what it was written to do: the
picture supplies material, the model supplies meaning, and nothing is covered.
Both verification boots agree by instrument (`iconsFilled 16/16` after the
images, `launchersOffscreen 0`, wallpaper in its slot).

**One legibility defect the instrument cannot see: the glyph's colour is chosen
blind to the plate's colour.** Full-colour emoji read on any plate; a
*text* glyph (`✉`, `⌨`, `∑`) inherits the model's chosen CSS colour, and on
boot 1 that was amber-on-amber — legible but the weakest thing on the screen.
The model writes the glyph before the plate exists and cannot know its hue.
Cheap options: ask the desktop prompt for a glyph with its own contrasting
colour *and* a shadow (it already asks for the shadow), or prefer pictorial
emoji over line glyphs. A kernel-side fix would be painting, which the rules
forbid. Second, weaker observation: one `✦` for a calculator and one `🕸` for a
browser in 32 slots — the model's own semantics, mostly excellent, occasionally
oblique.

The map: `reviews/shots-map-probe/map-24s.png` is a **flat top-down printed
street plan** — street network, blocks, a river, a roundabout, monochrome blue,
no perspective, no photograph, no text of its own. Confirmed. And confirmed
again that a map shot before ~8 s is a shot of an empty surface
(`shots-stress-3/boot-2/04-maps.png` is that mistake, with the route polyline
and the "11.9 km" scale bar sitting on nothing).

## R6. `DEFAULT_ENGINE` — reproduced a third time

`PORT=8790 DEFAULT_ENGINE=cerebras-oss120` → `/api/engines` answers
`{"default":"auto","routing":true,...}`. §2 stands exactly as written; it is a
ruling for the architect, and nothing was changed. The two verification boots of
this pass were driven by `--engines=cerebras-oss120,auto` through
`/bakeoff/run`, which *is* honoured — the variable's failure is only on `/`.

## R7. The two verification boots (`reviews/shots-final-v04/verify-c/`)

| | `cerebras-oss120` | `auto` |
|---|---|---|
| identity | **snow-wisp** · "Lift Logic at Dawn" · 2040s ski lift control hut | **cogsmith** · 1950s hotel switchboard |
| archetype | taskbar | dock |
| boot paint | 1,252 ms | **728 ms** |
| desktop interactive / revealed | 2,609 / 3,844 ms | 2,278 / 3,320 ms |
| desktop contract | ok | ok |
| launchers, off screen | 16, **0** | 24, **0** |
| icon plates after images | **16/16** | **16/16** (24 launchers, 16 filled — as designed) |
| wallpaper | applied, in its slot | applied, in its slot |
| apps painted | **4/4** (ink 1.2–2.4 s) | **4/4** (1.6–2.8 s) |
| pages | **5/5** | **5/5** |
| clock | ticks | ticks |
| JS errors / CSP blocks | **0 / 0** | **0 / 0** |
| hedge | n/a | primary won, `lost or-oss120-groq` |
| $ | 0.0332 | 0.0405 |

No identity fallback (§9's `UNNAMED/0OHK` did not recur), no off-screen
launcher set (remaining issue 1 did not recur — 0 of 3 `dock` boots in R2 and
0 of 1 here), and the invented encyclopedia is using this reality's own units
on both ("384 400 fineline"; "384 400 drill").

## R8. Remaining issues — re-ranked after this pass

The list above stands with three changes:

1. **Unchanged at the top: a desktop with nothing to click** (issue 1). Not
   reproduced in this pass's 8 boots (0 of 4 docks), which makes it ~2 in 17
   dock boots rather than 2 in 9. Still a ruling, not a repair.
2. **`DEFAULT_ENGINE` cannot put `/` on one engine** (issue 2) — reproduced,
   unchanged, still the thing to decide before Railway.
3. **Issue 3 is re-written by R3/R4.** The sheet/wallpaper timeout story is
   stale (768×768 already, 18 s already). What is left in its place, in order:
   (a) **the app picture fails upstream ~26% of the time under concurrency**
   (8 of 31 in this run; 0 of 48 serial in IMG-LATENCY-2) — worth one probe that
   asks for six pictures at once before anyone raises a retry;
   (b) **the 30-image session ceiling is charged per IP**, which is right for
   production and wrong for our own sweeps — every multi-boot image statistic in
   this repo needs a server restart between boots to mean anything;
   (c) the sheet still lands *after* the desktop is interactive on every boot
   measured (`iconsFilledAtReady 0/16` on all 6 of R2, plates 0.5–15 s later) —
   the first impression is always the model's own icon art, and after the ICON
   RULING that is a legible desktop rather than a broken one.
4. **New, below issue 3: the glyph's colour is blind to the plate's colour**
   (R5). One prompt clause, no code.
5. Issues 4–7 (the ink tail, the identity fallback, the double click opening two
   windows, the dispatching e2e suite) are unchanged. This pass's ink tail was
   half of §1's, so issue 4 is weather-dependent; the identity fallback of
   issue 5 did not recur in 8 boots; the double click still opened two windows.

## R9. What the second pass did not do

No file under `kernel/`, `server/`, `prompts/`, `engines.json`, `test/`, `e2e/`
or `scripts/` was modified. The only writes are `reviews/shots-stress-3/`,
`reviews/shots-final-v04/verify-c/` and this section. Nothing committed; no
caching added; no pixel painted; port 8799 and `dist/play.js` untouched; the
verification server on 8790 was stopped at the end.
