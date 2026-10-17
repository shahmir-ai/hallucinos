# AUDIT-FIXES-1 — the safety + kernel review applied (2026-09-17)

Fourteen findings from the safety and kernel lenses, applied in severity order.
Everything below was proved on the **mock engine** plus one real boot on
`cerebras-oss120`; the tree ends at **195 vitest + 51 playwright** green, and one real
`cerebras-oss120` boot.

Nothing was skipped. Two findings were implemented with a deliberate deviation
from the suggested fix, both flagged `PARTIAL` and argued below.

---

## 1. blocker — images and text shared one in-flight lane

`server/index.ts` / `server/caps.ts` / `server/env.ts`

`/api/img` called `caps.reserve(IMG_USD)`, which incremented the same
`inflight` counter as `/api/gen` against `MAX_CONCURRENT_GEN=12`. Each boot
fires two image calls and holds their slots for up to `IMG_TIMEOUT_MS`, so six
simultaneous visitors' wallpapers could serve everybody else the kernel's
over-capacity screen while nothing was generating.

- `Caps.reserve(usd, lane)` now takes a lane (`'gen' | 'img'`) with its own
  counter and its own ceiling, `MAX_CONCURRENT_IMG` (default **6**). Both lanes
  still hold against the one `MAX_USD_PER_DAY`.
- `IMG_TIMEOUT_MS` default **20000 → 10000** — see the correction below; 5000
  was tried and broke the wallpaper.
- `caps.inFlightImg()` added beside `inFlight()`.

Proof: `test/lanes.test.ts` — a fal endpoint that never answers, every image
slot held, `/api/gen` still 200 with a telemetry sentinel; the third image is
the one refused (`reason: "busy"`), the two stalled ones give up on the timeout,
and `day_usd` stays 0 because nothing was rendered. Plus `test/caps.test.ts`
("in-flight lanes") for the unit behaviour in both directions.

### Correction — `IMG_TIMEOUT_MS` is 10 s, not 5 s (PARTIAL)

The finding asked for ~5 s, on the grounds that "schnell answers in ~0.8 s".
It does not. Measured against the real endpoint (`$0.006`, two calls):

| kind | schnell (`provider_ttfb_ms`) | our download | total | bytes |
|---|---|---|---|---|
| wallpaper 1024×576 | 2,536 ms | ~4.0 s | **6,571 ms** | 496 KB |
| icons 1024×1024 | 2,637 ms | ~2.2 s | **4,852 ms** | 931 KB |

The 0.8 s figure is schnell's inference time; it ignores the half-megabyte the
server fetches itself to keep the CSP at `img-src data:`. With the ceiling at
5 s a real `cerebras-oss120` boot came back with
`wallpaper: false, iconsFilled: 0` — the images were bought and thrown away —
and because finding 14 now books a failure that happens after fal's 2xx, the
`$0.006` in the report was **identical to a successful boot**. Two real boots
were spent discovering that.

Two things follow:

1. 10 s, not 5 s. The lane separation is what protects `/api/gen`; the timeout
   only stops one call from holding an image slot for ever.
2. **`usd` alone no longer proves an image arrived.** Read `bytes` and `error`
   on the `kind:"img"` line. Worth a future cut: 931 KB for an icon sheet is
   most of that wall clock, and schnell will answer smaller.

## 2. high — the kernel ignored `<!--os-reroute-->`

`kernel/gen.ts` / `kernel/index.ts` / `server/index.ts`

`genStream` scanned for `os-error` and `os-telemetry` only. A late moderation
hit therefore left the flagged document mounted and `readyState: complete`, and
README claimed the opposite.

- `RerouteError` is a distinct class (not a `GenError`, so the error-retry path
  cannot handle it by accident) thrown from a new `REROUTE_RE` check.
- `streamDoc` discards the document — painted or not, because it was generated
  FROM the flagged string — and re-asks with `rerouted: true`.
  `generateDesktop` does the same for its own single-retry path.
- Server half: `POST /api/gen` accepts `rerouted: true` from the client and
  **OR**s it with its own verdict. The flag can only ever make a page more
  wholesome, and with `rerouted` already true the server skips the remote
  moderation call, so the retry cannot lose the same race again (it would
  otherwise loop forever).

Proof: `e2e/sentinels.spec.ts` — a new server on **8777** with remote
moderation pointed at `scripts/fake-mod.mjs` (**8778**), which flags one magic
URL 250 ms in, mid-document at 120 ms/chunk. The visitor ends up on the
`data-mock-shape="rerouted"` page, exactly two page generations were bought for
that URL, and the second carries `rerouted: true`.

## 3. high — a painted document was reset and re-streamed with no user event

`kernel/index.ts`

`streamDoc`'s catch called `sink.reset()` unconditionally — `document.open()` on
a document the visitor is looking at, which is the "loads, sits there, turns
into a different UI" §12.2 exists to forbid. Live trigger: `GEN_TIMEOUT_MS`
kills a generation and the server emits `os-error` after everything it had
already streamed.

- The sink grew a `painted()` probe (`frame.painted` for an app,
  `frame.pagePainted` for a page — the two flags §12.2 maintained and nothing
  read).
- `GenError` now carries `.partial` and `.genId`, so a kept document can still
  be reported and titled.
- On an error with a painted sink the kernel calls `sink.end()`, logs the
  truncation and returns what arrived. Only an unpainted sink is reset and
  re-asked. The speculative-failure branch has the same guard.

Proof: `e2e/sentinels.spec.ts` on a new server (**8779**, `MOCK_BREAK=app-error-once`):
the first app document dies 60 % of the way through, and afterwards
`__osStats.opens === 1`, `[data-mock="app"]` is still in the frame, and exactly
one app generation was ever asked for.

## 4. high — cap and concurrency refusals wrote no telemetry at all

`server/index.ts` / `server/telemetry.ts`

All three 429 paths in `/api/gen` and the `caps.take` 429 in `/api/img` returned
before `telemetry.record()`. That is the blindness that voided BAKEOFF-1.

- `refusalLog()` / `freeLog()` emit one line per refusal with
  `{blocked: 'ip-hour'|'day'|'usd'|'busy'|'mark-rate'|'name-rate', engine: '-', usd: 0}`.
- `Telemetry` counts refusals by reason and `/api/stats` gained `refused` and
  `refusals`. A refusal that spent nothing stays out of the per-engine
  aggregates so a day of 429s cannot read as a productive one; a refusal that
  *had* already been paid for (the image whose late moderation hit after fal
  rendered and billed) still aggregates.

Proof: `test/refusals.test.ts` (three 200s, three 429s, three `blocked` lines on
stdout, `stats.gens === 3`, `stats.refusals['ip-hour'] === 3`) and two cases in
`test/telemetry.test.ts`.

## 5. high — `/api/identity-seen` was unauthenticated global prompt state

`server/index.ts` / `kernel/gen.ts` / `kernel/index.ts`

The route only checked the UA, and whatever it accepted is spliced into every
later boot prompt as `{{never_names}}`. 220 writes replaced the whole ring in
seconds (+58 % input tokens on every other visitor's boot) and
`"child porn machine"` was accepted with `200 {"ok":true}`.

Three gates, all of them:

- the body must carry a `gen_id` **this process issued for a `boot` or
  `identity` generation** (new bounded `issuedGenIds` registry, 4,000 entries,
  oldest dropped first). The ticket is **spent on use**: one name per
  generation.
- the name goes through `moderateLocalSync` before `namesRing.add`.
- a per-IP hourly bucket of its own (`NAME_PER_IP_PER_HOUR`, default 60) — the
  route buys no tokens, so it must not eat the generation cap, but it is not
  free to flood either. New `RateBucket` in `server/caps.ts`.

Every refusal is silent (`{ok:false}`): a distinguishable one is an oracle for
which ids exist. Kernel side: `identitySeen(name, genId)` now sends the boot's
gen id, and `genIdentity()` returns the server's id for the fallback path.

Proof: five cases in `test/routes.test.ts` (no ticket, invented ticket, spent
ticket, a ticket from an app generation, a flagged name).

### Correction — spending the name ticket cost every boot its mark ticket

First version deleted the id from `issuedGenIds` to enforce one-name-per-
generation. But the same registry is `/api/mark`'s ticket, and the identity
comment arrives ~100 ms **before** the boot document paints — so the name spent
the ticket and the boot's first-paint mark was then refused. A real boot showed
`boot.first_paint_ms: null` and no `g1` mark anywhere; the mock never showed it,
because on the mock the two events land in the other order.

The entry now carries `nameUsed` instead of being deleted. Regression test:
`test/routes.test.ts` → "spending the name does not cost the boot its mark
ticket".

## 6. medium — page first paint was only ever measured on the speculative replay

`kernel/index.ts`

`navigate()` set `frame.onPagePaint` with a `genId` that was `''` unless a
speculative handle had been claimed, and `mark()` returns early on an empty id.
So no `first_paint_ms` existed for a typed address, a clicked link, a
back/forward or a reload — BAKEOFF-2's "page first paint" column (27/36/25 ms)
was one pre-buffered replay per boot, replayed in a single write.

Both `streamApp` and `navigate` now mint the id **before** the request
(`newGenId()`) and send it as `gen_id`, the way boot already did; the server
adopts a sane client id. The `let genId` reassignment is gone.

Visible in the run logs of `e2e/sentinels.spec.ts`: app and page lines now carry
`first_paint_ms` and `interactive_ms` on the non-speculative path.

## 7. medium — injected fallback hooks leaked across a reboot

`kernel/inject.ts` / `kernel/img.ts` / `kernel/index.ts`

`injectMissing` appended bare fallbacks straight to `document.body` after the
mount, so they were not in the `Mounted` record and `unmount()` left them
behind. After `os.reboot()`, `readHost()` picked the dead machine's injected
taskbar and boot 2's task entries went into it — and `domMissing()` then saw
`[data-os-taskbar]` present and recorded **no taskbar miss at all** for boot 2,
which is the number SPEC §10.3 and the bake-off gate on.

- a module-owned `injectedNodes` record, `removeInjected()`, called from
  `unmount()` whether or not there is a mount record (they were never part of
  the mounted tree).
- same for the fallback clock's element and for `#os-img-legibility`
  (`resetImgStyles()`, called from the kernel's `teardown`).

Proof: `e2e/contract.spec.ts` — boot 1's injected bar is tagged, `os.reboot()`,
and afterwards there is exactly one taskbar, it is not the tagged one, boot 2
recorded its own `data-os-contract="miss"`, and the new machine's window entry
goes into the new machine's bar.

## 8. medium — image limits were keyed on a client-supplied session id

`server/img.ts` / `server/index.ts`

`session = clamp(body.session,64) || ipHash`, so one IP rotating `session` per
call got 44 images and $0.132 against a documented per-scope limit of 4 and a
session limit of 30.

`ImgBudget.take(session, kind, scopeId, sub)`: the **session ceiling is charged
to the ip hash**, and the client's string survives only as a sub-key of the
per-scope buckets — so two tabs on one machine still each get their own
four-per-app-open, and neither can mint budget.

Proof: two cases in `test/img.test.ts` ("the session ceiling cannot be rotated
away").

## 9. medium — PARTIAL — untaken speculative generations were billed to completion

`kernel/gen.ts`

`SPEC_TTL_MS` was 60 s while a real generation finishes in 1.5–5 s, so every
prefetch nobody clicked was complete and paid for long before anything aborted
it (16 mousedowns across the launcher grid bought 16 finished app documents).

- `gen.start()` now **drops the previous untaken prefetch of the same kind**.
  One pointer, one prefetch: scrubbing the grid leaves one live generation
  instead of sixteen. Kinds are kept apart deliberately — a launcher mousedown
  must not abort the browser's in-flight home page.
- `SPEC_TTL_MS` 60 s → **10 s**.

**Deviation from the suggested fix:** the finding asked for "a couple of
seconds". The browser's home page is started beside the browser chrome and is
only claimed after that chrome has finished streaming (~1.6–2.5 s on
`cerebras-oss120`, longer on anything slower). A 2 s TTL would therefore miss
its claim on essentially every browser open and buy a *second* page generation
instead of saving one — a cost increase, dressed as a saving. 10 s bounds the
worst case (one unclicked document, not sixteen) and the drop-on-next-mousedown
rule is what actually fixes the reported repro.

## 10. medium — an aborted stream was logged as a finished generation

`server/index.ts`

An engine whose iterator ends cleanly on the signal (the mock, and the real
ones) fell through to contract validation and `log()` with no error and no
`truncated` flag, so every dropped speculative app or desktop landed in the
bake-off's headline contract-miss rate — in either direction.

A `clientAborted` flag is set from the request signal and from the stream's
`cancel()`. On abort the line is `contract_ok: null, aborted: true` and no
verdict is computed. Visible in the sentinels run: the discarded reroute retry
logs `"aborted": true`.

## 11. low — `interactive_ms` meant three different things

`kernel/index.ts` / `server/telemetry.ts` / `server/index.ts`

For an app and a page it was posted after the whole stream ended, i.e. it was
total stream duration; for the desktop it was mounted-and-wired; for the boot
document it equalled first paint. All aggregated together.

§12.2 rules that interactivity attaches on the first chunk (the runtime wires
delegation inside `openDoc`), so for an app and a page `interactive_ms` is now
posted from the paint callback, and the end of the stream is a new
**`complete_ms`** field (accepted by `/api/mark`, held and folded in like the
others). Desktop and boot are unchanged — their meanings were already honest.

## 12. low — the fallback clock was parented before the fallback taskbar existed

`kernel/inject.ts`

`startFallbackClock()` prefers `[data-os-taskbar]`, but the clock patch ran
~20 lines before the taskbar was injected, so on a desktop missing both (that
is `MOCK_BREAK=desktop-always`) the clock landed on the desktop layer. The patch
now runs after the desktop/windows/taskbar/template block.

Proof: `e2e/contract.spec.ts` asserts `[data-os-taskbar] [data-os-clock]` and
that it ticks.

## 13. low — `/api/mark` was unauthenticated and uncapped

`server/index.ts` / `server/telemetry.ts`

300 unauthenticated posts added 300 log lines, and a post against a real
`gen_id` overwrote §12.1's first-paint and interactive numbers with zeros.

- the id must be one `issuedGenIds` holds; an unknown id is dropped **without
  being held**, because client gen_ids are accepted verbatim on `/api/gen` and
  an ungated hold is a way to pre-poison a future generation's numbers.
- **first writer wins** per field, on a recorded line and on a held early mark.
- only a mark that landed on a real line is logged; an early one is held
  silently and appears in that generation's own line when it records. (The
  `held: true` line INTEGRATE-1 introduced is therefore gone.)
- a per-IP hourly bucket, `MARK_PER_IP_PER_HOUR`, default 600 — a bake-off boot
  is 13 generations × up to 3 marks.

Proof: two cases in `test/routes.test.ts`, two in `test/telemetry.test.ts`.

## 14. low — an image fal rendered but we failed to keep was booked at $0

`server/img.ts` / `server/index.ts`

`ImgError` gained `billable`, set once fal has answered 2xx. `empty`,
`too-big`, a failed binary fetch and a timeout *during* the download are
billable; a non-2xx and a timeout before the response are free. The route
settles `IMG_USD` or `0` accordingly and the telemetry line carries the same
number.

Proof: two cases in `test/img.test.ts`.

---

## New test infrastructure

| what | where |
|---|---|
| a fake `omni-moderation` that flags one magic word late | `scripts/fake-mod.mjs` (port 8778) |
| a server whose remote moderation is that fake | `playwright.config.ts` 8777 |
| a server whose first app document dies half written | `playwright.config.ts` 8779 (`MOCK_BREAK=app-error-once`) |
| the two stream sentinels from the kernel's side | `e2e/sentinels.spec.ts` |
| the in-flight lanes against a stalled fal | `test/lanes.test.ts` |
| refusal telemetry end to end | `test/refusals.test.ts` |

## New env

| name | default | why |
|---|---|---|
| `MAX_CONCURRENT_IMG` | 6 | the image lane (finding 1) |
| `MARK_PER_IP_PER_HOUR` | 600 | `/api/mark` flood bucket (finding 13) |
| `NAME_PER_IP_PER_HOUR` | 60 | `/api/identity-seen` flood bucket (finding 5) |
| `IMG_TIMEOUT_MS` | **10000** (was 20000) | measured: a wallpaper is ~6.6 s end to end, so 5 s kills it |

## Collateral: INTEGRATE-1's cerebras screenshots are gone

`scripts/integrate.mjs` wrote its shots straight into
`reviews/shots-v01/<engine>/` under fixed filenames, and `reviews/shots-v01/`
is untracked — so the first run of this session overwrote INTEGRATE-1's
`cerebras-oss120` pictures in place before anyone noticed. That is the same
hazard README already flags for the bake-off's shots, one directory over.

This run's pictures and JSON are therefore under
**`reviews/shots-audit-fixes-1/`**, not in INTEGRATE-1's folder: INTEGRATE-1
now references files that are missing, which is visible, rather than files that
quietly show a different boot. `integrate.mjs` now takes `--shots=<label>` and
defaults to a dated directory, so it cannot happen again.

## The real boot (SPEC §12.1, `cerebras-oss120`)

`node scripts/integrate.mjs --engines=cerebras-oss120 --budget=1`, after the
fixes. Raw numbers and screenshots:
`reviews/shots-audit-fixes-1/cerebras-oss120/` + `.../integrate.json`. **$0.094 spent in total this session** (three boots at ~$0.030 and one
$0.006 image-timing probe), against a $2 ceiling.

| step | §12.1 target | this boot | INTEGRATE-1 median |
|---|---|---|---|
| boot screen paint | < 1.0 s | 1,179 ms | 1,281 ms |
| desktop interactive | < 4.0 s | **2,215 ms** | 2,548 ms |
| app window | < 2.5 s | 1,620–2,025 ms | 1,630 ms |
| page | < 2.5 s | 407–2,542 ms | ~1,800 ms |

Contract ok, zero hooks patched, wallpaper and all 16 icon cells filled
(`firstFilledMs: 3,016`), clock ticking, 8 of 16 launchers off screen (measured,
never repaired — §12.3's recurring failure).

What the numbers now show that they could not before (finding 6 and 11):

```
boot   first_paint 940   (held, folded into its own line)
app    first_paint 565 / 487 / 440 / 478   complete 857 / 1041 / 1220 / 1653
page   first_paint 28 / 561 / 666 / 1752 / 533
```

The 28 ms page is the browser's own speculative home replay — the only number
BAKEOFF-2's "page first paint" column ever contained. The real navigations are
**~0.5 s**, and they had never been measured at all.
