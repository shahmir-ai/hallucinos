# SERVER-v03 — routing, hedging, ink, the reality offset, and the boot budget

2026-09-17, 18:45–21:15 PKT. Server side of the v0.3 seams (H1, H2, H3 server
half, H5 server half) plus the two measurements the seams asked for. Owner of
this pass: `server/**`, `engines.json`, `test/**`, `scripts/**`. Nothing
committed. `kernel/**`, `prompts/**` and `data/dice.json` were read, never
written.

**Tree state: green.** `npm test` **281 unit** (27 files, was 252/25) ·
`npm run build` clean. e2e: see "What is not verified" below.

**Spend: $0.094.** $0.011 the boot-budget probe (6 calls), $0.028 the ten
routed boots of HEDGE-1, $0.054 one real routed browser boot with images
(`reviews/shots-server-v03/`), plus ~$0.001 of smoke calls.

---

## The headline

**On the bad hour, `engine=auto` boots in 1.2 s and the desktop is interactive
in 2.9 s, with pictures in the windows and nothing blank.** One real routed boot
through the browser harness, 19:07 PKT, on the same afternoon the architect
measured 2,065 ms of boot TTFB and 4,736 ms of desktop TTFB at 253 tok/s:

| | §12.1 target | HANDOFF-4 boot A | HANDOFF-4 boot B | this pass (`auto`) |
|---|---|---|---|---|
| boot screen paint | < 1.0 s | **none** | **none** | **1,190 ms** |
| desktop interactive | < 4.0 s | 5,366 ms | 9,641 ms | **2,944 ms** |
| desktop revealed | — | 6,834 ms | 9,860 ms | 3,828 ms |
| app window content | < 2.5 s | 1.5–1.9 s | 1.4–4.0 s | 1,619 / 2,427 / 2,429 ms |
| page | < 2.5 s | 1.3–7.4 s | 1.0–3.4 s | 407 / 2,030 / 2,140 / 2,546 / 1,742 ms |
| contract | ok | ok | ok | ok · 0 JS errors · 0 CSP refusals |

Three separate changes are in that column and only one of them is a guess:
hedging (measured, HEDGE-1), the boot budget raise (measured, below), and the
kernel's own ink work from the other side of the H3 seam. I am not claiming the
hedge caused the 1,190 ms — Cerebras was having a good minute for most of this
run — I am claiming that **no boot in this pass produced a document-free boot
screen, in 11 routed boots**, where HANDOFF-4 saw one in three.

---

## 1. H1 — the routing table (`engines.json` → `routes`)

```
"routes": { "default": {
  "boot":    { "primary": "cerebras-oss120", "hedge": "or-oss120-groq" },
  "desktop": { … same }, "app": { … same }, "page": { … same } } }
```

- `POST /api/gen` with `engine:"auto"` resolves through `routes.default[kind]`
  (`server/routes.ts`). An **explicit engine id bypasses routing and hedging
  entirely** — `/bakeoff/run?engine=…` and the bake-off harness therefore still
  judge one engine, which is the point of the bake-off.
- `GET /api/engines` puts `auto` first, as a policy rather than a model
  (`model: "routed"`, no price of its own, `notes` naming each kind's pair), and
  advertises it as the `default`, so the kernel's existing `chooseEngine` picks
  it with no kernel change.
- Two deliberate exceptions keep the fixture paths honest: a run whose
  `DEFAULT_ENGINE` is a **mock** engine stays on the mock (`npm run dev`, the
  whole e2e suite, which asserts `/api/engines` lists exactly `mock`), and
  `ROUTING=off` turns the process back into v0.2.
- `/bakeoff` lists **auto first, with its own Boot button** and the `default`
  tag, so the routed pair can be compared against each single engine by hand —
  the comparison that decides whether the hedge is worth its 29%. Verified with
  real keys: the landing page renders `/bakeoff/run?engine=auto` above the seven
  keyed engines.
- `ROUTES_JSON` overrides the file for one process — the ops lever for changing
  a hedge without a redeploy, and the way `test/routing.test.ts` points a route
  at two fake upstreams.
- A route whose primary has no key is **demoted to its hedge** rather than
  failing; a route with neither falls back to `defaultEngine()`.

**DEPLOY.md is now slightly wrong and I do not own it.** It says to set
`DEFAULT_ENGINE=cerebras-oss120`, which is still fine — but with routes present
the honest production setting is `DEFAULT_ENGINE` unset (or `auto`), so `/`
boots routed. With it set to a real engine id, `/api/engines` still advertises
`auto` (only a *mock* default overrides), so production hedges either way; the
variable now only names the fallback for unrouted kinds. One line for whoever
owns that file.

## 2. The boot budget: `max_tokens` DOES include reasoning tokens

`scripts/boot-budget.mjs`, six calls on the real engine with the real boot
prompt, $0.011. This was ambiguous in the record — `engines.json` said a
20-token call spends everything on reasoning, HANDOFF-4 saw a probe spend 1,681
tokens under a budget of 800 — and the two cannot both be true.

| max_tokens | finish_reason | completion_tokens | reasoning_tokens | visible chars | document |
|---|---|---|---|---|---|
| 800 | **length** | **800** | 659 | 507 | half written |
| 800 | **length** | **800** | 359 | 1,384 | complete-ish |
| 800 | stop | 759 | 357 | 1,309 | yes |
| 1,600 | stop | 1,005 | 629 | 1,206 | yes |
| 1,600 | stop | 739 | 301 | 1,385 | yes |
| 1,600 | stop | 956 | 539 | 1,382 | yes |

**Reasoning is inside the budget.** At 800 the cap bound at exactly 800
completion tokens on 2 of 3 calls, and with 659 reasoning tokens the boot screen
arrived at 507 visible characters — a half-written document, which is precisely
the blank-to-barely-there boot HANDOFF-4 led with. At 1,600 the model stopped on
its own every time (739–1,005), so **the raise buys the starvation case and
costs nothing on a normal boot**: it is never reached. HANDOFF-4's 1,681-token
probe was therefore not under an 800 budget — most likely the rescue identity
call's tokens folded into the same line.

Done: `engines.json` `defaults.max_tokens.boot` 800 → **1,600**, with the
measurement in `_notes`; `test/engines.test.ts` updated. SPEC §12.1's brevity
now rests on the prompt, which is where it was argued in the first place. In the
11 routed boots since, output ran 799–1,472 tokens with **0 truncated**.

## 3. H2 — hedged generation (`server/hedge.ts`)

Two lanes, one stream out, decided by the first CONTENT token (reasoning tokens
are never yielded by the client, so they cannot win a race).
`HEDGE_AFTER_MS_BOOT=0` — boot and desktop start both lanes at once, because
SPEC §12.1 says the first second is the product — and `HEDGE_AFTER_MS=900` for
`app` and `page`, which pay for a hedge only when the primary is actually slow.

**The one place I did not implement the seam literally.** The seam asks for the
loser to be aborted on the winner's first content token *and* for a failover if
the winner dies before 64 content characters. Both cannot be literal: an aborted
lane cannot be fallen back to, and a client already holding 20 characters of a
dead document cannot be handed a second one without breaking §12.2. So the
first **64 content characters are held in this process** and nothing reaches the
client until one lane has them. At that commit point the buffer is flushed and
the other lane is aborted; before it, a lane that dies or ends without a
document costs nothing and the other is promoted invisibly. Measured cost of the
hold: **nil** — `loser_aborted_ms` equals the winner's provider TTFB to within
15 ms on 9 of 10 real boots, because 64 characters arrive in the same chunk. A
lane that inks and then stalls under the threshold is committed anyway after
`HEDGE_COMMIT_MS` (1,500), so a stall cannot hold the page. With no hedge engine
`commitChars` is 0 and the path is byte-identical to v0.2.

Telemetry per generation gains `hedged`, `winner`, `loser`, `loser_aborted_ms`,
`loser_tokens_in`, `loser_tokens_out`, `failed_over`; `engine` is the **winner**,
so per-engine aggregates stay meaningful; `usd` includes the loser's billed
tokens; the USD ceiling **reserves for both lanes** before either is bought; and
`provider_ttfb_ms` is the winner's own TTFB, not the race's, so a hedge that
started 900 ms late is not scored as a 900 ms slower engine.

Real verification: **reviews/HEDGE-1.md** — ten routed boots, 10/10 hedged, 9
Cerebras wins, 1 Groq win at 1,901 ms while Cerebras had written nothing at
1.6 s, 0 failovers, 0 missing documents, median first document 895 ms, $0.0028
a boot (+29% for the hedge, all of it the loser's input).

## 4. H3 server half — ink, not paint

`POST /api/mark` accepts `ink_ms` and it is a first-class telemetry field with
the reason written next to it: `first_paint_ms` means "the first chunk was
written", which the identity comment alone satisfies, and that is exactly how a
blank boot frame reported 4,176 ms of first paint. A line with `first_paint_ms`
and no `ink_ms` is now readable as what it is — a document that streamed and
never showed anything. The kernel owns reporting it and the 2.5 s floor; this
side accepts, validates, holds early marks and writes it.

## 5. H5 server half — the reality offset

The prompt author had already written the lists and the intended object shape
into `data/dice.json` (`reality_offset._shape`) and the `{{reality_json}}` slot
into `prompts/user/{page,app}.md` before I got there, so the server conforms to
**their** shape rather than mine: one `calendar_quirk`, one `unit_system` with
its three unit names (distance, mass, duration), two names from one
`place_pair`, one `historical_event`, and a scale factor rolled **numerically**
in `scale_factor`'s band (0.37–2.90, 2 decimals, never exactly 1).

- Rolled from `rngFrom(seed + ':reality')` — one world per session, replayable
  from the seed, no storage, and every page and app of a session agrees.
- Rendered into `kind=page` and `kind=app` only: a boot screen and a desktop
  have no measurements to be wrong about and the input tokens are not free.
- A malformed or absent `reality_offset` falls back to dull built-ins, and a
  unit system without exactly three units or a place pair without two names is
  dropped rather than rendered half-formed.
- `test/dice.test.ts` now asserts the real file against `_shape`'s own minimums
  (40/40/60/60) and that nothing in it is dropped by the coercion, so a list
  that shrinks fails in a test rather than in a page's measurements.
- Also offered: `prompts/user/reality.md` is appended to the page and app user
  turns when it exists, for the author who wants the constraint next to the URL
  the way `notes/reference.md` is. Absent today; harmless.

**Not verified: whether the Moon's diameter is finally wrong.** That is a
prompt-side reading of a real page and it belongs in the next bake-off. The
server's job — roll it, keep it stable per session, put it in front of the
model — is done and tested.

## 6. The harness (`scripts/run.mjs`, `bakeoff.mjs`, `integrate.mjs`)

- **`focusWindowFor(page, frameEl)`** — HANDOFF-4 #8. `pointerdown` is
  *dispatched* on the window root (the kernel raises on capture-phase
  `pointerdown`), so an overlapping window cannot swallow it and no drag
  follows. It returns what the kernel then says: `data-os-focused`,
  `data-os-active` on the task entry, and whether the window is actually top.
- **`photographApp(...)`** — HANDOFF-4 #3. Focus, photograph, wait 4 s,
  photograph again as `<name>-late.png`, and report `imgSlots`, `imgFilled` (at
  settle) and `imgFilledLate`. Wired into both `integrate.mjs` and
  `bakeoff.mjs`; app rows and the per-boot stdout line now carry the counts.
- The verification boot's answer, which nothing could see before:
  **photos declared 4 slots, 0 filled when its document settled at 2,427 ms, 2
  filled 4 s later.** So app pictures do arrive, half of them are still lost
  (BAKEOFF-3 issue 5 is not closed), and no single screenshot at settle time
  could ever have shown it. Focus: **3 of 3 apps focused and task-active**, and
  every page shot was of the browser window (`w1`, focused, top) rather than of
  whatever sat on top.
- `integrate.json` rows now carry `engine`, `hedged`, `winner`, `loser`,
  `loser_aborted_ms`, `failed_over` and `ink_ms`, so the next pass can read the
  race off the report instead of the log stream.
- **`scripts/hedge-probe.mjs`** — N routed generations of one kind, heads only,
  with the server's own telemetry lines joined back to each request. It refuses
  port 8799 and never touches `dist/play.js`.
- **`scripts/boot-budget.mjs`** — the reasoning-tokens-in-`max_tokens` probe.

## 7. Tests

`test/hedge.test.ts` (10) drives `Hedger` against two fake upstreams: slow-TTFB
primary, primary that emits only reasoning tokens then ends, primary that dies
after 20 characters, both dead, one-lane pass-through, a lane that inks and
stalls, the winner's own TTFB, and a client that goes away stopping both lanes.

`test/routing.test.ts` (15) drives the same cases **through `POST /api/gen`**
with `ROUTES_JSON` pointing at `mock` and a second fixture lane `mock-b`, whose
per-lane behaviour comes from the seed (`fake:<laneA>:<laneB>`, see FAKE SEEDS
in `server/mock.ts`). It also pins: `auto` first in `/api/engines`, an explicit
id bypassing the hedge (the dead lane is *not* rescued), one document per
response, the sentinel naming the winner, both dead → `os-error` and no
telemetry sentinel, a hedged boot still carrying its identity comment, and
`ink_ms` on `/api/mark`.

`mock-b` is gated behind `ALLOW_TEST_ENGINES=1` — deliberately **not**
`NODE_ENV`, because the e2e suite runs the real built server with `NODE_ENV=test`
and asserts `/api/engines` lists exactly `mock`. A fixture must not appear in
the product's own contract test.

## What is not verified

1. **e2e was not run cleanly, three attempts.** The suite binds fixed ports
   8770–8778 and another session in this tree held 8770 throughout, so every run
   aborted at webServer startup (`50 passed / 1 failed` in the first log is not
   a result — it is a run with a missing server). **Run `npm run test:e2e` alone
   in the tree before trusting the count.** What I could check directly, I did:
   the two e2e assertions this pass could plausibly break are `/api/engines`
   listing exactly `mock` and `default === 'mock'`, so the built server was
   started with the suite's own keyless env and answered
   `default: mock · routing: false · ids: mock`. Nothing in this pass touched
   the kernel, and the 281 unit tests cover every new path.
2. **A hedge on `app` and `page` against the real providers.** `HEDGE_AFTER_MS`
   is 900 and no real primary was slower than that during the verification boot,
   so the 900 ms branch has only fixture coverage. `node scripts/hedge-probe.mjs
   --kind=page --n=10` measures it for about three cents.
3. **`or-oss120-groq` has never been judged by a human.** It won one boot in
   HEDGE-1 and nobody looked at it. Same weights as the primary, so the
   documents are the same shape, but "the hedge writes an OS as good as the
   primary's" is an assertion, not a measurement. `/bakeoff/run?engine=or-oss120-groq`
   now bypasses routing and hedging, which is exactly how to settle it.
4. **`kernel/index.ts` does not type-check** (`fitViewport` is not exported from
   `kernel/inject.ts`) — a parallel session's work in progress, not mine, and
   esbuild bundles through it. Flagged, not touched.

## Ranked, for the next server pass

1. **Measure the hedge where it is cheap and untested**: `--kind=page --n=10`,
   and the same for `app`. If the 900 ms branch never fires on a good afternoon,
   consider lowering it — a page is 2,500 tokens and the hedge's marginal cost
   is one input pass.
2. **Two app pictures of four still never land** (BAKEOFF-3 issue 5). The
   instrument now exists: `imgFilled` vs `imgFilledLate` per app, per boot. Run
   three boots and read the lane telemetry against the kernel's cancel reasons.
3. **The app budget is binding.** One of three app windows in the verification
   boot hit `finish_reason=length` at exactly 2,500 tokens (photos). The
   reasoning-inside-`max_tokens` finding applies to every kind, not just boot;
   `app` and `page` deserve the same six-call probe before the next bake-off.
4. **A boot generation that emits no document deserves a decision, not a
   retry.** With the budget raise and the hedge it did not happen once in 11
   boots; if it returns, the honest fix is the kernel's ink branch (already
   built) rather than paying for a second boot at 2 s of provider TTFB.
5. **Reality-offset efficacy** — read three real reference pages and count the
   true figures. Prompt-side, but the server rolls it, so the two should be read
   together.
