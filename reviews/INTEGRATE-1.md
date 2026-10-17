# INTEGRATE-1 — the three halves made into one product (2026-09-17)

Server, kernel and prompts were built against the pinned interfaces I1–I8 by
three separate sessions. This one ran them together, on mock and then on real
engines through `/bakeoff/run`, watched every step in a real browser, and fixed
the seams. **Spend: ~$0.15** (day counter `data/caps-state.json` at $3.63 of the
$25 ceiling, most of it the earlier bake-off).

Suites: **175 vitest + 47 playwright green on mock**, `npx tsc --noEmit` clean,
`npm run build` clean.

New instrument: **`scripts/integrate.mjs`** (`node scripts/integrate.mjs
--engines=cerebras-oss120 --budget=2`). One boot per engine through
`/bakeoff/run`, four apps, five page loads, and the checks no single builder
could make from their own side of the wire: the identity comment actually named
the machine, the wallpaper and the icon cells actually reached the DOM as
`data:` URIs, the archetype attribute matches the identity, the clock really
ticks, the boot's own first paint landed on its telemetry line, and how many
image calls the boot bought. Raw results in `reviews/integrate-1/*.json`,
screenshots (last boot per engine) in `reviews/shots-v01/<engine>/`.

---

## 1. §12.1 targets, measured on cerebras-oss120

Four real boots, in the order they were run. Boot 1 is before this session's
fixes; boots 2–4 are after.

| boot | boot-screen paint | desktop interactive | desktop revealed | contract | imgs |
|---|---|---|---|---|---|
| 1 | 1,421 ms | 6,080 ms | 6,382 ms | ok | 2 |
| 2 | 1,281 ms | 2,548 ms | 3,873 ms | ok | 2 |
| 3 | 1,513 ms | 2,897 ms | 4,369 ms | ok | 2 |
| 4 | 1,137 ms | 2,195 ms | 3,831 ms | ok | 2 |

| step | §12.1 target | cerebras-oss120 (boots 2–4) | verdict |
|---|---|---|---|
| boot screen paint | < 1.0 s | 1.14 / 1.28 / 1.51 s (median 1.28) | **MISS by ~0.3 s** |
| desktop interactive | < 4.0 s | 2.20 / 2.55 / 2.90 s (median 2.55) | **PASS** |
| app window content | < 2.5 s | 1.61–2.83 s (median 1.63) | **PASS** (one 2.83 s outlier: `notes`) |
| page | < 2.5 s | 0.41 s (speculative home), 1.73–2.84 s | **PASS** (one 2.84 s miss: first search) |

Where the boot-paint miss comes from, off the server's own telemetry: the boot
generation's `provider_ttfb_ms` is **981–1,386 ms** on Cerebras. The kernel adds
~90 ms (PERF-KERNEL-1 measured 91 ms on mock). **The target is unreachable while
the provider's first token takes a second**; nothing in our code is the
bottleneck. Two honest options: accept ~1.3 s, or have the kernel paint its own
first frame (a black screen with the machine's name from the identity comment,
which arrives in the same first chunk) while the model's boot document streams
behind it. That is a design decision for Shahmir, not a bug.

`desktop interactive` moved from 6.08 s to ~2.5 s between boot 1 and the rest
purely on provider throughput (desktop generation 292 tok/s on boot 1 vs
891–1,212 tok/s after). Cerebras' advertised 2,000–3,000 tok/s is not what we
measure: **469–686 tok/s on boot, 891–1,212 on desktop, 1,200–1,570 on pages.**
The desktop is mounted from the complete document, so its interactive time is
"whole desktop streamed" — the single biggest remaining lever on §12.1 is
mounting the desktop progressively, which is a v2 architecture change, not a
patch.

### Second engine

- **mercury-2.5 does not boot.** Every call to `api.inceptionlabs.ai` answers
  **HTTP 403 from CloudFront**, including a bare `GET /v1/models` with the key
  in `.env` — provider-side, not ours (key revoked, or the WAF is blocking this
  network). The kernel degrades correctly: boot stream fails → one `kind=identity`
  fallback → also 403 → the kernel's own error screen with a retry, engine
  picker still there (`reviews/shots-v01/mercury-2.5/02-desktop.png`). $0.0002.
- **or-oss20-groq** (the substitute witness): boot paint 2,062 ms, desktop
  interactive 5,068 ms, apps 2.0–4.0 s, pages 2.9–3.7 s, contract ok, 2 images.
  Slower than Cerebras on every axis and it hit one Groq upstream **429**
  mid-flow, which the kernel regenerated through (I1). $0.017 for the run.

### Cost per boot

| what | measured |
|---|---|
| 11 generations (boot, desktop, 4 apps, 5 pages) | $0.0242 |
| 2 images (wallpaper + 4×4 icon sheet) | $0.0060 — **exactly 2 × $0.003, §12.5** |
| **a full session like this one** | **~$0.030 on cerebras-oss120** |

Image calls per boot: **2, never more** (§12.5 ceiling is 4). Telemetry carries
`{"kind":"img","usd":0.003,"img_kind":"wallpaper"|"icons","bytes":…}` per call.
**fal schnell takes 3.7–7.9 s, not the ~0.8 s §12.5 assumed** (`provider_ttfb_ms`
3,705 on a direct probe; first cell filled 1.5–4.5 s after the desktop was up).
Nothing waits for it — the pictures arrive on a desktop the user is already
using, which is what I3 designed for, but it means **the first seconds of every
boot are the model's SVG, not the photograph.**

---

## 2. Seams found and fixed

Every one of these was invisible from inside a single builder's half.

1. **The clock was never validated server-side.** `validateDesktop()` checked
   `[data-os-clock]` only *inside* `if (archetype)`, and the server validates
   with no identity in hand (a documented deviation) — so a desktop with no
   clock in it at all was logged `contract_ok: true`, and I5's "clock must
   exist" was enforced nowhere except in the kernel's own DOM pass. The clock
   needs no identity to evaluate: it is now checked on both sides, and only the
   archetype *value* stays conditional. `kernel/contract.ts`, mirrored in
   `kernel/inject.ts domMissing()`. Two new unit tests.
2. **`[data-os-archetype]` on `<html>` was silently lost.** I1/I5 allow the
   attribute on `<html>` or `<body>`, and the text validator accepts both, but
   `mountDesktop()` copied only `<body>`'s attributes into the top document —
   so a model that used `<html>` had its archetype "patched" over the top of
   the one it sent, and the two validators disagreed by construction. The mount
   now carries `<html>`'s own `data-*`/`class`/`style` across (and restores them
   on unmount), refusing only the kernel's own state flags.
3. **The boot document's first paint was thrown away.** The kernel marks first
   paint the moment the boot screen paints — which on a real engine is *before*
   the boot stream ends — and `Telemetry.mark()` could only patch a line that
   already existed, so it logged `matched: false` and dropped the number.
   §12.1's headline metric was the one metric telemetry could not keep. Marks
   that arrive early are now held and folded in when the line is recorded
   (`server/telemetry.ts`); proven on the real engine — boot line now carries
   `"first_paint_ms":1044`. Two new unit tests.
4. **A bare hostname was resolved as a path.** `os.navigate('reddit.com/r/cats')`
   from inside a generated page went through the injected runtime's `resolve()`,
   which resolved it against the page it was written on: the fake internet was
   asked for `https://www.italianharmony.com/menu/reddit.com/r/cats`, and the
   address bar and telemetry showed that nonsense URL (boot 1,
   `reviews/integrate-1/integ-cerebras.json`). A hostname is now a new site, a
   real relative reference still resolves relatively, and a first segment ending
   in a file extension stays a path. New e2e test.
5. **The icon sheet was sliced into its neighbours.** flux draws "a 4 by 4 grid"
   with gutters and stray rules, so slicing at exact quarters put pieces of the
   surrounding icons inside every launcher (see boot 1's shots). Each cell is now
   inset 7% on every side (`SHEET_INSET`, zoom 465.12%, positions
   2.23/34.08/65.92/97.77%), and the sheet prompt asks for cells touching edge to
   edge with no gutters, borders or grid lines. Boot 4's icons are single clean
   glyphs.
6. **Launcher labels went dark-on-dark the moment the wallpaper landed.** The
   model styles its labels for a background it has never seen; the wallpaper is
   the kernel's own injection. The kernel now adds one text-shadow rule scoped to
   `[data-os-desktop] [data-os-app]` when a wallpaper is applied — no colours, no
   layout, nothing the model chose is overridden.
7. **The mock engine was not a faithful §12 stand-in.** Its desktop fixture had
   no clock, no archetype attribute, no wallpaper slot and only bare
   `[data-os-icon]`, so the per-app icon path, the wallpaper slot path and the
   archetype match were exercised on mock **nowhere** — every mock boot went down
   the kernel's patch path instead. The fixture now ships all four; the
   contract-break servers (`MOCK_BREAK=desktop-always|desktop-once`) drop them, so
   the patch path keeps its tests.
8. **A dead engine cost 120 s of silence.** `bootOnce()` in the shared harness
   waited only for `html[data-os-ready]`, so mercury's 403 produced a Playwright
   timeout and no information. It now races the kernel's own error/queue screen
   and reports `failed` plus what the screen said — worth five boots × two
   minutes on the next bake-off with a dead key.

## 3. Measured, not repaired

**`data-os-launchers-offscreen`** on `<html>` after mount: how many launchers the
model put outside the viewport. §12.3 wants every launcher reachable without
scrolling, and this is the recurring failure — **boot 4 put 5 of 16 off the
bottom edge** in a single tall column (`09-desktop-images.png`). The kernel does
not rearrange the model's desktop; it counts, logs (`launchers off screen: 5/16`)
and leaves it, so the prompt change has a number to move.
`prompts/system/desktop.md` now says in as many words that a single tall column
does not fit and the grid has to wrap.

## 4. Still open

- **Boot paint ~1.3 s vs the < 1.0 s ruling.** Provider TTFB, not our code. Needs
  either a faster engine or the kernel painting its own first frame.
- **mercury-2.5: HTTP 403 for every call, `/v1/models` included.** Needs a key or
  a network Inception's CloudFront will serve. SPEC §12.8's challenger cannot be
  judged until then.
- **Boot documents hit the 800-token cap** (`truncated: true` on 3 of 4
  cerebras boots, `tokens_out: 800` exactly). Harmless — the identity comment is
  first and the boot screen is transient — but either the cap or the boot prompt
  is wrong, and a truncated document is a document that can end mid-tag.
- **One broken app in four boots.** Boot 4's `store` rendered 59 characters and
  15 nodes with `Failed to execute 'write' on 'Document': Invalid or unexpected
  token` in the console; the same app generated directly on the same engine is a
  full 6 KB document with a working script. Most likely the model's own script
  failing to parse (§12.2 says that is the model's business), but the hazard
  worth naming is ours: a document that ends inside an unterminated `<script>` is
  force-executed as a partial script at `document.close()`.
- **fal at 4–8 s** means the icons pop in seconds after the desktop. If that reads
  as broken to Shahmir, the answer is starting the two image calls from the
  server the moment it has validated the identity comment, rather than from the
  kernel after the round trip.
- **The desktop is still mounted from the complete document** (so
  `interactive ≈ whole desktop streamed`) and still same-origin with the kernel
  (README Deviations). Both are v2 items.
