# IMG-LATENCY-2 — four fal endpoints, one prompt, and the answer to #6

2026-09-17, ~20:47–20:56 PKT. HANDOFF-5 ranked #6: "fal's latency,
unexplained. IMG-LATENCY-1 measured a wallpaper at 2.9 s; BAKEOFF-4 measured
8.9 s median and 13.7 s worst on the same config, with 2 of 22 never arriving.
One A/B before anyone concludes the slow reveal is ours."

**Instrument:** `scripts/img-latency2.mjs` (new). Every text-to-image endpoint
fal lists at or below $0.006 an image, the **same** frozen prompt (the server's
own wallpaper wording with the dice rolled in), the **same** size (768×432),
six calls each, back to back — plus each one again through `queue.fal.run`
(submit → poll → fetch) instead of `fal.run` (sync). 48 images.
Raw rows: `reviews/img-latency-2-calls.json`.

**Spend: $0.138** (48 images at each model's own rate). Nothing else was
bought and no server was started.

---

## The table

| model | path | $/img | steps | n | fails | median | mean ± sd | min | p100 | median bytes |
|---|---|---|---|---|---|---|---|---|---|---|
| **fal-ai/sana/sprint** | sync | **$0.0025** | 2 | 6 | 0 | **2,447 ms** | 2,573 ± 545 | **2,037** | 3,571 | 269 KB |
| **fal-ai/flux-1/schnell** (ships today) | sync | $0.003 | 4 | 6 | 0 | **2,595 ms** | 2,735 ± 396 | 2,336 | **3,249** | **144 KB** |
| fal-ai/sana | sync | **$0.001** | 18 | 6 | 0 | 2,900 ms | 2,911 ± 332 | 2,549 | 3,349 | 259 KB |
| fal-ai/z-image/turbo | sync | $0.005 | 8 | 6 | 0 | 6,272 ms | 5,716 ± 1,954 | 2,530 | 7,676 | 253 KB |
| fal-ai/flux-1/schnell | queue | $0.003 | 4 | 6 | 0 | 3,656 ms | 4,478 ± 1,886 | 3,410 | 8,270 | 143 KB |
| fal-ai/z-image/turbo | queue | $0.005 | 8 | 6 | 0 | 3,882 ms | 6,701 ± 7,207 | 3,280 | **21,389** | 254 KB |
| fal-ai/sana | queue | $0.001 | 18 | 6 | 0 | 3,990 ms | 3,891 ± 595 | 3,199 | 4,772 | 259 KB |
| fal-ai/sana/sprint | queue | $0.0025 | 2 | 6 | 0 | 8,021 ms | 8,390 ± 5,877 | 2,621 | 14,639 | 269 KB |

**0 failures in 48 calls.** BAKEOFF-4's "2 of 22 never arrived" did not
reproduce at any endpoint on this hour.

---

## Five findings

1. **#6 is answered, and the answer is the queue, not the model.** Every
   endpoint on the shelf — including the one we ship — sits at a **2.4–2.9 s
   median** with a p100 of 3.2–3.6 s on the sync path. BAKEOFF-4's 8.9 s median
   and 13.7 s worst on the *same code and the same model* is therefore fal's
   own weather, not our parameters and not our model choice. There is nothing
   left to optimise here: the slow reveal BAKEOFF-4 photographed will come back
   on a bad hour whatever we pick, and the product's answer to it is already
   built (pictures fade in late and nothing on screen waits for one).
2. **`sync_mode` is confirmed, decisively, for the fourth time.** The queue path
   is slower at every one of the four endpoints — by 1.1 s (schnell), 1.1 s
   (sana), 5.6 s (sprint) — and it is where every one of the eight worst calls
   in the run lives, up to **21.4 s**. The reason is structural, not incidental:
   `queue.fal.run` answers with a CDN URL, so we then pay a second round trip
   (measured at **1.2–1.8 s** of download for 150–290 KB) that `sync_mode`
   deletes by inlining the bytes. It is also the form the CSP needs anyway
   (`img-src data:`). The fal SDK defaults to the queue path; we do not, and
   this is the measurement that says keep it that way.
3. **"The fastest at ≤ $0.006" is not resolvable at n=6, and honesty beats the
   brief here.** `sana/sprint` has the better median (2,447 vs 2,595) and the
   better minimum (2,037 vs 2,336); `flux-1/schnell` has the better p100 (3,249
   vs 3,571), the lower variance (± 396 vs ± 545) and **half the bytes** (144 KB
   vs 269 KB, which is real: those bytes cross our process and then a `data:`
   URI). The means are 162 ms apart against a pooled sd of ~470 ms. That is not
   a difference; it is two draws from one distribution.
   **So the default stays `fal-ai/flux-1/schnell`** and the endpoint becomes a
   variable. Switching the picture that fills the whole screen to a 2-step
   distilled model, on an unresolvable 6% median gain, with **nobody having
   looked at a single output**, would be exactly the vibes decision the
   measurement doctrine forbids.
4. **`z-image/turbo` is out.** The brief named it; it is the slowest endpoint
   measured (median 6,272 ms, 2.4× schnell) and the most expensive of the four
   ($0.005). Its 8 steps are its own documented default and cutting them is a
   quality change, not a latency fix — BAKEOFF-3 already measured that step
   count does not move fal's latency.
5. **`fal-ai/sana` at $0.001 is the interesting one nobody asked about.** It is
   **a third of schnell's price**, has the *tightest* distribution in the whole
   run (± 332 ms, p100 3,349) and costs +305 ms of median. At SPEC §12.5's four
   pictures a boot that is 1.2¢ → 0.4¢ per boot. Whether its 18-step output
   looks like an operating system's wallpaper is a question for eyes, not for
   this instrument.

---

## The ruling

`IMG_MODEL` is now an environment variable (`server/img.ts`, `IMG_MODELS`).

| | value |
|---|---|
| default | `fal-ai/flux-1/schnell` — unchanged, and now a decision with numbers under it rather than an inheritance from SPEC §12.5 |
| the challengers, one variable away | `fal-ai/sana/sprint` ($0.0025, marginally faster median), `fal-ai/sana` ($0.001, 3× cheaper, tightest variance) |
| rejected | `fal-ai/z-image/turbo` — 2.4× slower and dearer |
| path | `fal.run` with `sync_mode: true`. Never `queue.fal.run` |

Mechanics, all in `server/img.ts`:

- `IMG_MODELS` holds each endpoint's **own** per-megapixel rate, documented
  default step count and documented step ceiling, read from its OpenAPI schema
  (`fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`). All four take an
  identical request body — `image_size` as a `{width,height}` object,
  `num_inference_steps`, `sync_mode`, `output_format`, `seed`,
  `enable_safety_checker` — which is the only reason this can be a plain env
  variable instead of a per-provider adapter.
- `resolveImgModel()` validates the variable and **falls back to the default**
  on anything unknown. A typo in a Railway variable must not take the pictures
  away from every visitor.
- `imgUsd(model)` is what the route now reserves and bills, replacing the flat
  `IMG_USD`. Two models at two prices on one day's telemetry would otherwise be
  indistinguishable, and the day's USD cap would be wrong for both.
- `stepsFor(kind, model)` keeps the measured per-kind table (4/4/3/3/3) for the
  **default model only** and gives every other endpoint its own documented
  default, clamped to its own ceiling. A two-step distilled model and an
  eighteen-step one do not mean the same thing by "3", and an unclamped 4 would
  422 an endpoint whose maximum is 8.
- Telemetry carries `img_model` on every image line.

## Next, if anyone wants the cost cut

One boot on `IMG_MODEL=fal-ai/sana` and one on `fal-ai/sana/sprint`, through
`/bakeoff`, with a person looking at the wallpaper and the icon-plate sheet
side by side against schnell. That is a ten-minute, six-cent decision and it is
worth 3× on the image line of every boot. It is a **quality** judgement and
this pass deliberately did not make it.

### Traps

- **n=6 per arm is enough to reject z-image and not enough to pick a winner
  between the top three.** Both halves of that sentence matter; the run that
  only reads the median column will switch the default for nothing.
- **The queue path's variance hides in the median.** `sprint`'s queue median is
  8.0 s and its queue minimum is 2.6 s — read `p100`, or a 21-second call looks
  like a 4-second endpoint.
- **fal bills per megapixel rounded up**, so every size in `IMG_KINDS` is one
  billing unit and the sizes are free to change. The price differences above are
  entirely the model, not the pixels.
