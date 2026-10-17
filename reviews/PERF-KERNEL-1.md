# PERF-KERNEL-1 — kernel timings on the mock engine

Measured 2026-10-17T16:32:27.282Z by `e2e/perf.spec.ts`, 3 boots, mock engine
at ~1,500 tok/s with no provider latency. These are **kernel overhead** numbers:
SPEC §12.1 targets (boot paint < 1.0 s, desktop interactive < 4 s, app < 2.5 s,
page < 2.5 s) are for the chosen fast engine and are decided by a bake-off, not here.

| step | median ms | all (ms) |
|---|---|---|
| bootPaint | 83 | 97, 82, 83 |
| desktopInteractive | 292 | 324, 291, 292 |
| desktopRevealed | 2883 | 2895, 2876, 2883 |
| appPaint | 95 | 91, 95, 96 |
| pagePaint | 115 | 115, 113, 115 |

- `bootPaint` — navigation start to the first painted pixel of the boot document.
- `desktopInteractive` — the kernel mark: boot request start to a mounted, wired,
  window-manager-owning desktop (behind the boot screen).
- `desktopRevealed` — when the boot screen lifts. Floored at 2.5 s by SPEC §12.3,
  so a number near 2.5 s here means the desktop was ready early and waited.
- `appPaint` — launcher press to the first painted pixel of the app document.
- `pagePaint` — a search submitted inside the browser to the first painted pixel of
  the results document.
