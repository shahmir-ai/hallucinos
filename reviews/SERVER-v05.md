# SERVER-v05 — three hedge triggers, a pinnable `/`, tile sheets, and a harness that fails

2026-09-17, ~23:15–02:xx PKT. Server pass over the architect's live test of
23:15 (D1–D6) and seams T1–T4. Owns `server/**`, `engines.json`, `test/**`,
`scripts/**`, `DEPLOY.md`, `.env.example`, `README.md`. `kernel/**`, `e2e/**`
and `prompts/**` were read only — two other sessions were writing those in the
same tree during this pass (see "Tree note").

**Headline, and it is not the one the seam expected.** T1's ruling — race both
lanes on `kind=boot` from 0 ms because it costs ~$0.001 and it is the first
pixel of the product — is implemented and is the code default. The 40 real
boots the brief asked for **do not support its latency half**: at this hour the
hedge lane never produced first content in any of the 40, the primary won
40 of 40, and the measured difference between the arms is smaller than the
provider's own variance. What 0 ms actually buys is insurance, and tonight the
insurance did not fire even in the two boots where it was armed *and* the
primary took 1.2–1.9 s. Numbers in §1.

**Tree state: unit green; e2e 105 passed / 4 failed, and all four failures are
the kernel session's in-flight work in this shared tree — one of them is a real
integration finding from T1 and is written up in §7.** `npm test` **341 unit**
(29 files; 305 across 30 files before this pass — +41 mine, and
`test/genlane.test.ts`'s 5 removed by the kernel session mid-pass) · `npm run build` clean. Nothing committed. Port 8799
and `dist/play.js` untouched; the probes used 8793–8796 and the suite its own
8770–8780.

**Spend: $0.104** — $0.101 the D1 experiment (40 boot heads, images off) and
$0.003 the first real tile sheet (§3), against the $0.15 ceiling.

---

## 1. D1 — does racing from 0 ms cut time-to-first-content?

`scripts/hedge-probe.mjs --n=10 --kind=boot --engine=auto --triggers=0,1200`,
twice (`reviews/hedge-6-triggers.json` at 23:36, `-b.json` at 23:37). Heads
only: no desktop, no app, no page, no images. `--triggers` is new and is the
only honest way to alternate this arm — the trigger is *configuration*, so each
value gets its own server process on its own port and the requests alternate
between them one at a time, which is what makes both arms share the same minute
of the provider's mood (HEDGE-2's lesson: TTFB moved by a factor of six inside
one afternoon).

**n = 20 per arm, alternated, 23:36–23:38 PKT, `engine=auto`
(cerebras-oss120 primary + or-oss120-groq hedge).**

| reading | `HEDGE_AFTER_MS_BOOT=0` | `=1200` |
|---|---|---|
| boots | 20 | 20 |
| **hedge lane actually started** | **20 / 20** | **2 / 20** |
| **lanes that won by producing first content** | cerebras-oss120 **20/20** | cerebras-oss120 **20/20** |
| failovers (the lane that inked first did not finish) | **0** | **0** |
| time to first content, median | **911 ms** | 980 ms |
| p90 | **1,179 ms** | 1,304 ms |
| p100 | **1,790 ms** | 1,912 ms |
| min | 689 ms | 618 ms |
| provider TTFB of the winner, median | 869 ms | 806 ms |
| **$ per boot** | **$0.002895** | **$0.002150** |
| documents that never arrived · identity fallbacks | 0 · 0 | 0 · 0 |

Read honestly, that table says four things:

1. **Arm 0 is ahead at every quantile — median 69 ms, p90 125 ms, p100 122 ms —
   and none of it can be attributed to the hedge**, because the hedge lane did
   not produce first content in a single boot of either arm. Two arms of
   twenty draws from a distribution whose own interquartile spread is ~300 ms
   differ by less than their noise; the winner's *median provider TTFB* is in
   fact 63 ms **worse** in arm 0, which is the same statement from the other
   side. So: no measured latency win, in either direction.
2. **Arm 0 costs 35% more per boot** ($0.00075), which is real, small, and
   exactly what the ruling said it would be (~$0.001).
3. **The two boots that armed the hedge at 1,200 ms still lost it.** The hedge
   fires precisely when the primary is slow, and in the only two cases where it
   fired, the slow primary still beat `or-oss120-groq`. Across 40 boots tonight
   the hedge lane has never won, at either trigger. Combined with HEDGE-3's
   "the primary won 19 of 20", the standing score for this hedge pair on
   `kind=boot` is **0 wins in 60**.
4. **Therefore the open question is not the trigger, it is the hedge lane.** A
   second provider that cannot beat a primary having a bad second is insurance
   with no payout. If the architect wants the boot's tail covered, the cheap
   experiment is a *different* hedge engine (`groq-oss20` on the direct Groq
   endpoint rather than through OpenRouter, say) measured the same way — one
   variable in `engines.json`, ~$0.05 to answer. I did not change the routing
   table: that is a ruling, not a repair.

What I did NOT get to measure: a bad provider hour. The architect's own live
test at 23:15 reported "provider first token slow tonight", and by 23:36 the
primary's median TTFB was 806–869 ms with a p100 of 1.9 s — a perfectly
ordinary hour. The case 0 ms exists for is the 2.1–4.7 s afternoon in HEDGE-3,
and no instrument in this repo has yet caught the hedge in that weather.

**D1's verdict, plainly: the ruling stands as shipped (0 for boot), but its
justification is now insurance, not speed, and the insurance is unproven.**

## 2. T1 — three triggers, and `DEFAULT_ENGINE` finally does something

### The triggers

`server/hedge.ts` `hedgeTriggers(env)` / `hedgeAfterFor(kind, env)`:

| kind | variable | default | why |
|---|---|---|---|
| `boot` | `HEDGE_AFTER_MS_BOOT` | **0** | the first pixel of the product, the smallest prompt in it; ~$0.001 a boot |
| `desktop` | `HEDGE_AFTER_MS_DESKTOP` | **600** | the biggest prompt and the biggest document; a primary having an ordinary second must not be double-bought |
| app · page · repair · identity | `HEDGE_AFTER_MS` | **900** | a late window is a smaller loss than a late boot, and a visitor asks for many |

**D6, the part that was costing money: `boot` and `desktop` shared
`HEDGE_AFTER_MS_BOOT` until now, so every routed boot bought two desktops.**
That matters more than the boot's own second lane, because the desktop is the
biggest prompt in the product — and it also re-reads the history: HEDGE-2's and
HEDGE-3's "set it to 1200" were measured on the shared variable, so most of
what they priced was the second *desktop*, not the second boot. Splitting the
variable is what lets the architect's ruling (boot at 0) and their cost finding
(don't buy two of the big one) both be true.

Read **per request** now rather than at module load. That is a deliberate
change: the tests set one around a single call, and an operator changing a
Railway variable should not have to reason about when the module was imported.
A value that is empty, negative or unparseable is the default, not zero —
tested, because for `boot` zero means "always buy two lanes" and a typo that
read as 0 would double every bill.

### `DEFAULT_ENGINE`

`advertisedDefault()` now honours any `DEFAULT_ENGINE` naming an engine this
process holds a key for, mock or not. `enginePinned()` is the same verdict as a
value and is published three ways:

- `GET /api/engines` → `{"default":"cerebras-oss120","pinned":"cerebras-oss120","routing":true,…}` — `auto` stays in the list, because the pin is about what `/` boots, not about taking the router off the bake-off surface.
- `GET /` → `<body data-mode="plain" data-build="…" data-engine="cerebras-oss120">`. Never on `/bakeoff/run`: there the engine is the judge's query.
- the `listening` line → `default_engine`, `pinned`, `hedge_after_ms: {boot,desktop,other}`. HANDOFF-6 §2 existed for two versions partly because none of this was printed anywhere, so a deploy could not be checked against its own recipe.

**The kernel half is not done and is not mine.** `kernel/index.ts`
`chooseEngine()` returns `auto` on `/` whenever `/api/engines` lists it, before
it looks at the server default — so until that one clause reads `pinned` (or
`document.body.dataset.engine`), `/` is still routed whatever the variable
says. Both spellings are shipped and stable for whoever writes that clause; an
older kernel ignores them. I considered and rejected two server-only ways to
force it: dropping `auto` from `/api/engines` (breaks `/bakeoff/run?engine=auto`,
which is the judging surface), and resolving `auto` to the pinned engine inside
`/api/gen` (conflates the router with the pin and lies to the bake-off).

## 3. T2 — tile sheets

`/api/img` gains `kind: "tiles"` with `theme` ∈ {`faces`, `posters`,
`products`, `thumbnails`, `covers`}: one **768×768** sheet, 4×4, sliced by the
runtime exactly as `faces` always was (`kernel/sheet.ts`, unchanged), one sheet
per document counting as **one** picture against the app's four or the page's
two.

- **`faces` is an exact alias** — `{kind:"faces"}` means `{kind:"tiles", theme:"faces"}`, same size, same bucket, same slicing, and the response echoes back the word the client used (`kind:"faces"`, `theme:"faces"`) so a kernel that has not shipped the field keeps its pictures. `normalizeTiles` is the whole alias table and it is unit-tested.
- **The prompt has two authors.** The theme's subject clause and the grid geometry are the server's (seam S3); the set description is the group's own `data-os-prompt` on its first element, whitespace-collapsed and clamped to 320 characters so the geometry clauses stay within reach of the model's attention; the palette is the machine's **for an app only** — a page receives no identity at all (SPEC §3.1), which is enforced by the declared scope, not by trust.
- **An unknown theme is a `400`, not a fallback.** `IMG_MODEL`'s typo tolerance exists because a deploy variable must not take every visitor's pictures away; this field comes from our own kernel, and drawing sixteen faces where sixteen posters were asked for spends $0.003 on the wrong picture and hides the mismatch.
- **Moderated exactly like `photo` and `map`** — the built prompt goes through the local list synchronously and the remote call in parallel; a flagged one is a silent 404 (SPEC §1.4).
- **The theme is part of the fal seed**, so two sheets in one document are not the same sixteen pictures twice.
- Telemetry carries `img_theme` on the success and the failure lines.

**`prompts/images/tiles.md` already exists** — the prompt session wrote it
during this pass, against this same seam, and it wins over the builtin exactly
as every other image prompt does. Its five subject clauses and mine differ by a
word or two; theirs is what ships, mine is the no-prompts-directory fallback,
and the tests assert the *contract* (subject → set → geometry, "no text",
"4x4") rather than either file's wording.

### The first real tile sheet — `reviews/shots-server-v05/tiles-posters-768.jpg`

One live call, `$0.003`, `theme: "posters"`, set description "the genre mix of
this catalogue leans to mountaineering documentaries and light opera", no boot
in the session (so the palette fell back to `imgPromptVars`' default, which is
why it is grey and amber rather than a machine's colours). 768×768, 502 KB,
**7.4 s** of provider time — one sample, and three times IMG-LATENCY-2's median,
which is fal's queue rather than the size.

What it proves and what it does not:

- **Sliceable: yes.** Sixteen separate pictures, one per cell, 4×4, in a grid the
  runtime's quarters land on. **No text anywhere**, which was the clause most at
  risk on this exact theme (flux wants to letter a poster).
- **There are visible gutters and a white border**, against the clause that
  forbids them — which means the sheet is sliceable because
  `kernel/sheet.ts`'s 7% inset trims them, not because the prompt was obeyed.
  The gutter here is ~2% of the sheet, so the inset covers it. A sheet with a
  wider frame would put a neighbour's white edge inside every tile, and this is
  the failure to watch.
- **"All sixteen different" was obeyed in composition and not in subject**: all
  sixteen are a mountain and a sun. "Light opera" produced nothing. So a tile
  sheet gives a document sixteen *distinct* pictures of **one motif**, not
  sixteen subjects — which is fine for a shelf of thrillers and wrong for a
  catalogue that says it is mixed. That is a prompt finding, not a server one
  (`prompts/images/tiles.md` is the prompt session's file); the cheap lever is a
  clause asking for sixteen different subjects, and the honest alternative is to
  tell documents that a sheet is one motif.
- Untested live: the other four themes, and a sheet with a real identity's
  palette.

**One thing that file gets wrong about itself, now fixed on my side.** Its
"Deviation to note" says the five subject clauses also live in
`server/imgprompt.ts` "as the fallback for a tree with no
`prompts/images/tiles.md`", and that the file wins if they disagree. They are
not a fallback: `{{theme_subject}}` is a *variable*, so the file renders
`BUILTIN_TILES[theme]` — the server's words — even when the file is present. The
file owns the sentence and the geometry; this table owns the subject. I have
aligned `BUILTIN_TILES` to their reviewed table word for word, so the
distinction currently costs nobody anything, and said so in the code where the
next person will look. Rendered output, all five themes, is in §3's own
verification (the app arm carries `oxide, bone, signal green`, the page arm
carries nothing of the machine).

One mechanical deviation from that file's commentary: it says an empty variable
"leaves an empty comma-separated slot, which reads as nothing to the image
model". True, but `buildTilesPrompt` now collapses `, ,` runs and trims leading
and trailing commas, so a page's sheet (no palette) and a set-less sheet are
sent a clean sentence. No wording changed.

## 4. T3 — picture sizes, the image ceiling, and the harness

| kind | size | change |
|---|---|---|
| wallpaper | **1024×576** | **up** from 768×432 — back to SPEC §12.5 |
| icons | 768×768 | unchanged |
| tiles | 768×768 | new |
| map | 768×576 | unchanged |
| photo | 640×640 | unchanged |

The wallpaper is the one picture that fills the screen, and the 5–7 s that
argued it down to 768×432 in v0.2 (IMG-LATENCY-1) was mostly **our own second
round trip for the bytes** — which `sync_mode` removed in v0.4
(IMG-LATENCY-2). It is still one billing unit (0.59 MP). **Unverified on the
real endpoint in this pass**: the honest expectation is a slightly slower
picture for a sharper one, and it is the first thing to watch in the next
real-engine sweep (`img_px` is on every image line).

`IMG_TIMEOUT_MS` code default 18,000 → **20,000** (HANDOFF-6 §3's
one-variable mitigation, with R4's correction that the number it was arguing
against was already 18,000).

### `scripts/run.mjs` — the harness now fails

Three changes, all of them because HANDOFF-5's verification boot A lost four of
four windows and the run exited 0 with "0 chars" in its table:

- **`openAppAndWait` classifies its own failure** — `no-window` (no frame ever appeared), `window-id-null` (a frame the kernel never registered), `never-inked` (a window that exists and shows nothing; the ink test is the box test, not `innerText`, because a document of pure SVG has no characters). Each one is recorded with the kernel's own `window.__osTrace()` excerpt, printed at the time, given a **Failures** section in the report, and **exits the run non-zero** (`exitWithFailures`, wired into `smoke.mjs`, `bakeoff.mjs` and `integrate.mjs`).
- **`bootOnce` attaches the trace** to the boot record on any boot that ends in the kernel's error/queue screen or never reaches `data-os-ready`, and on a boot whose frame never inked (recorded, not fatal — the OS is usable; it is HANDOFF-6 §9's `UNNAMED/0OHK` case).
- **`--viewport`** — default `1440x900`, `mobile` = **390×844**, or any `WxH`. Below 768 px the context is a real touch device (Android UA, touch points), because SPEC §2.2's mobile geometry and §12.3's launcher arithmetic have never been driven by any harness at phone width.

Verified on the mock engine at both viewports: `inner` 1440×900 and 390×844,
boot contract ok, `notes` opened with `windowId w1` and inked at both sizes,
and an app id with no launcher produces `no-window` with a six-line trace and a
non-zero exit. (`/private/tmp/.../t3check.mjs`, a scratch script, not in the
tree.)

## 5. T4 — contract patches as a rate

`POST /api/mark` accepts `contract_patch: string[]` against the generation's
`gen_id`; `/api/stats` counts it per engine.

- Kinds are an **allowlist** — `chrome`, `task`, `label`, `hooks`, `archetype`, `clock`, `other` — because the field arrives over HTTP and an open key space is an unbounded per-engine map. Anything else is bucketed as `other`.
- Unlike the four timings, the list is a **set and unions**: T4's chrome check runs when the desktop mounts and again on the first window, and a launcher label is re-shown after the pictures land, so one generation legitimately reports twice. Only kinds new to the line are counted, so `patch_gens` moves once per generation.
- The **denominator is the contract-checked generations** (`contract_gens`: desktop, repair, app), not all of them. Counting patches against every generation would report a lower rate for an engine that happened to serve more pages.
- Per engine: `contract_gens`, `patch_gens`, `patches: {chrome: n, …}`, `patch_rate` (null when nothing was contract-checked — 0/0 is not 0%). Across engines: `contract_patches`, `contract_patch_gens`, `contract_patch_rate`.
- An early mark (before the generation's line exists) is held and folded in, like the timings.

**The kernel half of T4 is not in this pass** — `kernel/**` belongs to another
session, and the chrome/task/label checks and the bare unstyled strip are
theirs. The server contract above is what they report against, and it is live
and tested today: one POST with `{"gen_id":…,"contract_patch":["chrome"]}` and
the rate appears.

## 6. What this pass did NOT do

- **No kernel work.** D2 (an invisible close control), D3 (launcher labels that
  vanish when the plate sheet lands) and D4 (the clock jammed against the OS
  name) are kernel and prompt defects. T4's server half is the only part of
  them I own.
- **D5 is half-answered.** The pictures land late because fal takes 2.6–14 s;
  T3's 20 s ceiling stops us throwing away the ones that arrive, and R4 already
  showed the sheet is 768×768. Nothing here makes a picture faster. The
  wallpaper is now *bigger*, which is a deliberate trade the next sweep should
  price.
- **No prompt files were written.** `prompts/images/tiles.md` is the prompt
  session's.
- **No real-engine verification of T2 or T3.** The tile sheet has never been
  drawn by fal — only by the fake fal in `test/routes.test.ts`, which asserts
  the request body (768×768, the theme clause, the set, the geometry). The
  first real sheet is one `/api/img` call away and should be looked at before
  anyone ships a poster wall.

## 7. Verification

| check | result |
|---|---|
| `npm test` | **341 passed**, 29 files. 305/30 before this pass: **+41 mine** (`hedge`, `img`, `imgprompt`, `routes`, `routing`, `telemetry`) and **−5** in `test/genlane.test.ts`, which the kernel session deleted mid-pass along with the lane it tested |
| `npm run test:e2e` (mock) | **105 passed, 4 failed** — see below; the suite grew from 102 because the kernel session added `chrome`, `labels`, `mobile`, `tiles` and `hittest` specs during this pass |
| `npm run build` | clean |
| `npx tsc --noEmit` | **clean** (it was not mid-pass: `kernel/img.ts` carried a `centreGlyph` arity error for an hour while the kernel session was writing it — see Tree note) |
| live server, `DEFAULT_ENGINE=cerebras-oss120` | `listening` prints `default_engine: cerebras-oss120`, `pinned: cerebras-oss120`, `hedge_after_ms: {boot:0, desktop:600, other:900}`; `/api/engines` answers `default`/`pinned` both `cerebras-oss120` with `auto` still listed; `/` serves `<body … data-engine="cerebras-oss120">` |
| one real tile sheet | $0.003, §3 |
| mock rehearsal of `--triggers` | arm `@0` hedged 2/2, arm `@1200` hedged 0/2, two servers, alternated |
| D1 | 40 real boots, $0.101, §1 |
| harness check | both viewports, window id, loud failure, §4 |

### The four e2e failures, and whose they are

The tree had three sessions writing it (§8), and `npm run test:e2e` rebuilds
`public/kernel.js` from whatever `kernel/**` currently says — which is mid-edit.

| failing spec | mine? | reading |
|---|---|---|
| `backdrop.spec.ts:91` — the window just opened is wholly above the ones already open | no | window stacking, pure kernel geometry; nothing in this pass touches it |
| `noreplace.spec.ts:71` — interactivity is attached while the document is still streaming | no | §12.2's rule, kernel delegation; same |
| `osimg.spec.ts:181` — a page gets two, and `faces` is one sheet sliced into `[data-os-face]` | no, but it is T2's | the fake intercepts `/api/img` **in the browser**, so it asserts what the KERNEL sent: `['faces','photo']`. The kernel now sends `kind:"tiles"` for a `data-os-img="faces"` element (their `kernel/protocol.ts` maps it), which is the alias working. This spec is superseded by their own new `e2e/tiles.spec.ts`; the server accepts both spellings either way |
| **`routing.spec.ts:20` — `/` boots on the routed engine when the server advertises it** | **yes, this one is T1's** | the kernel asked `mock` where the test expects `auto`. `routeEngines` in `e2e/fakes.ts` fetches the REAL `/api/engines` and only overrides `pinned` when the test passes it; every e2e server runs `DEFAULT_ENGINE=mock` (playwright.config.ts), so the real answer is now `pinned: "mock"` and the kernel — correctly — honours the pin over the faked `default: "auto"`. The second witness makes it unavoidable for a fake: a `page.route` interception cannot change `<body data-engine>` in the page's own markup. **The fix is one line in the fake** (`j.pinned = opts.pinned ?? null` whenever `auto` is being advertised), or that test passing `pinned: null`. `e2e/**` is not mine, so I have not touched it; their own new `routing.spec.ts` tests at lines 112–160 are written against exactly these two witnesses and pass |

That last row is worth the architect's attention for one reason beyond the
test: **on an e2e server the pin is real** — `DEFAULT_ENGINE=mock` means `/`
genuinely is pinned to mock, and `/` booting mock there is the correct new
behaviour. The failing test's premise (a server advertising `auto`) is now
something the fake has to say twice.

New unit coverage, by what it holds still:

- `test/hedge.test.ts` — the trigger table, per-kind, and that an empty/negative/unparseable value is the default rather than 0.
- `test/routing.test.ts` — the behavioural half, through the real route against two **chunked** fake upstreams (HANDOFF-5's trap note: the trigger was inoperative for a whole version because the bug was in how `chooseLane` read the primary's first chunk, which only a chunked upstream produces). A desktop whose primary answers inside 600 ms is **not** hedged; past it, it is; a boot is hedged at the same 200 ms the desktop refuses to hedge at; `HEDGE_AFTER_MS_DESKTOP` is honoured per request. Plus the `DEFAULT_ENGINE` pin, on `/api/engines`, on `<body>`, and *not* on `/bakeoff/run`.
- `test/img.test.ts` — T3's sizes (and that every one is still under 1 MP), `normalizeTiles`' alias table, the scope a sheet is charged to.
- `test/imgprompt.test.ts` — the tile prompt's contract: subject → set → geometry, palette for an app and none for a page, the machine's name never in it, both clamps.
- `test/routes.test.ts` — tiles end to end against the fake fal (768×768, prompt parts, a themed sheet, the `faces` alias, a set-less sheet, a bad theme refused before anything is bought, one sheet counting as one of a page's two, moderation), and T4's rate through `/api/mark` → `/api/stats`.
- `test/telemetry.test.ts` — patch normalisation, per-engine counting, the union-not-overwrite rule, early marks, and the null rate.

## 8. Tree note

Three sessions were writing this tree at once. `kernel/img.ts`,
`prompts/**` and `dist/server.js` all changed under me during the pass; the
`tsc` error in the verification table is the kernel session's work in progress,
not a regression of mine, and `prompts/images/tiles.md` appearing mid-pass is
the prompt session landing the other half of T2. `npm run build` overwrites
`public/kernel.js`, which is shared — I built twice and said so here rather
than pretending the tree was mine. `dist/play.js` and port 8799 were never
touched, nothing with `play.js` in its command line was signalled, and nothing
is committed.

## 9. What I would do next, in order

1. **The kernel's `chooseEngine` clause** (one line, reads `pinned` or `data-engine`). Until it lands, `DEFAULT_ENGINE` is still cosmetic on `/` and the money finding in HANDOFF-6 §2 is only half closed.
2. **Re-run D1 in a bad hour, or change the hedge lane.** Zero wins in 60 boots is the finding that matters; the trigger is the wrong knob to keep turning.
3. **Draw the other four themes** ($0.012) and look at them — `posters` is done (§3) and it says the sheet is sixteen pictures of ONE motif, which is a prompt decision somebody should take deliberately.
4. **Price the 1024×576 wallpaper** against the 768×432 numbers in the next sweep — `img_px` is on the line and the sweep is free if it rides an existing run.
5. **One line in `e2e/fakes.ts` `routeEngines`** — `j.pinned = opts.pinned ?? null` whenever `auto` is being advertised — so a test that fakes the router is not overruled by the real server's pin (§7's fourth failure). `e2e/**` is not mine.
6. **One e2e spec that clicks a dock launcher by coordinate** (HANDOFF-6 #7, still open, still free) — mine is the harness half, `e2e/**` is not mine.
