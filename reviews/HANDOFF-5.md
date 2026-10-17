# HANDOFF-5 — v0.3 verified from a wiped tree, and the hedge trigger was never on

2026-09-17, ~19:55–21:00 PKT. Integration pass over the three parallel v0.3
builds (`reviews/SERVER-v03.md`, `KERNEL-5.md`, `PROMPTS-3.md`) as BAKEOFF-4
left them, the top of BAKEOFF-4's ranked list, and the full verification
sequence from a wiped `node_modules`.

**Two findings, both from instruments rather than from reading the code:** the
hedge trigger has never fired in this product's life (headline below), and the
blank app window is **not** the HTTP/1.1 socket exhaustion three passes have
assumed — the connection ledger built this pass shows the failing boot peaked
at 4 of 6 sockets and never opened an entry for the generation at all
(remaining issue #1).

**Tree state: green.** `npm test` **291 unit** (29 files, was 284) ·
`npm run test:e2e` **92 e2e** on mock (5.4 min, was 88) · `npm run build` clean
· `npx tsc --noEmit` clean. Nothing committed. The owner's snapshot server on
8799 was never touched; `dist/play.js` is untouched.

**Spend: $0.140** against the $1 ceiling — $0.078 of hedge-trigger probes (32
boots: 10 + 2 before the fix, 10 + 10 after), $0.062 of the two real
verification boots ($0.0143 + $0.0474). The mock harness check was $0 (images
off, which is how a mock rehearsal avoids HANDOFF-4's trap of buying real
pictures on a free engine).

---

## The headline: `HEDGE_AFTER_MS` and `HEDGE_AFTER_MS_BOOT` were dead letters

BAKEOFF-4's ranked #3 was "`HEDGE_AFTER_MS_BOOT` at 0 is what makes `auto`
expensive — measure a 600–900 ms trigger". The measurement found that **no
trigger value did anything at all**: ten real boots at
`HEDGE_AFTER_MS_BOOT=700` hedged **10 of 10**, and a control pair at
**60,000** hedged 2 of 2.

`server/hedge.ts`'s `chooseLane` treated the primary as beaten the moment it
had *content below the 64-character commit threshold*:

```
const primaryDone = primaryLane && (primaryLane.done || (primaryLane.chars > 0 && primaryLane.chars < need));
```

A real provider's first chunk is a handful of tokens, so that clause fired on
the **first chunk** of every stream, at the primary's TTFB — the trigger never
got to run. It passed its unit test because the test's fake upstream yields the
whole document in one chunk, clearing 64 characters on the first yield.

Consequences, in order of how much they matter:

1. **Every routed generation in HEDGE-1 and BAKEOFF-4 bought two lanes**, boot,
   desktop, app and page alike. BAKEOFF-4's headline verdict — "`auto` cost 55%
   more money and bought nothing measurable" — is a measurement of a broken
   trigger, not of hedging. `HEDGE_AFTER_MS=900` on `app`/`page`, which HEDGE-1
   §3 used to argue a full session is "nowhere near +29%", was equally dead.
2. **The fix is one clause** (`primaryDone = primaryLane.done`): only a primary
   that *ended* without a usable document — the reasoning-only boot of
   HANDOFF-4 #2 — is overtaken before the trigger. A primary that has content
   but has not reached the threshold needs no hedge: `leader()` commits it
   `commitMs` (1.5 s) after its first content anyway, so a lane started there
   can almost never win and is pure cost.
3. **Two unit tests now stream in 12-character chunks**, the way a provider
   does, and pin both the held trigger and the dribble-then-commit case.

`reviews/HEDGE-2.md` has the 30 real boots behind this and the raw rows.

## Hedged vs unhedged, measured (`kind=boot`, `cerebras-oss120` → `or-oss120-groq`)

| `HEDGE_AFTER_MS_BOOT` | boots | hedged | median first document | median provider TTFB | **$/boot** | loser input tokens | failovers |
|---|---|---|---|---|---|---|---|
| 0 (HEDGE-1, 18:59, before the fix) | 10 | 10/10 | 895 ms | 825 ms | $0.00280 | 54,466 | 0 |
| 700 (before the fix) | 10 | 10/10 | 1,092 ms | 1,058 ms | $0.00275 | 54,504 | 0 |
| 60,000 (control, before the fix) | 2 | 2/2 | — | 883 ms | $0.00276 | 10,876 | 0 |
| **700 (after the fix)** | 10 | **7/10** | 1,072 ms | 1,047 ms | **$0.00256** | 38,166 | 0 |
| **1,200 (after the fix)** | 10 | **0/10** | 861 ms | 798 ms | **$0.00195** | 0 | 0 |

- An unhedged boot is **$0.0019**; a hedged one is **$0.0028**. The hedge is
  **+47% on the boots it fires on** and nothing on the boots it does not — so
  the trigger is the entire cost story, and it now works.
- **The primary won 30 of 30.** `or-oss120-groq` has not beaten Cerebras once
  since HEDGE-1's boot 0 (1 of 10 there). 0 failovers, 0 missing documents, 0
  identity fallbacks, 0 truncations in all 32 boots this pass.
- The 700 and 1,200 runs straddle the provider's own mood (median TTFB 1,047 ms
  at 20:05, 798 ms at 20:09), which is exactly why 1,200 hedged nothing: **that
  is what a trigger is for.** The insurance stays armed for the 2.1–4.7 s
  afternoon the architect photographed; it just is not bought on a good one.
- **Recommendation: `HEDGE_AFTER_MS_BOOT=1200`, `HEDGE_AFTER_MS=900`.** The code
  default for the boot trigger is still 0 (SERVER-v03's seam ruling, SPEC §12.1
  "the first second is the product"); this pass did not overrule it, it made it
  a decision with a price on it. BAKEOFF-4's alternating `auto`-vs-cerebras
  protocol is worth re-running before `auto` goes on `/`: its cost column is now
  a different number.

## Blank-boot rate

HANDOFF-4's headline was one `cerebras-oss120` boot in three emitting the
identity comment and no document, and §12.3's floor then holding a black
overlay for 2.5 s. Everything measured since the v0.3 builds landed:

| run | boots | boot document missing | kernel `data-os-boot-ink` = `none` | visible black hold |
|---|---|---|---|---|
| HANDOFF-4 (v0.2) | 2 real + 3 probes | **1 in 3** | not instrumented | 2.5 s, every time |
| SERVER-v03 | 11 routed | 0 | — | 0 |
| BAKEOFF-4 (`auto` ×4, `cerebras` ×4) | 8 | 0 | **0/8** | 0 |
| HEDGE-1 / HEDGE-2 / HEDGE-3 probes | 32 | **0** | n/a (heads only) | n/a |
| this pass, two real boots | 2 | **0** | **0/2** (ink 1,501 / 1,155 ms) | **0** |

**Rate since v0.3: 0 of 53 boot generations with no document.** Two separate
changes are in that, and BAKEOFF-4's unhedged control settles the credit: the
boot budget raise (800 → 1,600, because `max_tokens` on Cerebras includes
reasoning tokens — SERVER-v03 §2) is what stopped the empty boot, and the
kernel's ink/paint distinction (KERNEL-5 / H3) is what guarantees that even if
one happens again, the visitor never waits for black: a boot frame that never
inks reveals the desktop immediately instead of holding the §12.3 floor.

---

## What changed since HANDOFF-4 (v0.2 → v0.3), in one place

The three parallel builds and BAKEOFF-4 have their own reports; this is the map.

| seam / item | what it is | where | verified by |
|---|---|---|---|
| **H1 routing** | `engine:"auto"` is a policy, not an engine: `engines.json` → `routes.default` gives each kind a primary and a hedge. An explicit id bypasses routing *and* hedging, so a single engine stays judgeable | `server/routes.ts` | 15 unit + 4 e2e (`routing.spec.ts`) |
| **H2 hedging** | two lanes race, the first 64 content characters are held in-process, the loser is aborted at the commit point and bills input only | `server/hedge.ts` | 12 unit; HEDGE-1/2 on real providers |
| **H2 trigger** | **fixed this pass** — the trigger never fired (headline above) | `server/hedge.ts` | 2 new unit tests + 30 real boots |
| **H3 ink vs paint** | the runtime reports `ink` (first element with a box) separately from `paint` (first chunk written); a boot frame that never inks reveals the desktop immediately instead of holding §12.3's 2.5 s floor | `kernel/injected/runtime.ts`, `kernel/index.ts` | `ink.spec.ts`; 8/8 boots in BAKEOFF-4 |
| **H4 focus** | `data-os-focused` on every window root, `data-os-active` on its task entry, and a prompt section requiring a visible difference | `kernel/windows.ts`, `prompts/system/desktop.md` | `focus.spec.ts`; weak *styling* is BAKEOFF-4's open #4 |
| **H5 reality offset** | the server rolls a per-session calendar, unit system and place pair and passes them as hard constraints, in the shape §12.4 already uses for identity — so the encyclopedia stops reciting the real Moon's measurements | `server/dice.ts`, `prompts/user/reality.md` | BAKEOFF-4: invented figures on every boot |
| **boot budget 800 → 1,600** | `max_tokens` on Cerebras includes reasoning tokens, so an 800 budget truncated any boot that thought | `server/index.ts` | SERVER-v03 §2; 0 blank boots in 53 |
| **the fit guard** | three steps of geometry, all the kernel's (§2.2): clamp `html/body`, pin a clipped `[data-os-taskbar]`, and **grow a bar whose contents hang off the screen** | `kernel/inject.ts` | 5 e2e (`fit.spec.ts`) — **2 added this pass** |
| **generation lane** | admission control mirroring the image lane, shipped **inert** (`GEN_CONCURRENCY = Infinity`) because at 3 it starved every app generation of a real boot | `kernel/gen.ts` | 3 unit (`genlane.test.ts`) |
| **connection ledger** | **new this pass** — every request the kernel opens is counted, by lane, with a high-water mark, and reported when an app window opens and whenever a document stalls or finishes blank | `kernel/net.ts` | 5 unit + 2 e2e; `window.__osNet()` |
| harness | alternating engine plans, ink read from two independent instruments, bar-contents measurement, picture polling instead of a flat 4 s wait, `net.peak` in the boot record | `scripts/run.mjs`, `bakeoff.mjs`, `integrate.mjs` | — |
| docs | `.env.example` and `DEPLOY.md` now carry `HEDGE_AFTER_MS`, `HEDGE_AFTER_MS_BOOT`, `ROUTING`, `ROUTES_JSON`, and the fact that `OPENROUTER_API_KEY` **is** the hedge | `.env.example`, `DEPLOY.md` | this pass |

### The three things this pass closed from BAKEOFF-4's ranked list

1. **#1 Count the connections.** `kernel/net.ts` is the ledger: `netOpen(lane,
   label)` returns its own closer, called in a `finally` when the body has been
   fully read (which is when the socket is actually free — resolving the promise
   is not). The kernel prints it when an app window opens, when a generation
   stalls past 12 s, and when one finishes having shown nothing, so the
   blank-window bug now carries the number that causes it. `window.__osNet()`
   exposes `{n, peak, byLane, open[]}`; `scripts/run.mjs` records it per boot.
   **Measured on mock: peak 4 across a boot with a browser window** — already
   above HANDOFF-4's "never more than three live generations", with no images in
   play. The real-boot figure is in the table below.
2. **#2 `fitBarContents` had no test.** `e2e/fakes.ts` gained
   `barContentsOverflowDesktop` — a bar whose own box fits the viewport
   perfectly (so steps 1 and 2 must *not* fire) with 70 px task entries centred
   on a 34 px bar, which is exactly the shape of BAKEOFF-4's `auto` boot 1
   failure. Two tests: the bar is grown, `data-os-fit-bar` records the height it
   needed, and every entry with its icon and label ends up on screen; and the
   growth is undone at unmount so the next machine's bar starts clean.
3. **#3 the hedge trigger** — the headline.

---

## The verification sequence, step by step

From a wiped tree: `rm -rf node_modules dist/server.js public/kernel.js`
(`dist/play.js` left alone), `npm ci` (125 packages), `npm run build`,
`npx tsc --noEmit`, then `PORT=8790 DEFAULT_ENGINE=auto node dist/server.js`.

| check | result |
|---|---|
| `listening` line | 9 keyed engines, `moderation: auto`, caps `60/h · 10,000/day · $25`, `kernel public/kernel.js 116,308 b` |
| `GET /healthz` | `200 ok` |
| `GET /api/engines` | `default: auto`, `routing: true`, `auto` first in the list, per-kind `routes` published (primary `cerebras-oss120`, hedge `or-oss120-groq` on all four kinds) |
| `GET /` | 200, 948 b (the kernel page is meant to be empty) |
| `GET /bakeoff` | 200, 6,740 b, a **Boot** button per keyed engine, `auto` offered |
| `GET /bakeoff/run?engine=cerebras-oss120` | 200, 950 b — an explicit id, which bypasses routing and hedging |
| `GET /api/stats` · `/robots.txt` | 200; `Disallow: /api/`, `Allow: /` |
| `npm test` | **291 passed**, 29 files, 8.6 s |
| `npm run test:e2e` | **92 passed** on mock, 5.4 min |

`DEFAULT_ENGINE=auto` is what the brief asked to verify, and it works end to
end — but see the recommendation above: BAKEOFF-4's evidence for `/` is still
`cerebras-oss120`, and `auto`'s cost column needs re-measuring now that the
trigger is live.

---

## The two real boots (`engine=auto`, `HEDGE_AFTER_MS_BOOT=1200`)

`node scripts/integrate.mjs --engines=auto --shots=final-v03/{a,b}`, viewport
1440×900, 20:10 and 20:17 PKT. Raw: `reviews/shots-final-v03/{a,b}/integrate.json`;
shots `reviews/shots-final-v03/{a,b}/auto/`.

- **A — VORTEX 1.4.2-rc2 [Obsidian]**, "Ledger of the Departed", 2020s funeral
  parlour, `dock`. $0.0143.
- **B — XJ-12 3.7.1-rc2 (cobalt)**, 2090s prison workshop, `taskbar`. $0.0474.

| step | §12.1 target | boot A | boot B | verdict |
|---|---|---|---|---|
| boot screen ink | < 1.0 s | 1,501 ms | 1,155 ms | MISS, provider-bound (TTFB 1,452 / 1,038 ms) |
| desktop interactive | < 4.0 s | 3,659 ms | 4,190 ms | **PASS / marginal** |
| desktop revealed | ≥ 2.5 s floor | 4,340 ms | 4,333 ms | — |
| app window content | < 2.5 s | **4 × blank** | 2,834 / 2,019 / 2,019 / 2,830 ms | A: total failure · B: 2 of 4 inside target, all 4 painted |
| page | < 2.5 s | — (no browser) | 405 / 2,035 / 2,141 / 2,141 / 2,141 ms | PASS ×5 |
| contract | ok | ok | ok | — |
| JS errors · CSP refusals | 0 | 0 · 0 | 0 · 0 | — |

Desktop structure, after images:

| reading | boot A (`dock`) | boot B (`taskbar`) |
|---|---|---|
| launchers / labelled | 16 / 16 | 16 / 16 |
| layout · off screen · overlapping | 11×3 grid · 0 · 0 | 8×2 grid · 0 · 0 |
| icon cells filled | 16/16, 0 surplus slots | 16/16, 0 surplus |
| wallpaper | landed | landed |
| clock | ticking, seconds, inside the bar | ticking, seconds |
| bar contents outside the viewport | 0 of 2 | 0 of 10 |
| task entries legible | 0/0 (no window ever painted) | **4/4** |
| kernel injections · fit repairs | 0 · none | 0 · none |
| app pictures | 0 slots asked | **3 slots asked, 3 landed** (`photos`) |
| windows photographed focused | 0/4 (nothing to focus) | **4/4** |

**Boot B is the best session this product has produced**: a boot screen at
1.2 s, a desktop at 4.2 s, four apps and five pages all painted, `photos`
asking for three pictures and getting three, every window focused when
photographed, wallpaper and sixteen sheet-cut icons, no error of any kind, for
4.7 cents. `09-desktop-images.png` in `b/auto/` is the frame to look at.

**Boot A is the blank-window bug at its worst: 4 app opens, 4 blank windows.**
And the ledger built this pass says something that changes the diagnosis.

---

## Remaining issues, ranked

1. **The blank app window — and the socket hypothesis is now falsified.**
   Boot A lost **4 of 4** app opens (each blank for the full 90 s step
   ceiling, 0 characters), with **no server telemetry line for any of them**,
   which is BAKEOFF-3 open issue 1 in its worst observed form. What is new is
   the ledger: **`net.peak` was 4** for the whole session (boot gen + desktop
   gen + the two boot pictures), **0 gen sockets open at the end**, and *no
   ledger entry was ever opened for an app generation*. `netOpen` is called
   **before** `fetch`, so a request sitting in Chrome's per-origin queue would
   still have an entry — therefore this was never a socket-exhaustion fault at
   all: **the kernel never got as far as `genStream`.** Three passes of
   diagnosis, HANDOFF-4's image-lane fix and BAKEOFF-4's generation lane were
   all aimed at the wrong mechanism.
   Where it stops is between `wm.create` (the window exists, blank, and was
   photographed) and `genStream` (no entry): the candidates are the
   `spec.claim` / `streamApp` path awaiting something that never settles, or an
   exception thrown inside `wm.focus`'s `onFocus` callback (`pushState`,
   `fitBarContents`) which would abandon `openApp` before `streamApp` is ever
   called — an uncaught listener exception in a delegated click handler is
   silent, and boot A reported 0 JS errors.
   **The next step is one line of instrumentation, not a fix:** make `netOpen`
   and its closer each emit a telemetry line (they only report snapshots
   today), and log entry/exit around `openApp`'s four steps. Then the next
   occurrence says which step swallowed it. Boot B, the mock harness and the
   whole e2e suite run this code path clean, so it is intermittent and it is
   not the ledger's own doing — the mock check was run this pass precisely to
   prove the instrumentation did not cause it
   (`reviews/shots-final-v03/mockcheck/`: 4 apps painted, 5 pages painted, peak
   4, $0).
2. **`auto`'s cost, re-measured with a live trigger.** BAKEOFF-4's verdict
   ("leave `/` on `cerebras-oss120`") was reached against a hedge that fired on
   every generation. Re-run the alternating protocol with
   `HEDGE_AFTER_MS_BOOT=1200` before the verdict is treated as final; the boot
   column is $0.0019 vs $0.0028 now, not +55%.
3. **`or-oss120-groq` has never won a document worth judging.** 30 of 30 boots
   went to the primary; the only Groq win in the product's history (HEDGE-1 boot
   0) was never looked at by a human. The hedge is insurance whose payout has
   not been inspected: one `/bakeoff/run?engine=or-oss120-groq` boot, eyes on
   the desktop, would settle whether the insurance is worth having.
4. **Focus state is legible to the DOM and barely legible to a person**
   (BAKEOFF-4 #4). `data-os-focused` is on every window root and the prompt asks
   for a difference; on the taskbar desktops that difference is about one step of
   grey. The prompt sentence to write requires a *named* difference — the title
   bar's own background, not its text colour.
5. **App pictures are still unjudged** (BAKEOFF-4 #5): the four apps SPEC §7
   opens (`browser`, `calculator`, `notes`, `store`) declared **zero** picture
   slots in 32 opens, so every `pics 0/0` reading means "nobody asked", not
   "nothing arrived". `photos` has to be in the protocol's `--apps` default, and
   the picture-poll instrument now exists to measure it.
6. **fal's latency, unexplained.** IMG-LATENCY-1 measured a wallpaper at 2.9 s;
   BAKEOFF-4 measured 8.9 s median and 13.7 s worst on the same config, with 2
   of 22 never arriving. One A/B before anyone concludes the slow reveal is ours.
7. **`mercury-2.5` unjudged, five passes running** — 403 from this network. Ten
   minutes with the key or the network would settle which is the blocker.
8. **The store's last card** (BAKEOFF-3 #7), still n=1 after the prompt change.
9. **`GEN_CONCURRENCY` and `setGenWaitReporter` are dead code until #1 is
   decided.** They are tested and inert; if #1 turns out to be an HTTP/1.1-only
   artefact, delete them rather than leave a switch nobody may touch.

---

## Deploy-readiness — **yes for the shell, with one honest caveat about apps**

Verified this pass from a wiped tree: `npm ci && npm run build && node
dist/server.js` with every route answering (table above), 291 unit and 92 e2e
green, generated documents in opaque-origin sandboxes with zero network, the
money stop tested, and — the caveat HANDOFF-4 added — **no boot generation
without a document in 53, and no visitor waiting on black even if one happens**
(the ink seam reveals the desktop immediately when the boot frame never inks).

HANDOFF-4's caveat (2.5 s of black on a boot with no document) is retired. It
is replaced by a smaller, sharper one: **one of the two verification boots lost
every app window** (#1). The boot screen, the desktop, the wallpaper, the icon
sheet, the clock and the pages are reliable across everything measured since
v0.3; *opening an app* is reliable in 30 of 34 attempts and fails in bursts —
and when it fails, the visitor gets a window that never fills, with nothing on
screen to say why. That is survivable for a launch (the desktop is the
screenshot, and a reload is a whole new machine) but it is the next thing to
fix, and the instrument to fix it with is now in the tree.

What is *not* proven on a deploy: the hedge has only ever been exercised from
this machine, and #1 has only ever been seen over HTTP/1.1 — worth one look at
the real thing rather than another local run, since production's HTTP/2 edge
changes the connection picture even though the ledger now says sockets were
never the mechanism.

### The exact Railway variable list

Required — the service is wrong without them:

| variable | value | why |
|---|---|---|
| `DEFAULT_ENGINE` | `cerebras-oss120` | BAKEOFF-4's evidence. `auto` is the lever, not the default, until its cost is re-measured (#2) |
| `CEREBRAS_API_KEY` | the key | the primary of every route and the default engine |
| **`OPENROUTER_API_KEY`** | the key | **this is the hedge.** It holds `or-oss120-groq`, the hedge engine of all four routes; without it `auto` silently demotes to its primary alone — no error, no hedge, `/api/engines` still advertising `auto`. It is also the only path to Groq on this account (`GROQ_API_KEY` is empty by design) |
| **`HEDGE_AFTER_MS`** | `900` | how long a routed `app`/`page` waits for a content token from the primary before the second lane starts. Now that the trigger works, this is a real number |
| **`HEDGE_AFTER_MS_BOOT`** | `1200` | the same for `boot`/`desktop`. The code default is `0` (both lanes at once), which costs $0.0028 a boot instead of $0.0019 — **set it explicitly** (HEDGE-2) |
| `OPENAI_API_KEY` | the key | moderation (`omni-moderation-latest`, free). Without it moderation falls back to the local list — SPEC §8 wants the real thing |
| `FAL_KEY` | the key | SPEC §12.5's pictures. Without it every boot is SVG-only; it still boots |
| `TRUST_PROXY` | `1` | Railway's edge terminates the connection. **Nowhere else** — a directly reachable process lets a client rotate `X-Forwarded-For` and mint rate-limit buckets |
| `TRUSTED_PROXY_HOPS` | `0` | correct for Railway's single edge |
| `MAX_USD_PER_DAY` | `25` | SPEC §1.8. The only cap that is actually a budget |
| `CAPS_STATE_FILE` | `/data/caps-state.json` | on the mounted volume, or every redeploy hands the world a fresh daily budget |
| `NAMES_RING_FILE` | `/data/names-ring.json` | §12.4's never-use-these ring; memory-only means the first visitor after a deploy can be handed the last one's name |
| `IP_SALT` | a long random string | rate-limit hashes stop being comparable across deploys |
| `MOD_SALT` | a long random string | falls back to `IP_SALT` |

Optional, with sane defaults: `PORT` (Railway sets it), `GEN_PER_IP_PER_HOUR`
(60), `MAX_GEN_PER_DAY` (10000), `MAX_CONCURRENT_GEN` (12),
`MAX_CONCURRENT_IMG` (6), `GEN_TIMEOUT_MS` (25000), `IMG_TIMEOUT_MS` (10000),
`MARK_PER_IP_PER_HOUR` (600), `NAME_PER_IP_PER_HOUR` (60), `MODERATION`
(`auto`), `ROUTING` (on — `off` is the one-variable kill switch for routing and
hedging together), `ANTHROPIC_API_KEY` / `INCEPTION_API_KEY` /
`GOOGLE_API_KEY` (extra engines in the picker only).

Leave empty in production: `ROUTES_JSON`, `MODERATION_ENDPOINT`, `FAL_ENDPOINT`.
Plus a volume mounted at `/data`, and root directory `products/hallucinos`.

---

## Rules this pass worked under, and what it did not touch

No pixel of ours except queue/error text and the `/bakeoff` surfaces (the
connection ledger writes to the HUD's telemetry stream and to a global; it
paints nothing). No caching. No new design instruction beyond §12.3's archetype
structure — the only prompt-adjacent change this pass is none: `prompts/**` was
read, never written. `dist/play.js` untouched, port 8799 never used, no process
with `play.js` in its command line ever signalled. Nothing committed.

## Files this pass changed

| file | change |
|---|---|
| `server/hedge.ts` | the trigger fix (one clause + the comment explaining why the old one could not work) |
| `test/hedge.test.ts` | +2 tests: a 12-character-chunk primary does not start the hedge before the trigger; a dribbling primary is committed on `commitMs`, not hedged |
| `kernel/net.ts` | **new** — the connection ledger |
| `kernel/gen.ts` · `kernel/img.ts` | every request opens and closes a ledger entry (in a `finally`, after the body is read) |
| `kernel/index.ts` | the ledger is reported on app open, on a 12 s stall and on a blank finish; `window.__osNet()` |
| `test/net.test.ts` | **new** — 5 unit tests for the ledger |
| `e2e/net.spec.ts` | **new** — 2 e2e: the peak across a boot and an app open, and the shape of what it holds |
| `e2e/fakes.ts` | **new fixture** `barContentsOverflowDesktop` (`bar-contents-overflow`) |
| `e2e/fit.spec.ts` | +2 tests for `fitBarContents` — the one thing in the tree with no test |
| `scripts/run.mjs` · `scripts/integrate.mjs` | `net` in the boot record, `net.peak` in the per-boot line |
| `.env.example` · `DEPLOY.md` | `HEDGE_AFTER_MS`, `HEDGE_AFTER_MS_BOOT`, `ROUTING`, `ROUTES_JSON`, and `OPENROUTER_API_KEY` as the hedge |
| `reviews/HEDGE-2.md` + `hedge-2-boots.json`, `hedge-3-boots.json` | the 30-boot trigger measurement |
| `reviews/HANDOFF-5.md` | this file |

## Traps this pass walked into, for the next one

- **A unit test whose fake upstream sends the whole document in one chunk can
  pass while the feature is inert.** That is how a dead hedge trigger survived
  two passes and a real-provider probe (HEDGE-1 read `hedged: 10/10` as the
  mechanism working, which it was — just not the trigger). Any test of a
  streaming decision has to stream the way a provider does: many small chunks.
- **`--n=2` at an absurd parameter value is the cheapest bug detector in this
  repo.** `HEDGE_AFTER_MS_BOOT=60000` cost $0.005 and proved in one minute what
  three passes of reading the code had not.
- **`ps` etime is not wall clock for a shell-wrapped background job**, and a
  half-written shots directory looks identical to a stalled run. Read the
  run's own log line, not the directory.
