# BAKEOFF-3 (SPEC §7) — v0.2 verification

2026-09-17 evening. Integrator's pass over the three parallel v0.2 builds
(`reviews/PROMPTS-2.md`, `reviews/SERVER-v02.md`, `reviews/KERNEL-4.md`), then
the punch list of `reviews/HANDOFF-3.md` §6 and `reviews/BAKEOFF-2.md`
("Findings and fixes, ranked") measured again on real engines.

**Total spend this session: $0.64** (budget was $6). Breakdown:
identity sweep $0.029 · run A $0.147 · qwen sweeps $0.037 · wallpaper probe
$0.018 · run B (cerebras ×4 + haiku ×1) $0.324 · two image checks $0.075 ·
mock rehearsal $0.006.

## The runs, and which file holds which

| run | what | cost | report | shots |
|---|---|---|---|---|
| identity sweep | 20 heads-only boots on `cerebras-oss120` | $0.029 | below | — |
| **A** | `cerebras-oss120` ×4, the tree exactly as the three builders left it | $0.147 | `BAKEOFF-3-runA.md` | `shots-bakeoff/3-runA/` |
| qwen | `cerebras-qwen38` desktop sweep, 8 + 2 | $0.037 | below | — |
| wallpaper probe | the shipped S3 template, 3 rolls × 2 step counts | $0.018 | below | `/tmp` (quoted below) |
| **B** | `cerebras-oss120` ×4 + `anthropic-haiku` ×1, after this session's fixes | $0.324 | `BAKEOFF-3-runB.md` | `shots-bakeoff/3-runB/` |
| img 1 | 1 boot, `--apps=photos,maps,mail,store` | $0.028 | `BAKEOFF-3-imgcheck.md` | `shots-bakeoff/3-imgcheck/` |
| img 2 | 1 boot, browser + pages + photos/mail/store, after the image fix | $0.047 | `BAKEOFF-3-imgcheck2.md` | `shots-bakeoff/3-imgcheck2/` |

Raw telemetry per run is now kept: `shots-bakeoff/<run>/telemetry.jsonl`. Every
number below can be recomputed from it. Run A has none — that is why the image
finding needed a second run, and why the file exists from now on.

## State of the tree

One product, green: **247 unit tests** (24 files) and **67 e2e** on mock
(`npm test`, `npm run test:e2e`), `npm run build` clean. Seams S1–S4 line up
end to end: `DICE_KEYS` carries the three new dice, the server loads
`prompts/images/{wallpaper,icons}.md`, the kernel asks for boot images with
`{kind, session, seed}` and nothing else, per-engine `timeout_ms` is read. Two
e2e tests and three fixes were added by this pass (below). Nothing committed.

---

## Punch list: before → after

| # | item (source) | BAKEOFF-2 / HANDOFF-3 | run A | run B | verdict |
|---|---|---|---|---|---|
| 1 | launchers off screen (§12.3) | 5, 1, 16 across ten desktops; 1×16 lines | 8 clipped on 1 of 4 (a two-row dock) | **0 of 4** | **fixed** (prompt sharpened this pass) |
| 1b | launcher layout | 2 of 4 a single line | 4 of 4 a grid | 4 of 4 a grid | **fixed** |
| 2 | identity parse failure | 25% UNNAMED (1 boot in 4) | 0 of 4 | 0 of 4 | **fixed** — 20/20 named in the sweep, 0 fallbacks |
| 2b | naming register repeats | 7 of 9 "two nouns welded" | — | — | **fixed** — 2 of 20 in the sweep |
| 3 | `store` least reliable | 3/16 opens threw JS errors; haiku truncated mid-card | 4/4 rendered a catalogue | 4/4 rendered, 1 js error | **fixed enough**; see "store" below |
| 3b | store sells the prompt's example | 10 of 10 sold "Dowsing Kit" | 0 of 4 | 0 of 4 | **fixed** |
| 4 | `/search?q=` renders the home page | 2 of 8 | 0 of 4 (all results) | 0 of 4 | **fixed** |
| 4b | first result is a real destination | — | 3 of 4 (one linked back to google.com) | 4 of 4 invented domains | **fixed** |
| 5 | boot document hits its 800-token cap | 3 of 4 | 3 of 4 | 3 of 5 | **unchanged, harmless** |
| 6 | wikipedia recites the real Moon | every engine | every boot | every boot | **not fixed** (nobody changed it; see below) |
| 7 | a failed boot still buys its images | $0.024 wasted | no waste seen | no waste seen | **fixed** (server's `no-desktop` gate) |
| 8 | shots not run-numbered | overwritten in place | numbered | numbered | **fixed** |
| 9 | `mercury-2.5` unjudged | 403 from this network | not attempted | not attempted | still unjudged |
| 10 | measured vs advertised throughput | 343–1,467 tok/s | 959 median | 806 median | as before: plan on ~1,000 |
| 11 | engine `<select>` over the boot line | cosmetic | unchanged | unchanged | open, `/bakeoff/run` only |
| — | generic launcher labels | not measured | **2 of 4 boots used the app's plain name** | 0 of 4 | **fixed** (prompt sharpened this pass) |
| — | app pictures never arrive | not measured | 13 of 24 image calls failed | 1 of 16 app photos arrived → **2 of 4 after the fix** | **partly fixed**, see below |
| — | clock "does not tick" | — | reported dead on 2 of 4 | 0 of 5 | **instrument bug, fixed** |
| — | wallpaper "none" | — | reported missing on 4 of 4 | correct | **instrument bug, fixed** |

### §12.1 targets, run B vs BAKEOFF-2

| engine | boot paint (<1 s) | desktop interactive (<4 s) | app (<2.5 s) | page (<2.5 s) | $/session |
|---|---|---|---|---|---|
| `cerebras-oss120` BAKEOFF-2 | 1.06 s | 2.33 s | 1.62 s | 1.73 s | $0.031 |
| `cerebras-oss120` run A | 0.85 s **PASS** | 3.05 s PASS | 1.62 s PASS | 1.74 s PASS | $0.037 |
| `cerebras-oss120` run B | 1.10 s MISS | 5.20 s MISS | 2.83 s MISS | 2.14 s PASS | $0.033 |
| `anthropic-haiku` BAKEOFF-2 | 5.03 s | 19.9 s | 12.9 s | 15.8 s | $0.243 |
| `anthropic-haiku` run B | — | 29.7 s MISS | 13.3 s MISS | 15.9 s MISS | $0.193 |

Run B's cerebras numbers are worse than run A's and the difference is **not** a
code change: run B's provider TTFB median was 2,474 ms against run A's 693 ms,
and two of its sixteen app opens hung for 60 s (see open issue 1). Same prompts,
same kernel, three hours apart. The honest reading of both runs together is
**boot paint ~0.9–1.1 s, desktop interactive 2.5–5.2 s, and a provider whose
first byte moves by a factor of three between afternoons** — plan capacity on
the bad afternoon.

`anthropic-haiku` with its new 60 s `timeout_ms` (S4) **boots**: 1 of 1 here
against 2 of 4 at the old 25 s ceiling, contract ok, 0 broken renders, and it
is still the best-looking OS in the set and still 30 s to a desktop. It is a
reference engine, not a product engine.

---

## (a) Identity — the target was 0 UNNAMED and it is 0

`node scripts/identity-sweep.mjs --engines=cerebras-oss120 --n=20` → **named
20/20, fallback 0, UNNAMED 0**, $0.029. (SERVER-v02 reported 40/40 over two
runs; this is a third, independent 20.)

The names, in order — the register die is doing what BAKEOFF-2 asked for:

> pine-sky · cog7 · CENOTE · IDW · Caliper · Silas · VOLTAR · Alum · IDS7 ·
> Æther · Brookton · sprocket · Ravenscroft · Cedar · GlassGarden · Zelvi ·
> Procurement · Maple · IDS-18 · StringCurtain

Two of twenty are the old "two nouns welded together" shape (GlassGarden,
StringCurtain) against seven of nine in BAKEOFF-2. Model numbers, acronyms,
single words, a person's name and a plain noun all appear. All twenty heads are
kept as `reviews/identity-heads-2.json`, so `test/identity-heads.test.ts`
replays this sample through the gate for free, forever (that is the +3 unit
tests over SERVER-v02's 244).

## (b) The bake-off — what is on screen

I looked at fourteen shots myself, chosen by what the tables flagged: every
cerebras desktop of both runs plus the end-of-boot frame of three of them,
`anthropic-haiku`'s desktop and its store, a results page, a subreddit, and
the photos app of the image check. Each is named with its path below. I did
not open all 108: the rest are per-step app and page frames whose chars,
flags and times are in the run files, and both shot folders are intact.

**Desktops.** Every desktop in both runs is a grid of labelled icons with a bar
on an edge, a clock and a date, and no clipping in run B. Two desktops are
genuinely good: run B boot 4 (`Ashford`, dock archetype) put **eight launchers
in a single-row dock and the other eight top-right** — exactly §12.3's split,
which no boot had managed before — and `anthropic-haiku`'s `Linen Fold` is a
4×4 grid over a blue-grey condensation wallpaper with sixteen distinct icons and
a `17:17 | SEP 17, 2026` taskbar. That shot is the reference:
`shots-bakeoff/3-runB/anthropic-haiku/1/desktop.png`.

**Labels.** The label fix landed and it is the single biggest change to how the
product reads. Run A boots 3 and 4 shipped `Web · Photos · Trash · Calc · Store
· Mail · Msgs · Term · Tasks · Maps · Weather · News · Notes · Games · Update ·
About` — the app ids with a haircut, on a desktop with no personality anywhere.
Run B boot 2 (a customs shed) shipped `Webspool · Snapvault · Rubbishhold ·
Numcalc · Shopforge · Postbox · Chatter · Shelipad · Taskwatch · Cartomap ·
Skywatch · Newstide · Logbook · Playforge · Revamp · Infohub`. Nothing else
about the desktop changed.

**Windows render behind the desktop icons.** On `anthropic-haiku`'s boot and on
run B's cerebras boot 1 the launcher grid paints *over* the open windows
(`shots-bakeoff/3-runB/anthropic-haiku/1/app-store.png`: the store's window has
sixteen desktop icons sitting on top of it; same in
`.../cerebras-oss120/1/url-4-reddit.png`). The model gives its launcher area a
stacking order above `[data-os-windows]` and nothing in the contract forbids it.
This is the worst-looking defect in the run and no number the harness collects
can see it: it wants one sentence in the desktop prompt (the windows layer is
above the desk, always), a kernel guard (that layer's `z-index` is the kernel's,
not the model's), and a test.

**Still ugly: launchers that collide.** Run B boot 2 packed sixteen desktop
icons into the top-right corner with their labels overlapping each other and
the menu bar's clock (`shots-bakeoff/3-runB/cerebras-oss120/2/desktop.png`).
Nothing is off screen, so `data-os-launchers-offscreen` reads 0 and the harness
calls it a pass. "None off screen" is now satisfied and "none on top of another"
is the next sentence the desktop prompt needs. Two of nine desktops across both
runs have it.

**Store.** 8 of 8 opens rendered a catalogue the machine invented itself —
`ChronoForge`, `Gravitas`, `PixelPlant`, `EchoChat`, `QuasarCalc`, `GlintGear`,
`DeepEcho`, `Rusty Gopher`, `AbandonedMine` (v0.1, 0 MB, ★1.0, one review),
`HyperDeck`, `Rig Weather`, `Spare Parts`, `Ink Manager`, `Brew Calc` ("predicts
perfect coffee ratios even when the water is salty"). Not one Dowsing Kit. The
prices, the review counts and the one furious review are the funniest writing in
the product. Two complaints: the last card is often clipped by the 2,500-token
cap mid-listing — `anthropic-haiku`'s store never got past its *first* listing
("MedKit Tracker — Real-time instrument set reconc") — and every listing's
icon square is an unfilled picture slot
(see the images finding) — the store is where the grey squares hurt most.

**The fake internet** is still the best part. `/search?q=` is a results page on
8 of 8 with invented domains and plausible snippets; `reddit.com/r/cats` arrives
with in-universe subreddit rules; first results land on invented menus. **The
one dull page is still Wikipedia** — the real Moon, accurately, on every boot of
both runs, and still the longest page any engine writes (2,084–2,770 chars).
Nobody touched it this cycle. It is one sentence in `prompts/system/page.md`
(this reality's own moon) or one URL change in the demo script.

**Pictures.** The boot's two pictures are good when they arrive: the wallpapers
in run B read as wallpapers (a golden concentric swirl, a tan gradient, blue-grey
condensation) and the icon sheets are legible at 48 px and take the palette. When
they arrive late the visitor watches an unfinished desktop for 3–8 s, and when
they do not arrive the desktop is flat rectangles. In run B the boot pictures
were 6 of 8; app pictures were 1 of 16.

## (c) `cerebras-qwen38` — out, and the reason is measured, not a guess

`npm run sweep --engines=cerebras-qwen38 --n=8` → **1 of 8 contract passes**
($0.029). The gate for two full boots was ≥ 7 of 8, so no boots were bought.

The miss list is a truncation cascade — each failing desktop is missing
everything from some point in the document to the end, including
`[data-os-desktop]` itself on the worst two. A 2-document dump ($0.007)
confirmed it outright: `tokens_out: 3500` on both, `truncated: true` on both,
i.e. it spends the whole §12.1 budget and gets cut. It writes an enormous
`<style>` block before any markup, so what the cap eats is the contract.

SPEC §12.8's condition ("out unless its verbosity is tamed by the budget cut")
is settled: the budget cut did not tame it. Do not spend on qwen again without a
prompt that forces markup before style.

## (d) `anthropic-haiku` reference shots

`shots-bakeoff/3-runB/anthropic-haiku/1/` — `Linen Fold 3.2.1 SP2`, "Hospital
Laundry Management System", 2010s hospital laundry. Desktop, four apps, six
pages. 0 contract misses, 0 broken renders, 0 JS errors, $0.193 the session,
29.7 s to a desktop. The 60 s `timeout_ms` is what let it finish.

---

## Findings and fixes, ranked

### 1. Two instruments were lying, and both lies flattered the wrong thing

Run A's report says **wallpaper: none on 4 of 4** and **clock: does not tick on
2 of 4**. Both are false, and the screenshots prove it — the wallpapers are in
`desktop-after.png` and the "dead" clocks show the time in the very next frame.

- **Wallpaper**: KERNEL-4 moved the picture onto a kernel-owned child layer
  (`[data-os-img-layer="wallpaper"]`) because a `background-image` cannot fade
  in. `scripts/run.mjs`'s `inspectDesktop` still read the host element's own
  `backgroundImage`. Seam drift between the kernel and the harness, invisible
  because the failure mode was a plausible number. Fixed: it now reads the layer
  and says where the layer is parented (`slot` / `desktop-fallback` / `body`).
- **Clock**: `clockTickQuick` treated an empty face seconds after mount as a
  dead clock and returned a final "no", so the late read never ran. A clock
  whose script has not run yet is undecided, not dead. Fixed, plus
  `clockTickLate`, which will only call a minute-resolution clock dead if a
  minute actually elapsed between the two reads, and the report now prints the
  two faces it compared.

Every table in run B was produced by the corrected instruments. **A measurement
change is a prompt change's equal in this project**: three of run A's nine
"failures" were the harness.

### 2. App pictures were being cancelled by the kernel, not by fal

Run A: 13 of 24 image calls failed, all logged `img timeout`. Run B, with the
new per-kind breakdown: **`photo` 16 calls, 1 delivered, 15 "img timeout"** —
while the boot's own wallpaper and icon sheet came back in a median 4.5 s and
8.4 s. The tell was the total_ms on the failing lines: 500–1,400 ms, nothing
like a ceiling. `server/img.ts` threw the same `ImgError('timeout')` for its own
clock and for the caller hanging up.

Three fixes, in the order they matter:

1. **An app's pictures now have their own lifetime** (`kernel/windows.ts`,
   `kernel/index.ts`). They rode `w.gen`, the window's *generation* controller,
   which every later generation into that window aborts — and the browser
   navigates to its home page in the same window a moment after its chrome
   finishes, then again on every URL. The app document that asked is still on
   screen, so its picture is still wanted. Page pictures still ride `w.gen`
   (navigating away really does end them); app pictures now ride `w.imgs`, which
   dies with the window.
2. **Two at a time, not four** (`kernel/img.ts`). A document may ask for four
   pictures and the runtime asked for all four at once, so all four queued at
   fal and aged together. Two waves of two, each inside the ceiling. The boot's
   own pictures bypass the lane — a desktop must never wait behind a store's
   product shots.
3. **`IMG_TIMEOUT_MS` 10 s → 18 s** (`server/env.ts`), and the telemetry now
   says which clock ran out (`img timeout (clock)` vs `img timeout (client)`)
   and which document was asking. IMG-LATENCY-1's "< 2.5 s" was one afternoon:
   six wallpaper calls through the shipped code this evening took **2.9–14.1 s**,
   and run B's boot pictures were killed by the 10 s ceiling once each.

Measured after the fix (`BAKEOFF-3-imgcheck2`): app photos **2 of 4 delivered**
in 3.4 s and 3.9 s, up from 1 of 16; the two that still failed were cancelled
by the client at the same instant, near the end of the boot. Page photos: 0 of 4
— every one cancelled by a navigation 2 s later, which is correct behaviour and
also means **the bake-off's URL cadence can never show a page picture**. Left
open, both of them, in the open issues.

The same measurement gap applies to app shots: the harness photographs an app
the moment its document goes quiet, and a picture takes 3–4 s, so **no app
screenshot in this report can contain a picture** even when one arrived. The
end-of-boot `desktop-after.png` is the only frame that shows them.

### 3. The wallpaper prompt is fine; the palette decides everything

Run A's wallpapers read as photographs of texture (white birch, grey speckle,
striated wood) and I suspected the S3 template or the 2-step latency setting. Six
images through the **shipped** template ($0.018, 3 rolls × 2/4 steps) say
otherwise: an amber "overlapping translucent rectangles" and a sea-green
"marbled wash" came back as proper, subject-free, palette-led wallpapers at
**both** step counts. Steps are not the variable and the wording is not the bug.
What run A's boots had in common was a grey-steel palette in the identity —
which is exactly what the prompt then draws. No change made. If Shahmir wants
colour on every boot, the lever is `palette_words` in the identity prompt, not
the image template.

Latency at 2 and 4 steps was indistinguishable (2.9–14.1 s either way), so the
2-step setting buys nothing and costs detail. Worth reverting to 4 next time
someone is in `server/img.ts` — not changed here, because it needs its own
measurement rather than my one probe.

### 4. Harness improvements made this pass (all in `scripts/`)

- `telemetry.jsonl` per run, next to the shots. Run A's image finding could not
  be diagnosed without re-running the harness; that cannot happen again.
- Per-kind image table in every report: n, delivered, median ms, and the reason
  each failure gave, counted.
- The clock and wallpaper fixes above, plus the clock's two faces printed so the
  verdict is auditable.
- `--report=<basename>` (already there) is now used for rehearsals and checks so
  a judged run's number is never burned: this run's companions are
  `BAKEOFF-3-runA/-runB/-imgcheck/-imgcheck2` and a $0.006 mock rehearsal.

### 5. Prompt changes made this pass (`prompts/system/desktop.md`, three lines)

Positive form, no examples, no design instructions — the standing rules.

- the dock holds at most eight launchers **in a single row**, and a second row
  on the bottom edge puts its own icons below the screen;
- a label that is the plain word the shape is described with belongs to no
  machine in particular;
- two more checklist lines for the same two rules.

Both were measured: 8 clipped → 0, and 2 of 4 generic-label desktops → 0.

---

## Open issues, ranked

1. **An app window that never paints.** Run B boot 4: `browser` and
   `calculator` both sat blank and unstyled for the full 60 s step ceiling, and
   **neither generation left a telemetry line at all** — no timeout, no abort,
   nothing, while the same boot's `store` replayed in 410 ms. A generation that
   the server never books and the kernel never retries is the worst failure mode
   in the product (§12.2 says a document is never replaced; it says nothing
   about one that never arrives). Suspicion, unproven: a speculative handle that
   was claimed and then dropped, whose `AbortError` is swallowed by
   `handleGenError` as "a superseded generation is not a failure". 2 of 16 app
   opens in run B, 0 of 16 in run A.
2. **Windows paint behind the desktop icons** (2 of 9 desktops, including the
   best-looking one). Prompt sentence plus a kernel guard on the windows
   layer's stacking order, and a test; see the taste section.
3. **Launcher labels and icons overlapping each other** (2 of 9 desktops). The
   off-screen rule is satisfied and the collision rule does not exist yet.
   Prompt work, one sentence, and the harness should measure it (pairwise
   overlap of launcher boxes) or it will not stay fixed.
4. **Page pictures are unreachable in practice.** Correct cancellation, real
   consequence: a page that reserves a picture shows a large grey block until it
   lands (visible in run B's search results), and any navigation inside ~4 s
   kills it. Options: no page pictures below a dwell time, or a placeholder that
   does not look like a hole. Needs a ruling, not a fix.
5. **Two app pictures of four still die**, cancelled by the client near the end
   of a boot, cause not yet identified (`w.imgs` only aborts on window close).
   Next session: log the abort at the kernel end with the window id and what
   triggered it.
6. **Wikipedia recites the real Moon** — untouched since BAKEOFF-2, one sentence
   or one demo-URL change.
7. **The store's last card is clipped** by the 2,500-token cap on most opens.
8. **`data-os-icon` slots still outnumber the sheet's cells** (16/20, 16/17,
   16/24 across boots): the model declares icon slots in menus as well as
   launchers, and the surplus stay empty for good. The prompt already forbids
   it; the harness could refuse to count it.
9. **`mercury-2.5` is still unjudged** (403 from this network).
10. **A 2-step wallpaper buys no latency** (finding 3) — revert to 4 with a
   measurement.
11. **`/bakeoff/run`'s engine `<select>` still covers the boot document's first
    line** (cosmetic, judging only).

## Verdict

`cerebras-oss120` remains the product engine: 0 contract misses in 37
generations across the two runs, ~$0.033 a session, a desktop in 2.5–5.2 s
depending on the afternoon. `anthropic-haiku` is the reference engine at 6×
the price and 6× the wait, and it writes the best-looking machine in the set.
`cerebras-qwen38` is out on measured truncation. Nothing in `engines.json` needs
trying next except `mercury-2.5`, and only if the 403 clears.

Product-wise, the v0.2 punch list is closed except Wikipedia: identity is
reliable, launchers are grids that fit on the screen, labels are in character,
the store invents its own catalogue, search returns results. What is not closed
is **pictures inside documents** — the one thing a visitor sees as an unfinished
product — and one app in eight that never paints.
