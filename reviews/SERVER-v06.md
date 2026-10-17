# SERVER-v06 — R4's tile sheets measured, the dead photos explained, and the phone route

Builder: Opus 5 (high), 2026-09-18, on v0.5 (`ded189e`).
Owns `server/**`, `prompts/**`, `scripts/**`, `test/**`, `README.md`, `DEPLOY.md`.
`kernel/**` and `e2e/**` untouched. Nothing committed.

**Verdict up front.** Three of the four items land and are verifiable. R4's
document half (bounded tile box, first row on the first screen) is written and
is not yet measured on a live page — it needs a browser walk, which belongs to
the harness pass. R4's **prompt** half is measured, on twelve real sheets, and
the honest answer is: one clause is proven, one is disproven, and 4×4
compliance is dominated by the seed rather than by anything in the wording.

---

## 1. R4 — the tile sheets, measured (12 real sheets, $0.036)

Every sheet below is a real `POST /api/img` (or, for the baselines, the exact
old prompt string sent straight to `fal-ai/flux-1/schnell` at the same size,
steps and `sync_mode`), page scope, so no palette words — the case HANDOFF-7 §7
was reporting. Sheets in
`/tmp/.../scratchpad/r4*` for this session; they are not cached and the seeds
are gone, so the table is the record.

| theme | wording | 4×4? | gutters / margins | blank or gradient cells | recognisable place | verdict |
|---|---|---|---|---|---|---|
| `faces` | R4 v1 | **yes, clean** | none | none | n/a | **best sheet in the run** |
| `thumbnails` | R4 v1 | yes | **none** | none | a flag, twice | good; 5 of 16 near-duplicates |
| `thumbnails` | R4 v1 | roughly, rows misaligned | none | **4 washed-out cells** | **Eiffel Tower** | poor |
| `thumbnails` | **baseline** | 4×5 contact sheet | **white margin around every cell** | none | none | poor — the gutter defect, reproduced |
| `thumbnails` | R4 v2 | **no — 3-column collage** | thin white gutters | none | a distant tower | poor |
| `posters` | R4 v1 | **no — 6×4 poster wall** | white surround | none | Eiffel ×2, Big Ben | poor |
| `posters` | **baseline** | **no — 6×4 poster wall** | white surround | none | none | poor — **pre-existing, not R4's** |
| `products` | R4 v1 | **no — one shelving unit** | shelf rails on the slice lines | none | none | **regression caused by R4 v1** |
| `products` | **baseline** | **yes, clean studio** | none | none | none | **best `products` sheet**; all 16 were drills |
| `products` | R4 v2 | yes, 16 lit niches | niche edges near the slice lines | none | none | sliceable; not as clean as baseline |
| `covers` | R4 v1 | roughly | **wooden shelf rails on the slice lines** | none | clock towers | poor |
| `covers` | R4 v2 | yes | **wooden shelf rails on the slice lines** | none | Eiffel, Big Ben | poor |

### What the table actually proves

1. **`plain background` was the gutter defect, and removing it works.** The one
   baseline `thumbnails` sheet came back as a contact sheet with a white margin
   around every cell — which `kernel/sheet.ts`'s quarter-slice puts *inside*
   every tile. Neither R4 `thumbnails` sheet has a margin. n=1 against n=2, but
   the mechanism is legible: a sheet whose cells touch edge to edge has no
   background, so the clause could only read as permission to leave the sheet
   unpainted. **Shipped.**
2. **Stating the coverage at SHEET level buys a photograph of a display.** R4
   v1's "the whole sheet covered in pictures to all four of its edges" turned
   `products` from a clean 4×4 of studio objects (baseline) into a photograph of
   a shop's shelving unit, rails across the slice lines. Caught, and it is the
   reason the wording went to v2: coverage is now stated per **cell**, plus
   `sixteen separate pictures` and the named furniture (`no one continuous scene
   divided into cells, no shelf, no rack, no display stand, no wall of
   frames`). v2's `products` is sliceable again. **Shipped, and it is a wording
   I introduced and then had to take back — worth saying plainly.**
3. **The anti-landmark clause does not work.** `no landmark, no monument, no
   famous building, no recognisable city, no flag, no signage` is in the prompt
   and an Eiffel Tower is in four of the twelve sheets. FLUX schnell treats
   negatives weakly (the same reason the icon sheet needed a positive ruling),
   and the positive half — the subject **classes** in the `thumbnails` clause —
   is the only part with any signal: the one sheet with no landmark at all among
   the R4 thumbnails is the one that took the classes literally (interiors,
   crowds, weather, texture). Kept, because it costs nothing, and **reported as
   unproven**, not as fixed.
4. **4×4 compliance is seed-dominated.** `thumbnails` gave a clean 4×4 on one
   wording and a 3-column collage on a *stronger* wording; `posters` gave the
   same 6×4 poster wall on the old words and the new. At one or two sheets per
   configuration, the wording is not the variable that moves it. **Do not read
   the v1/v2/baseline columns as a ranking of the wording** beyond findings 1
   and 2, which have a mechanism behind them.
5. **`posters` and `covers` are structurally broken and prompt wording is the
   wrong tool.** Both themes ask for *printed designs*, and an image model draws
   printed designs the way it has seen them: on a wall, in a rack, on a
   shelf — furniture that lands exactly on the slice lines — with garbled
   lettering, which no `no text` clause has ever stopped on these two themes.
   The cheap next move is the override this file already reserves
   (`prompts/images/tiles-posters.md`, `tiles-covers.md`) with a completely
   different framing, or the kernel slicing what it is given. Not this pass.

### The document half (not yet measured)

`prompts/system/page.md`: a tile class must carry a `max-width` (**posters
200px, thumbnails 340px, products/covers/faces 220px**) and an `aspect-ratio`,
and the grid's first row has to be inside the screen size the prompt was given.
`prompts/apps/store.md`: the six listing icons are square and `max-width` ≤
220px, and the featured listing plus the first card are on the first screen.
Both are aimed at HANDOFF-7 §7's third finding (`seen` ≪ `filled`: a model
sized one poster 861×1292, taller than the window). **Whether they land is a
browser measurement** — count `data-os-tile` elements whose box is inside the
first screen, against the sheet that was bought — and the harness is not mine
this pass.

## 2. Time and date (HANDOFF-7 §4)

`prompts/system/desktop.md` now says it in four places, because a rule stated
once in prose was measured landing on 3 of 5 bars:

- both archetype **skeletons** show the structure —
  `<div data-os-clock=""><span>…the time…</span><span>…the date…</span></div>`;
- the clock rule requires **two child elements**, never one text node with both;
- a rule of its own names the failure (`02:20:5018/09/2026` read as one number
  of eighteen digits) and gives the three acceptable mechanisms (`gap` on the
  clock, `margin-left` on the date, a separator element), with the point that
  padding on the clock as a whole does not do it — the gap has to be *between*
  the two;
- the hook list line 5 and the **closing checklist** both carry it.

Unmeasured here on purpose: this is worth exactly one 4-boot re-read of
`scripts/run.mjs`'s `barSpacing.tightest`, which HANDOFF-7 §4 made honest, and
that is a harness run rather than a server pass. The number to beat is **1 of 4
bars jammed**.

## 3. The dead photos (HANDOFF-7 §5, §11.7)

**Why they were unexplained: we threw the answer away.** `falImage` put fal's
response body into the `ImgError` message (`detail.slice(0, 200)`) and the route
logged only `error: "img " + code`. Eight failures in HANDOFF-6 and seven in
HANDOFF-7 therefore said `img upstream` and nothing else.

Fixed, in two parts:

- **The body is logged.** `img_err` (flattened, 300 chars) and `img_status` on
  every failed image line, plus `img_err_first` / `img_status_first` when a
  retry happened. Stdout only: the client's 502/504 body is still
  `{"error":"image unavailable"}`, asserted by a test. The next real run will
  say what the 3.5–4.6 s `bytes: 0` deaths are; **this pass did not reproduce
  one** (13 real fal calls, 0 failures), so the cause is still unknown and now
  merely *knowable*.
- **One retry, narrowly.** `shouldRetryImg(err, elapsedMs)` allows a second call
  only when fal never answered 2xx (nothing billed), the failure arrived inside
  `IMG_RETRY_MAX_MS` = 6,000 ms, it is not a 429/401/402, and it does not read
  as a refusal of the **content** (`isModerationRefusal`: the body's own words,
  or a 403). A content refusal refuses the same words twice. The second call
  sends `simplifyImgPrompt(prompt)` — the first two comma-separated clauses,
  bracketing and quoting characters stripped, clamped to 140 — and **only for
  single pictures** (`photo`, `map`, `wallpaper`): a sheet's grid clauses do not
  survive that cut, and an unsliceable sheet is worse than an empty one.

14 new unit tests and 5 new route tests, all against a fake fal that fails fast
on demand: a retried 500 returns 200 and bills **one** picture ($0.003, read off
`/api/stats`), the second prompt is the simplified string, and a 422 safety
refusal, a 429 and a `tiles` request each make exactly **one** call.

## 4. The phone (task 4) — verified, both directions

| | reading |
|---|---|
| default bind | `lsof` → `TCP *:8781 (LISTEN)`, one IPv6 socket that accepts IPv4 too |
| `curl http://192.168.18.113:8781/healthz` | **200** |
| with `HOST=127.0.0.1` | `lsof` → `TCP 127.0.0.1:8782`; LAN request **000** (refused), loopback 200 |
| boot log | `{"event":"listening","host":"*"}` |

So the server **already** reached the LAN and nothing had to change for the
phone to work. What changed is that it is now switchable and printed: `HOST` in
`server/env.ts`, passed to `serve()` only when set.

**`HOST` defaults to unset (the node wildcard), not to the literal `0.0.0.0`**,
and that is deliberate against the brief's own wording: binding `0.0.0.0` drops
IPv6, and `localhost` resolves to `::1` first on macOS — which is the address
`playwright.config.ts` and every `curl localhost` in this repo use. The default
is therefore strictly wider than `0.0.0.0` and includes it.

README gained **"Test it on your phone"**: the two commands
(`npm run dev` / `node dist/play.js`, then `ipconfig getifaddr en0`), the URL
shape, the verification above, that **nothing is deployed** and lives as long as
the terminal, and that every cap still applies — with the one non-obvious note
that the phone and the laptop are two different local IPs and therefore two
different per-IP hourly buckets, one shared day counter. DEPLOY.md gained the
`HOST` row (never set it on Railway).

## 5. Files changed

| file | change |
|---|---|
| `server/img.ts` | `IMG_RETRY_MAX_MS`, `isModerationRefusal`, `shouldRetryImg`, `simplifyImgPrompt`, `IMG_RETRY_PROMPT_MAX` |
| `server/index.ts` | the one retry in `POST /api/img`; `imgErrText`; `img_err` / `img_status` on failures; `HOST` passed to `serve()` and printed |
| `server/telemetry.ts` | `img_err`, `img_status`, `img_retry`, `img_err_first`, `img_status_first` |
| `server/imgprompt.ts` | `TILE_GRID` rewritten (R4); the `thumbnails` subject clause |
| `server/env.ts` | `host` |
| `prompts/images/tiles.md` | the fenced prompt (R4), the `thumbnails` clause, two new commentary bullets carrying the measurements |
| `prompts/system/page.md` | R4: bounded tile box per theme, first row on the first screen |
| `prompts/apps/store.md` | R4: square bounded icon slots, featured + first card on the first screen |
| `prompts/system/desktop.md` | time and date as two elements with a visible gap, in four places |
| `test/img.test.ts` | 14 tests for the retry decision and the simplifier |
| `test/routes.test.ts` | 5 route tests; the fake fal can now fail fast on demand |
| `README.md` | "Test it on your phone"; v0.6 deviations |
| `DEPLOY.md` | the `HOST` row |

`npm test`: **361 passed** (345 before, +16 here). `npx tsc --noEmit`: clean.
`npx playwright test`: **150 passed, 0 failed** (rc=0), on the integrated tree —
which by then also carried another session's kernel work and its new
`e2e/bars.spec.ts`.

One instrument note worth keeping: the **first** e2e attempt reported 45
failures, and every one of them was
`browserContext.close: ENOENT … test-results/.playwright-artifacts-*/…` — two
playwright runs (mine and another session's) writing one `test-results/`
directory and deleting each other's traces. Nothing product-side failed. The
clean run above is the same suite with `--output=<a directory of my own>`. **On
a shared tree, pass `--output`**; a colliding artifact directory reports as
dozens of product failures.

## 6. What remains

1. **R4's document half is unmeasured.** Count tiles whose box is inside the
   first screen, and tile widths against the per-theme ceilings, on a real
   browser walk. Until then the bounded box is a prompt, not a result.
2. **`posters` and `covers` still slice through furniture and still letter
   themselves.** Wording has now failed twice on both. Next move is a per-theme
   override file with a different framing, or kernel-side slicing — a ruling,
   not a guess.
3. **The `engine_dead` cause is still unknown**, only now recoverable: the next
   real run with photos in it will print `img_err` and `img_status`. Nothing in
   this pass reproduced the failure (13/13 fal calls succeeded).
4. **D4's re-measure is one 4-boot harness run** against
   `barSpacing.tightest`. The prompt is aimed; the number is not in yet.
5. **`.env.example` has no `HOST` line** — the file is not in this pass's
   ownership list. One line, whoever owns it next.
6. **Ports 8770–8780 were held by another session's playwright run for most of
   this window** (the standing rule is to wait, not to kill). The suite did run
   in the end: 150 passed, 0 failed — see §5 for the artifact-collision trap it
   walked into first.
7. **One process-hygiene note, for the record.** The mock servers this pass
   started for the LAN check and the sheet probe were stopped with
   `pkill -f "dist/server.js"`, which is the same command line playwright's own
   eleven servers use. The timestamps say it did not collide (the other run's
   servers appeared after the last `pkill`), but the pattern was broad enough
   that it could have. A probe server should be started on a port nobody else
   uses **and** stopped by its own pid, not by its command line.
