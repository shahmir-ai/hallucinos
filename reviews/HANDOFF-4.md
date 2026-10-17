# HANDOFF-4 — v0.2 punch list closed, and the boot screen turns out to be blank

2026-09-17, ~18:00–21:00 PKT. One pass over **BAKEOFF-3's "Open issues, ranked"**
(the live list; HANDOFF-3 §6 and BAKEOFF-2's findings were already closed by that
run) plus the verification sequence from a wiped `node_modules`.

**Spend: $0.114** against a $1 ceiling — two real verification boots ($0.044 +
$0.046), five single-generation probes on `cerebras-oss120` ($0.012), and $0.012
of images bought by two *mock* harness runs (the mock engine is free; the image
route it calls is not — see "traps", below).

**Tree state: green.** `npm test` **252 unit** (25 files) · `npm run test:e2e`
**72 e2e** on mock (4.3 min) · `npm run build` clean. Was 247/67 at BAKEOFF-3.
Nothing committed.

---

## The headline, which was not on the punch list

**On `cerebras-oss120` the boot screen often paints nothing at all, and two
instruments were hiding it in opposite directions.** Both verification boots
this pass reported `bootPaintMs: null` — the harness never saw a pixel in the
boot frame — while the kernel's own telemetry reported a boot `first_paint_ms`
of 4,176 ms on the same boot. Three single-generation probes say what is
happening:

| probe | tokens out | document |
|---|---|---|
| 1 | 1,681 | **none** — the identity comment, then the stream ended |
| 2 | 771 | a real boot screen, doctype + body |
| 3 | 775 | a real boot screen, doctype + body |

Probe 1 spent its entire budget on reasoning, emitted no `<!doctype`, and the
server's identity then came from the I1 rescue call (`identity_fallback: true`).
Both verification boots show the same signature (`truncated: true`, `fb: true`,
`tokens_out` 1,300 and 800, no pixels). So on a meaningful fraction of boots —
one in three in this sample — **the first thing a visitor sees is 2.5 s of
black**, because SPEC §12.3's floor holds an empty overlay for its full term.

The two instruments:

- **The kernel's `first_paint_ms` for a boot is "the first chunk was written",
  not "something is on screen."** The identity comment alone satisfies it. It
  flatters exactly the case that matters.
- **The harness's boot-paint probe was `innerText.length > 0`**, which reports
  nothing for a boot screen made of CSS and SVG and nothing for text still
  hidden by the machine's own fade-in. Fixed this pass: it now looks for any
  element with a box, `<script>`/`<style>` excluded by name (`scripts/run.mjs`,
  `bootPainted`). It still says `null` on the two real boots, and now that is
  the truth rather than a false negative.

**Not fixed, and deliberately not:** the obvious repair is the kernel painting
its own first frame from the identity comment (HANDOFF-3 §2 proposed it), and
this pass was instructed that no pixel is ours. The fix that stays inside that
rule is to stop holding a blank overlay: have the runtime report *ink* (first
element with a box) as distinct from *paint* (first chunk), and reveal the
desktop immediately when the boot frame never inked. That is a contained change
— one protocol message, one kernel branch, one test — and it is the first thing
the next session should do. Ranked #1 below.

---

## Punch list: BAKEOFF-3's open issues, before → after

| # | issue | before | after | verdict |
|---|---|---|---|---|
| 1 | an app window that never paints, with **no telemetry line anywhere** | 2 of 16 app opens (run B) | root cause found and fixed; 4 of 4 apps painted on both verification boots | **fixed** (mechanism below) |
| 2 | windows paint behind the desktop icons | 2 of 9 desktops | kernel repairs the stacking; 3 e2e tests | **fixed** |
| 3 | launcher labels and icons overlapping | 2 of 9, unmeasured | measured now (`launchersOverlapping`, `launcherWorstOverlap`); **0 on both boots**; one prompt line added | **fixed + measured** |
| 4 | page pictures unreachable in practice | 0 of 4 delivered, grey holes | ruling taken: a page must be looked at for `PAGE_IMG_DWELL_MS` (1.2 s) before it is bought for; a page left inside the dwell costs nothing | **ruled + built** |
| 5 | two app pictures of four die, cause unknown | unlogged | logged at the kernel end with the window, the slot and which controller fired (`cancelled by the window closing` / `by a navigation` / `not delivered`) | **instrumented** |
| 6 | wikipedia recites the real Moon | every boot | the divergence rule now arrives in the **user turn next to the URL** (`prompts/notes/reference.md`, every reference shape, not one domain). Prose, names, history, geology and exploration are now invented — **the measurements are still the real Moon's** | **partly fixed**, see below |
| 7 | the store's last card is clipped | most opens | source-order rule added (catalogue first, extras last and droppable); store rendered 1,076 chars / 73 nodes complete on the verification boot | **probably fixed**, n=1 |
| 8 | `data-os-icon` slots outnumber the sheet's cells | 16/20, 16/17, 16/24 scored as misses | the harness counts launcher-scoped slots only and reports the surplus separately: **16/16 filled, +4 elsewhere** | **fixed (instrument)** |
| 9 | `mercury-2.5` unjudged | 403 | not attempted | still unjudged |
| 10 | a 2-step wallpaper buys no latency | 2 steps | reverted to 4 (BAKEOFF-3 measured 2.9–14.1 s at both counts) | **closed** |
| 11 | the engine `<select>` covers the boot document's first line | reported open | already moved to a bottom-right dock in `kernel/hud.ts`; no boot shot exists to photograph it against, because of the blank-boot finding | **closed in code, unphotographed** |

### Issue 1 — the mechanism, which was not a kernel race

A picture holds its `POST /api/img` open for 3–14 s. The doc-image lane allowed
two, and **the boot's wallpaper and icon sheet bypassed the lane entirely** — so
four image connections could be open at once. Four images plus the boot stream
plus the desktop stream is **six**, which is a browser's per-origin HTTP/1.1
connection limit: the next `POST /api/gen` never left the browser. That is
exactly the reported signature — a blank window, no timeout, no abort, and *no
server telemetry line*, because the server never received a request — and it
explains why the same boot's `store` replayed in 410 ms (a speculative
generation whose connection was already open).

Three changes, ranked:

1. **One image lane for the whole process, two at a time, boot pictures first**
   (`kernel/img.ts`: `requestBootImage` / `requestDocImage`, `imgLaneState`).
   Two images plus at most three live generations is five of six. A desktop
   still never waits behind a store's product shots — boot requests jump the
   queue rather than taking a seventh connection. Two unit tests
   (`test/imglane.test.ts`) pin the concurrency and the priority.
2. **A claimed speculative handle's abort is no longer read as a user
   supersede** (`kernel/index.ts`, `streamDocInner`). An `AbortError` only means
   "the visitor asked for something else" when it came from *this caller's*
   controller; a prefetch's own controller (its TTL, or `gen.start` dropping the
   previous prefetch of its kind) was being rethrown and swallowed by
   `handleGenError`, which would leave an unpainted window with no generation
   and no retry. Defence in depth: this path is probably unreachable today,
   which is why it has no test of its own.
3. **A generation that has painted nothing is never silent again.** `streamDoc`
   reports a stall after 12 s (`STALL_MS`) and reports again if it finishes
   having painted nothing, with the kind, the gen id and the elapsed time. The
   report touches no pixel and cancels nothing.

### Issue 6 — where the encyclopedia now stands

Two probes on the real engine, before and after sharpening the note:

- **Qualitative content is fully invented**: the encyclopedia itself
  ("Encyclopedia of Terralis", "ChronoLexicon"), the planet, the discoverer, the
  history, the named maria and craters, the exploration programme, the
  references.
- **Every measurement is still the real Moon's**: 384 400 km, 3 474.8 km,
  7.347 × 10²² kg, 27.321 days, 1.62 m·s⁻². Adding an explicit "the numbers are
  the part that betrays it" paragraph made it *more* precisely correct, not less.

A prompt line does not beat a prior this strong. The mechanism that already
works for exactly this class of problem in this product is §12.4's dice: the
**server** rolls a per-session reality offset and passes it as a hard
constraint. That is a build, not a sentence, and it is ranked #4 below.

---

## Measured: the verification boot

`node scripts/integrate.mjs --engines=cerebras-oss120 --shots=final-v02
--apps=browser,photos,store,calculator`, viewport 1440×900, machine **Soil
Gauge v1.2.0 rc1 [Marlowe]**, "Measure the earth, mind the words", archetype
`dock`. Raw: `reviews/shots-final-v02/integrate.json`; shots:
`reviews/shots-final-v02/cerebras-oss120/`. The earlier boot of the same tree is
kept at `reviews/shots-final-v02-a/` (machine *mist-wisp*, 2090s monastic
scriptorium).

| step | §12.1 target | boot A | boot B | verdict |
|---|---|---|---|---|
| boot screen paint | < 1.0 s | **none** | **none** | **MISS — the headline above** |
| desktop interactive | < 4.0 s | 5,366 ms | 9,641 ms | MISS, provider-bound |
| desktop revealed | ≥ 2.5 s floor | 6,834 ms | 9,860 ms | — |
| app window content | < 2.5 s | 1,665 / 1,541 / 1,892 / 1,546 ms | 1,511 / 3,985 / 1,385 / 1,687 ms | PASS ×7 of 8 |
| page | < 2.5 s | 1,299 / 2,739 / 3,850* / 7,377 ms | 993 / 1,573 / 2,261 / 3,377 ms | mixed |

\* aborted by the harness navigating on, which is correct behaviour.

The misses are the provider, not the code: boot `provider_ttfb` was 4,113 ms in
boot A and the desktop's 3,414 ms in boot B, against BAKEOFF-3 run A's 693 ms
median. This is the third pass in a row to measure Cerebras swinging by a factor
of three between afternoons; **plan capacity on the bad afternoon.**

Desktop structure, boot B, after images (the numbers the punch list moved):

| reading | value |
|---|---|
| archetype | `dock`, not patched |
| launchers | 16, **16 labelled**, 8×2 grid |
| off screen | **0** |
| overlapping | **0** (worst pairwise overlap 0.00) |
| icon cells filled | **16/16**, +4 slots elsewhere, 0 of those filled |
| wallpaper | landed, in the model's own `[data-os-img="wallpaper"]` slot |
| clock | present, ticking, seconds resolution, in the bar |
| kernel injections | 0 · JS errors 0 · CSP refusals 0 |

`09-desktop-images.png` is the frame worth looking at: sixteen sheet-cut icons,
every label on its own plate, wallpaper behind, nothing clipped.

### Image latency and cost per session

| | boot A | boot B |
|---|---|---|
| image calls | 6 (wallpaper, icons, 4 × photo) | 6 |
| $ images | $0.0180 | $0.0180 |
| $ text | $0.0263 | $0.0277 |
| **$ per session** | **$0.0443** | **$0.0457** |

A session with the photos app open is ~$0.045, of which **40% is pictures** (it
was ~$0.030 and ~20% with two images). At $25/day that is ~550 sessions. The
four `photo` calls were all issued, which is the lane working; whether they
*landed* is invisible to any app screenshot (the harness photographs an app when
its document goes quiet, ~2 s, and a picture takes 3–4 s) — only
`09-desktop-images.png` can show them.

### Traps this pass walked into, for the next one

- **A mock harness run still buys real images.** `--engines=mock` costs $0 of
  text and $0.006 of fal per boot, because the image route does not care which
  text engine was used. Two rehearsals cost $0.012.
- **`node -e "require('.../dist/server.js')"` starts a server.** Importing the
  bundle has the side effect of listening on 8790, and that stale process then
  answered the verification curls with an old build until it was killed. Probe
  the bundle by starting it properly, or not at all.
- **`scripts/integrate.mjs` had its own copy of `inspectDesktop`**, still
  reading the wallpaper off the host element's `background-image` — the exact
  drift BAKEOFF-3 fixed in the bake-off's copy. It would have reported
  "wallpaper: none" on this verification boot for the second time in two passes.
  There is now one copy, imported from `scripts/run.mjs`.

---

## Remaining issues, ranked

1. **The blank boot screen** (above). Report *ink* as distinct from *paint* in
   the runtime, and drop the §12.3 reveal floor when the boot frame never inked,
   so a visitor waits 2.5 s for black exactly never. Then decide separately
   whether a boot generation that emits no document deserves a retry — at 4 s of
   provider TTFB it probably does not.
2. **Boot generations that spend their whole budget on reasoning.** One probe in
   three on `cerebras-oss120`. `reasoning_effort: 'low'` is already the floor
   for this model; the levers are a bigger boot budget (it would not have saved
   probe 1, which spent 1,681 tokens), a different engine for `kind=boot` alone,
   or accepting it and fixing the symptom at #1.
3. **Nothing measures whether a document's pictures arrived.** Every image
   finding in this pass and the last came from telemetry lines read by hand. The
   harness should photograph one app a second time, 4 s after its document
   settles, and count `[data-os-img-filled]` in it.
4. **The encyclopedia's numbers** (issue 6). Needs a server-rolled reality
   offset passed as a constraint, in the shape §12.4 already uses for identity.
5. **Provider variance**, three passes running. Worth one measurement of
   `or-oss20-groq` and `openrouter-oss120` at the same hour before the next
   bake-off, purely as a latency hedge.
6. **The store's last card**, n=1 after the prompt change. Confirm on a real
   bake-off rather than on one boot.
7. **`mercury-2.5` still unjudged** — 403 from this network.
8. **The harness screenshots whatever window is on top**, which on boot B was
   the calculator sitting over the browser for every page shot
   (`08-page-*.png`). It should focus the window it is about to photograph.
9. **24 launchers on boot A**: the dock archetype invites a model to put all
   sixteen in the dock *and* repeat some on the desk. Harmless — the sheet fills
   the first slot per app id — but `launchers` is then not a count of apps, and
   a reader of the table should know that.

## Deploy-readiness — **still yes, with one caveat that is new**

Everything in HANDOFF-3 §7 holds: clean clone → `npm ci && npm run build &&
node dist/server.js` verified from a wiped tree this pass, all seven routes
answering (`/healthz` 200, `/api/engines` 9 engines with `cerebras-oss120`
default, `/`, `/bakeoff`, `/bakeoff/run?engine=…`, `/api/stats`, `/robots.txt`),
the money stop tested, generated documents in opaque-origin sandboxes with zero
network, 0 CSP refusals and 0 JS errors on the verification boot. The three
must-set variables are unchanged: `DEFAULT_ENGINE=cerebras-oss120`,
`TRUST_PROXY=1`, and a volume for `CAPS_STATE_FILE` + `NAMES_RING_FILE`.

The new caveat is the honest one: **a visitor whose boot generation returns no
document sees a black screen for 2.5 s and then a desktop.** It is not a crash,
nothing is broken, and the desktop that follows is the best-looking one this
product has made — but it is the first two and a half seconds of the product,
and it is the one thing to fix before anyone is invited to look.

One thing this pass changed that a deployment should know about: the HTTP/1.1
connection ceiling that starved `/api/gen` is a *client* limit, so it bites
hardest where the product is served over HTTP/1.1 — a local run, or any proxy
that does not speak HTTP/2. Railway's edge multiplexes, so production was the
least exposed place; the bake-off was the most.
