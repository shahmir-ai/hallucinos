# IMG-LATENCY-1 — the §12.5 images, measured before and after

2026-09-17. Instrument: `scripts/img-latency.mjs` (`npm run img-latency -- --n=3 --e2e`).
Spend: 12 images for the A/B + 6 for the follow-up probe + 2 end-to-end = **$0.060**.

BAKEOFF-2's complaint, verbatim: *"the desktop is revealed with grey empty icon
tiles and no wallpaper, and the pictures land 2–7 s later"* — `img` `total_ms`
median 6.7–15.3 s per engine, against SPEC §12.5's assumed 0.8 s. Target for
this pass: **< 2.5 s**.

## What changed

| | v0.1 (SPEC §12.5) | v0.2 |
|---|---|---|
| wallpaper | 1024×576, 4 steps | **768×432, 2 steps** |
| icon sheet | 1024×1024, 4 steps | **768×768, 4 steps** |
| photo / faces / map | 768², 1024², 1024×768, 4 steps | 640², 768², 768×576, 3 steps |
| transport | fal answers a CDN url → **we then download the bytes** | **`sync_mode: true`** — the response carries the image inline |
| format | jpeg | jpeg (unchanged) |

Every size ≤ 1 MP is **one billing unit** ($0.003), so none of the size changes
cost or save money. They only save bytes, and the bytes were the latency.

## Measured, same session, back to back (n=3, medians)

| config | kind | total | provider | download | bytes |
|---|---|---|---|---|---|
| v0.1 | wallpaper | **7,255 ms** | 4,102 ms | 3,153 ms | 210 KB |
| v0.1 | icon sheet | **4,190 ms** | 2,262 ms | 1,928 ms | 451 KB |
| v0.2 | wallpaper | **2,959 ms** | 2,959 ms | **0 ms** | 138 KB |
| v0.2 | icon sheet | **3,091 ms** | 3,091 ms | **0 ms** | 324 KB |

Per-call spread: v0.1 wallpaper 4.3 / 7.3 / 10.4 s; v0.2 wallpaper 2.4 / 3.0 / 4.5 s;
v0.2 icons 2.4 / 3.1 / 3.1 s.

End to end through the real route, `POST /api/img {kind:'wallpaper'}`:
**3,144 ms, of which 7 ms was ours** (`server_ms: 7`, `img_fetch_ms: 0`).

## The read

- **`sync_mode` is the whole win.** The download leg was 1.9–4.7 s — a second
  TLS round trip for 0.2–0.6 MB that we then base64'd into a `data:` URI
  anyway. Inline is the form the CSP (`img-src data:`) requires, so the leg did
  not need optimising, it needed deleting. **Wallpaper −59%, icon sheet −26%.**
- **Size and steps barely matter.** A follow-up probe (6 more images) says so
  plainly:

  | | 1 step | 2 steps |
  |---|---|---|
  | 768×432 | 2,949 / 2,846 ms | 2,173 / 2,290 ms |
  | 512×288 | — | 2,090 / 2,079 ms |

  Halving the pixels again buys ~100–200 ms; one step is not faster than two
  (and is visibly worse). schnell has a **floor of about 2.0–2.3 s** on this
  account that is queue and encode, not denoising. 768 at 2 steps is therefore
  the right stopping point, and 512 would be quality thrown away for noise.
- **The < 2.5 s target is met on a good call and missed on a median one, and
  the remainder is not ours.** Our share of a wallpaper is 7 ms. Anything more
  has to come from fal (a faster endpoint, or a paid queue tier) or from hiding
  the wait — which the kernel now does: the wallpaper fades in on a layer
  instead of the desktop being revealed with grey tiles.
- **Bytes matter for the other end too.** 138 KB instead of 210 KB of base64
  over the wire to the browser, and 324 KB instead of 451 KB for the sheet:
  ~25% less to transfer at exactly the same price.

## Cost is unchanged, and one class of waste is gone

Still $0.003 per image, still ≤ 4 per boot. What did change is **BAKEOFF-2
finding 6** — a failed boot still buying its images. The icon sheet now waits
for the desktop generation of the same boot to produce its first chunk
(`IMG_ICONS_GATE_MS`, default 6,000 ms) and is refused with
`blocked: "no-desktop"` if none ever does. The wallpaper still starts at
identity time, per SPEC §12.5: it is the one picture a boot screen can use, and
gating it would give back the only image that can land before the desktop.

On haiku's BAKEOFF-2 numbers (8 image calls over 4 boots, 2 of which booted)
that is $0.012 of $0.024 recovered. On cerebras, where boots rarely fail, it is
worth nothing — which is the correct amount for a guard.

## Reproducing

```
npm run img-latency -- --n=3 --e2e      # $0.036 + $0.003, prints the cost first
```

The script holds both configurations and the frozen S3 prompts, so a future
re-measure is the same experiment and not a new one.
