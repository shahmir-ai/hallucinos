# BAKEOFF-4 — `auto` against `cerebras-oss120`, alternating, one hour

2026-09-17, 19:16–19:50 PKT. One product again after the three parallel v0.3
passes (SERVER-v03, KERNEL-5, PROMPTS-3), then the measurement the seams asked
for: **4 boots `engine=auto` (hedged) and 4 boots `engine=cerebras-oss120`
(unhedged), interleaved A1 B1 A2 B2 …** so a provider's ten-minute mood is split
evenly between the columns instead of falling on whichever engine went second.
Full SPEC §7 protocol per boot: identity → boot screen → desktop, four apps
(`browser`, `calculator`, `notes`, `store`) and six URL visits inside the
browser.

**Spend: $0.345.** $0.331 the eight judged boots, $0.014 the one verification
boot that measured the generation lane into the ground. The mock rehearsal, the
plan check and the lane check on mock were $0. Ceiling was $5.

**Tree state: green.** `npm test` **284 unit** (28 files, was 281) ·
`npm run test:e2e` **88 e2e** on mock (was 72 at HANDOFF-4) · `npm run build`
clean · `npx tsc --noEmit` clean. Nothing committed. The owner's snapshot server
on 8799 was never touched and still answers 200; `dist/play.js` is untouched.

Raw run report (every per-generation number, read from the server's own stdout):
`reviews/BAKEOFF-4-run.md`, telemetry `reviews/shots-bakeoff/4-run/telemetry.jsonl`,
shots `reviews/shots-bakeoff/4-run/<engine>/<boot>/`.

---

## VERDICT: `auto` should NOT be the default on `/` yet

**The hedge cost 55% more money and bought nothing measurable on this hour, and
the thing it was built to fix was already fixed by something else.**

| | `auto` (hedged) | `cerebras-oss120` (unhedged) |
|---|---|---|
| boots | 4 | 4 |
| **blank boots** | **0/4** | **0/4** |
| ink, median / worst (harness) | 1,922 / 2,222 ms | **1,730 / 1,863 ms** |
| desktop interactive, median | 4,049 ms | **3,743 ms** |
| app content, median / worst | 2,422 / 4,842 ms | 2,422 / 5,640 ms (60,050 with the blanks) |
| page, median / worst | **2,136** / 6,576 ms | 2,418 / 5,254 ms |
| contract miss | 0% (0/20) | 5.9% (1/17) |
| broken renders | 2.5% (1/40) | 8.8% (3/34) |
| **$/session** | $0.0421 gen + $0.0082 img = **$0.0503** | $0.0250 gen + $0.0075 img = **$0.0325** |

Three readings, in the order they matter:

1. **The blank boot is gone from BOTH columns.** HANDOFF-4's headline was one
   boot in three emitting the identity comment and no document, and 2.5 s of
   black. This run: `data-os-boot-ink` said `none` on **0 of 8** boots, and the
   harness's independent pixel probe saw a boot screen on 8 of 8. The unhedged
   control is what settles the credit: **the boot budget raise (800 → 1,600,
   SERVER-v03's measurement that `max_tokens` on Cerebras includes reasoning)
   is what fixed it, not the hedge.** The hedge was insurance against a fault
   that no longer happens.
2. **The hedge won 4 of 48 generations** (`or-oss120-groq`: 1 boot, 1 desktop,
   2 pages), **0 failovers**, and the routed column is *slower* at the median on
   both boot ink and desktop interactive. n=4 per column is too small to call
   that a real slowdown — but it is decisively not a speed-up, and the cost is
   not in doubt: **79,881 loser input tokens per session, +55% on the bill**,
   for 8% of generations.
3. `auto`'s better contract and broken-render numbers are real but not the
   hedge's doing: hedging happens server-side on one client connection, and
   every fault in the cerebras column was a client-side blank window (below) or
   one missing hook. Same engine wrote 44 of 48 routed generations.

**Recommendation.** Leave `/` on `cerebras-oss120` and keep `routes` + `auto`
exactly where they are: on `/bakeoff` as a judged lane, and as the one-variable
production lever the day Cerebras has a bad hour that the budget raise does not
cover. Revisit with `HEDGE_AFTER_MS_BOOT` at something other than 0 — starting
both lanes at once is what makes the hedge cost a full second input pass every
time; a 600–900 ms trigger would buy the same insurance for a fraction of the
sessions. That is a one-line change in `engines.json` and a cheap measurement
(`scripts/hedge-probe.mjs`).

---

## What I looked at in the shots

### Window chrome — passes, with focus the weak leg

Title bars are there on every window of every boot, every one carries its
document's title, and all three controls are present with visible marks and a
real hit area (PROMPTS-3's "requirements of a usable window" section is
holding). The best of them are very good: FORGEWIN (`cerebras-oss120` boot 1,
dock) draws a near-black bar with cream monospace and three coloured controls at
high contrast (`cerebras-oss120/1/desktop-after.png`).

The weakness is **focus state.** `data-os-focused="true|false"` is on every
window root and `data-os-active` on the matching task entry (H4 landed), but on
the taskbar desktops the model's *styling* of those attributes is barely
perceptible in the title bar — on `auto/3/app-notes-late.png` the focused
window's bar differs from the two behind it by about one step of grey, and the
only unmistakable focus signal on screen is the highlighted task entry in the
bar. Not a fault against the contract; it is the next prompt sentence worth
writing (require a *named* difference — the title bar's own background, not its
text colour — for `[data-os-focused="false"]`).

### The bar inside the viewport — one clear failure in eight

Seven of eight boots put their bar at the right edge with its contents legible,
including both dock desktops (`cerebras-oss120/1`: icons and labels wholly
inside, nothing clipped).

**`auto` boot 1 (glide7) failed, and failed in a way nothing was measuring.**
Its taskbar's own box sat perfectly inside the viewport — `taskbarEdge:
"bottom"`, `data-os-fit` never fired — while **every task entry was a blank
rounded rectangle whose icon and label were below the bottom of the screen**
(`auto/1/desktop-after.png`, bottom strip; the entries straddle the bar's top
edge and hang out the bottom). "The bar is at the right edge" and "the bar is
legible" are different claims and only the first one was ever checked.

Both halves are fixed this pass:

- **Instrument** (`scripts/run.mjs`, `inspectDesktop`): every bar descendant is
  now measured against the viewport and against the bar's own box —
  `barFit.outside`, `barFit.overflowsBar`, `barFit.overflowBottom` — plus
  `tasks` / `tasksLegible` (§12.3's one-entry-per-open-window, counted only
  where the entry is on screen and carries text or an icon) and `clockInside`.
  A new report section, "The bar, inside the viewport", prints it per boot.
- **Repair** (`kernel/inject.ts`, `fitBarContents()`, step 3 of the fit guard):
  a bar with a descendant outside the viewport is grown to contain its own
  children and pinned to its edge, recorded in `data-os-fit-bar` and undone at
  unmount. Geometry, so the kernel's (§2.2); it cannot fire on a bar that
  already fits, refuses a bar that wants more than a third of the screen, and
  is asked on window focus, which is when the entries change.

**Caveat, stated plainly: `fitBarContents` has no test.** The unit suite is a
`node` environment with no DOM, and the e2e fixture it needs
(`bar-contents-overflow`, a mock desktop whose task template is taller than its
bar) does not exist yet. It is wired, it type-checks, and the mock harness boots
clean through it — that is not the same as covered. First item on the kernel
list below.

### The encyclopedia's numbers — fixed, convincingly

BAKEOFF-3 issue 6 and HANDOFF-4 #4 are closed. `en.wikipedia.org/wiki/Moon`
now renders an invented satellite of an invented planet in invented units, with
no real Moon figure anywhere: *"the primary natural satellite of the planet
Vinnel in the Oldworks system… mean diameter 8 755 aisle… mass 1.85 × 10²³
pallet… orbital period 68.8 cure"*, named after an invented event ("the
Retirement of the Standard"). Every boot's encyclopedia page carried its own
rolled calendar, unit system and place pair (H5, `reality_offset`). This is the
clearest single improvement in the product since BAKEOFF-3.

### App pictures on the second photograph — **not answerable, and that is the finding**

I could not judge it, because **no app document in 32 opens declared a single
picture slot.** Every line of the run reads `pics 0/0`: `browser`, `calculator`,
`notes` and `store` — the four apps SPEC §7 opens — never write
`data-os-img`. The 22 images this run bought were 16 boot pictures (wallpaper +
icon sheet per boot) and 6 page photos. §12.5's "4 images per app open" belongs
to `photos`, which the §7 protocol does not open, and the harness's `0/0` read
as "nothing to fill" rather than "nobody asked".

The one boot I ran with `--apps=photos,…` to answer it properly hit the blank-
window bug on all three apps (see below) and taught me something else instead.

Two things landed anyway:

- **The instrument is no longer a fixed wait.** `photographApp` polled at a flat
  4 s, and an app is allowed four pictures against a two-wide kernel lane, so
  wave two lands at ~6 s: *every second wave was being reported as lost*, which
  is very likely the whole of "two of four app pictures never land" across three
  passes. It now polls until the count has been still for 3 s (10 s ceiling) and
  records `imgLastFillMs` — when the last picture actually arrived.
- **fal is four times slower than IMG-LATENCY-1 measured**, this hour:
  wallpaper median **8,860 ms** (was 2,959), icon sheet **10,260 ms**, worst
  13,692 ms, and 2 of 22 never arrived (one `img upstream`, one
  `img timeout (clock)`). That is why every desktop in this run reveals on the
  model's own CSS and gets its photograph seconds later. Nothing in our code
  changed; `sync_mode` is still on. Worth one A/B before anyone concludes the
  wallpaper is slow *by design*.

---

## The blank app window is still here, and it is now proven client-side

`cerebras-oss120` boot 1: `browser` and `calculator` both sat blank and unstyled
for the full 60 s step ceiling while the same boot's `notes` and `store`
answered in 2,424 ms and 410 ms. BAKEOFF-3 open issue 1, unchanged, 2 of 32 app
opens.

**What is new is that it is no longer a suspicion.** The run's telemetry has 8
boot lines and 8 desktop lines for 8 boots — nothing lost there — and **29 app
lines where 32 were opened**. No abort, no timeout, no error, no `blocked`: the
three missing generations have **no server line of any kind**, which can only
mean the `POST /api/gen` never left the browser. The kernel's own retry for a
dropped speculative handle (HANDOFF-4's fix, `streamDocInner`) cannot help,
because there is nothing to retry: the fetch is sitting in Chrome's per-origin
HTTP/1.1 connection queue, and the kernel is waiting on a promise that will not
settle.

I built the obvious fix and **measured it into the ground**, which is the more
useful result:

- `kernel/gen.ts` now has a generation admission lane mirroring the image lane —
  three at a time, boot and desktop at the front of the queue, with a reporter
  (`setGenWaitReporter`) so a generation that waits says so in the HUD instead
  of waiting invisibly in the browser's queue. Three unit tests
  (`test/genlane.test.ts`): the ceiling holds, a desktop is never queued behind
  a page, and a wait is reported.
- It passes the whole mock harness (boot, three apps, six pages, clean) and at
  **3 it starved every app generation of a real boot**: the verification boot on
  `auto` opened `photos`, `browser` and `store` and all three were blank, with
  five telemetry lines in the entire session
  (`reviews/shots-bakeoff/4-verify/telemetry.jsonl`). Against 2-in-32 with no
  lane at all, that is a regression, not a fix.
- So **the lane ships inert** (`GEN_CONCURRENCY = Infinity`; `setGenConcurrency(n)`
  is the switch, and the tests set it explicitly). The tree's generation
  behaviour is byte-for-byte v0.2's. The mechanism and its tests are in place
  for whoever finds the real number.

The finding underneath it is worth more than the lane: **the kernel holds more
than three generation connections open across a real boot.** HANDOFF-4 wrote
"the kernel never needs more than three live generations (2 images + 3 = 5 of
6)" as the invariant that made the image lane safe, and a lane built to enforce
exactly that invariant deadlocks — so the invariant is false, and the count of
what is actually open at the moment an app window opens has never been measured.
That measurement, not a bigger number, is the next step.

---

## Ranked, for the next pass

1. **Count the connections.** Instrument every `fetch` the kernel starts and
   ends (kind, id, open/close) and print the live count when an app window
   opens. Then the blank window is a number, the lane's width is a choice rather
   than a guess, and HANDOFF-4's invariant is either true or replaced. Free, on
   mock and on one real boot.
2. **`fitBarContents` needs its fixture.** `bar-contents-overflow` in the mock
   (a task template taller than the bar) plus one e2e assertion that
   `data-os-fit-bar` fires and every `[data-os-task-for]` box ends up inside the
   viewport. It is the only thing in the tree this pass with no test.
3. **`HEDGE_AFTER_MS_BOOT` at 0 is what makes `auto` expensive.** Measure the
   hedge with a 600–900 ms trigger on `boot` and `desktop`
   (`scripts/hedge-probe.mjs --kind=boot --n=10`, a few cents). If the insurance
   survives a trigger, `auto` becomes affordable and the verdict above can flip
   on evidence.
4. **Focus state as a prompt sentence**: require a named, unmistakable
   difference for `[data-os-focused="false"]` — the title bar's own background,
   not its text colour.
5. **Open `photos` in the §7 protocol**, or the §12.5 app pictures stay
   unjudged: the four protocol apps ask for no pictures at all. One line in
   `scripts/bakeoff.mjs`'s `--apps` default, plus the picture-poll instrument
   that now exists.
6. **fal's latency tripled this hour** (wallpaper 2,959 → 8,860 ms median). One
   A/B against IMG-LATENCY-1's config before treating the slow reveal as ours.
7. **`mercury-2.5` still unjudged** — four passes running, 403 from this
   network. Either the key or the network is the blocker; ten minutes would
   settle which.

## Harness changes this pass (all in `scripts/`)

- `--alternate`: one flat run plan interleaving the engines' boots, per-boot
  telemetry slices folded into per-engine buckets, and an interrupted run still
  writes a partial column for every engine instead of a complete one for the
  first.
- `bootOnce` reads the kernel's `data-os-boot-ink` / `-hold-ms` /
  `-revealed-ms`, so ink is reported by two independent instruments (the
  runtime's message and the runner's own pixel probe) and a blank boot is
  distinguishable from a harness miss.
- New report sections: **H3** (per-boot ink, hold, reveal, blank-boot count),
  **H2** (hedged count, winner per kind, loser abort time and billed input),
  **the bar** (above), **pictures inside app windows** (above).
- `photographApp` polls for pictures instead of waiting a flat 4 s.
