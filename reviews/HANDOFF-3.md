# HANDOFF-3 — v0.1 closed and verified (2026-09-17, ~16:10 PKT)

The state of the tree after SPEC §12's amendments were built, integrated,
judged, audited and re-verified from a wiped `node_modules`/`dist`.

**Verification run, in the order it was done, all green:**

| step | result |
|---|---|
| `rm -rf node_modules dist public/kernel.js` + `npm ci` | clean, 125 packages, 2 s (Node 23.11.0 / npm 11.3.0) |
| `npm run build` | `public/kernel.js` + `dist/server.js`, no warnings |
| `npm test` (vitest) | **195 passed**, 20 files, 2.8 s |
| `npm start` (`PORT=8790 DEFAULT_ENGINE=cerebras-oss120`) | `listening` line names 9 keyed engines, moderation `auto`, caps 60/h · 10,000/day · $25/day |
| `GET /healthz` | `200 ok` |
| `GET /api/engines` | 9 engines, `default: cerebras-oss120`, prices present |
| `GET /` · `/bakeoff` · `/bakeoff/run?engine=cerebras-oss120` | `200` / `200` (landing page, 9 engines each with a Boot link, sourced from BAKEOFF-2) / `200` |
| `GET /api/stats` · `/robots.txt` | stats reports the day counters; robots disallows `/api/` |
| `npm run test:e2e` (mock), first run | 50 passed, **1 failed** — a racy assertion in the suite itself, fixed below |
| `npm run test:e2e` after the fix | **51 passed** (3.1 min), and `browser.spec.ts ×3` 12/12 |
| one real boot, `cerebras-oss120` | contract ok, 0 hooks patched, 0 JS errors, 0 CSP refusals — **$0.0298** |

Spend this session: **$0.0298** against the $2 ceiling. Day counter after it:
`{count: 1020, usd: 4.83}` of $25.

### The one failing test, and the fix

`e2e/browser.spec.ts:80` ("reloading a page regenerates it") failed with
`expect(a).toBeTruthy()` on an empty token. Not a product bug: `data-mock-shape`
is an attribute of the mock page's opening `<main>` tag and `data-mock-token`
lives in its tail, so `waitForPageShape()` returns while the document is still
streaming and the token is not there yet. Every other `genToken` caller in the
suite polls for a non-empty token first; this one did not. Added the same poll,
re-ran the file three times: 12/12. **This is the only source change made in
this session** — the tree that was measured below is otherwise untouched.

---

## 1. What changed in v0.1

v0.1 is everything uncommitted on top of `2e82a33`: **103 files changed,
+3,354/−482**, plus 22 new source/test files. Chronologically, by the report
that owns each piece:

1. **`reviews/SERVER-v01.md`** — interfaces I1–I8. Identity folded into the boot
   stream as an HTML comment (no separate round trip); `data/dice.json` +
   `server/dice.ts` (era/setting/temperament/materials drawn server-side) and the
   never-names ring; `POST /api/img` (fal schnell, `data:` URIs, so the CSP stays
   `img-src data:`); timing telemetry + `POST /api/mark`; §12.1's token budgets
   (boot 800, desktop 3,500, app/page 2,500); `/bakeoff` demoted to a landing
   page with `/bakeoff/run?engine=`; remote moderation moved off the critical
   path with a mid-stream `<!--os-reroute-->` sentinel.
2. **`reviews/PROMPTS-1.md`** — every prompt rewritten for the new budgets, the
   §12.3 archetypes (`taskbar` | `dock`, `[data-os-archetype]`,
   `[data-os-clock]`), and compact markup.
3. **`reviews/KERNEL-3.md`** + **`PERF-KERNEL-1.md`** — identity parsed out of
   the boot stream; §12.2's "nothing is replaced without a user event" (interactivity
   attaches mid-stream, repair is a patch, the boot overlay lifts only when the
   desktop is wired, ≥ 2.5 s floor); wallpaper + icon-sheet slicing
   (`kernel/img.ts`); speculative generation on `mousedown`. Kernel overhead on
   mock: boot paint 85 ms, desktop interactive 321 ms, app 84 ms, page 109 ms.
4. **`reviews/INTEGRATE-1.md`** — 8 cross-seam bugs the three builders could not
   see individually (server-side clock validation, `<html>` attributes lost on
   mount, boot first paint dropped by telemetry, bare hostnames resolved as
   paths, icon cells sliced into their neighbours, dark-on-dark launcher labels,
   the mock fixture not being a faithful §12 stand-in, a dead engine costing 120 s).
5. **`reviews/BAKEOFF-2.md`** — the §7 judging protocol run for real on four
   engines, 13 boots, $0.67. Verdict: `cerebras-oss120`.
6. **`reviews/AUDIT-FIXES-1.md`** — 14 safety/kernel findings applied: separate
   in-flight lane for images, reroute handling in the kernel, no reset of a
   painted document, telemetry on every refusal, `/api/identity-seen` and
   `/api/mark` authenticated + capped, image limits keyed to the IP hash, aborted
   streams no longer counted as contract misses, billable image failures, and
   `interactive_ms` split into first paint vs `complete_ms`.

Tests went 105 → **195 vitest** and 29 → **51 playwright**.

## 2. Measured times vs §12.1 targets

Final verification boot (`scripts/integrate.mjs --engines=cerebras-oss120
--shots=final-v01`), machine **Dispatchium 3.1.4-beta**, "1950s courier dispatch
room", archetype `taskbar`. Raw numbers:
`reviews/shots-final-v01/integrate.json`; shots:
`reviews/shots-final-v01/cerebras-oss120/`.

| step | §12.1 target | this boot | first paint | verdict |
|---|---|---|---|---|
| boot screen paint | < 1.0 s | **1,489 ms** | — | **MISS** |
| desktop interactive | < 4.0 s | **3,172 ms** | — | PASS |
| desktop revealed (§12.3 floor 2.5 s) | — | 4,343 ms | — | — |
| app window content | < 2.5 s | 1,215 / 1,619 / 2,023 / **2,427** ms | 468–948 ms | PASS (store is the 2,427) |
| page | < 2.5 s | 406 / 1,738 / 1,740 / 2,140 / **2,438** ms | 467–1,418 ms (29 ms speculative home) | PASS (the first search is the 2,438) |

Against the three prior real measurements (same engine, same protocol):

| boot | boot paint | desktop interactive | source |
|---|---|---|---|
| INTEGRATE-1 median (3 boots) | 1,281 ms | 2,548 ms | `INTEGRATE-1.md` |
| BAKEOFF-2 median (4 boots) | 1,064 ms | 2,334 ms | `BAKEOFF-2.md` |
| AUDIT-FIXES-1 (1 boot) | 1,179 ms | 2,215 ms | `AUDIT-FIXES-1.md` |
| **final verification (1 boot)** | **1,489 ms** | **3,172 ms** | this file |

This boot is the slow end of the distribution and the reason is in the
telemetry, not the code: the boot generation's `provider_ttfb_ms` was **1,298 ms**
(desktop 609 ms), against 674 ms median in BAKEOFF-2. The kernel adds ~90–190 ms.
**Boot paint < 1.0 s is unreachable while Cerebras' first token takes ≥ 0.7 s.**
The two honest options are unchanged: accept ~1.1–1.5 s, or have the kernel paint
its own first frame from the identity comment (it arrives in the same chunk) —
a design call for Shahmir, not a bug. Everything else passes, including all four
apps and all five pages with no broken render.

Desktop hooks on this boot: `contract ok`, 0 injected, wallpaper landed
(`firstFilledMs: 4,527`), **16/16 icon cells filled**, clock present and ticking
(minute resolution), 16/16 launchers labelled — and **5 of 16 off screen** in a
single tall column, which is §12.3's recurring failure, measured and deliberately
not repaired.

## 3. Bake-off #2, per engine (`reviews/BAKEOFF-2.md`, 13 boots, $0.67)

| engine | boots | contract miss | boot paint | desktop interactive | tok/s | broken renders | $/session |
|---|---|---|---|---|---|---|---|
| **`cerebras-oss120`** | 4 | **0% (0/20)** | 1,064 ms | **2,334 ms** | 1,152 | 7.5% | **$0.0307** |
| `anthropic-haiku` | 4 (2 booted) | 0% (0/8) | 5,027 ms | 19,894 ms | 118 | 5% | $0.2434 |
| `or-oss20-groq` | 4 | 10% (2/20) | 1,662 ms | 4,816 ms | 543 | 17.5% | $0.0151 |
| `mercury-2.5` | 1 (0 booted) | — | — | — | — | — | $0.0002 |

`cerebras-oss120` is the engine: three of four §12.1 targets, zero contract
misses, funniest fake internet per dollar. `or-oss20-groq` is the cheap fallback
and reads cheap. `anthropic-haiku` writes the best-looking OS in the set and our
own 25 s generation timeout kills half its boots — reference engine, not a
candidate. `mercury-2.5` returns 403 (CloudFront) for every call from this
network, `/v1/models` included, and cannot be judged until it is run from
somewhere else.

## 4. Image cost per session

fal `fal-ai/flux-1/schnell`, flat **$0.003** per image, ≤ 4 per boot (§12.5), 2
in practice: one wallpaper (1024×576) + one 4×4 icon sheet (1024×1024).

| source | images/boot | $ images | $ text | **$ per session** |
|---|---|---|---|---|
| final verification boot | 2 | $0.0060 | $0.0238 | **$0.0298** |
| BAKEOFF-2, `cerebras-oss120` | 2.0 | $0.0045 | $0.0262 | **$0.0307** |
| BAKEOFF-2, `or-oss20-groq` | 2.0 | $0.0060 | $0.0091 | $0.0151 |
| BAKEOFF-2, `anthropic-haiku` | 4.0 | $0.0120 | $0.2314 | $0.2434 |

So images are **~20% of a session** on the chosen engine, and a session is
**~$0.03**. At $25/day that is ~800 full sessions/day before the cap refuses
anyone — the cap is the stop, not a hope (`server/caps.ts`, proved in
`test/caps.test.ts` and `test/lanes.test.ts`). Measured latency, which is the
real cost: schnell answers in ~2.6 s and then the server downloads 0.5–0.9 MB
itself to keep `img-src data:`, so a wallpaper is ~6.6 s and an icon sheet ~4.9 s
end to end — hence `IMG_TIMEOUT_MS=10000`. Icons therefore pop in **~1.5 s after**
the desktop is live (4,527 ms vs 3,172 ms on this boot).

## 5. Deviations

The complete list, one line of reason each, is in **README.md → Deviations**,
now five sections deep (base, integration, bake-off harness, kernel/§12, audit
fixes). Nothing in this session's verification added a deviation. The five that
matter most to anyone deploying this:

1. **The desktop is mounted into the top document, not a sandboxed frame** — the
   kernel must read its hooks and place iframes inside its window template. A
   generated desktop script is therefore same-origin with the kernel. Apps and
   pages — the whole fake internet — are opaque-origin sandboxes with
   `default-src 'none'`. Stated risk, v2 fix.
2. **The identity comment is re-emitted canonically**, clamped and escaped, not
   forwarded byte-for-byte (a 22 KB `personality` was an input-token amplifier).
3. **`POST /api/gen` accepts `rerouted: true` from the client** — it can only
   ever make a page more wholesome, and without it the kernel's retry loses the
   same moderation race for ever.
4. **A truncated document that has already painted is kept, not regenerated** —
   §12.2 forbids replacing a visible document; the truncation is logged instead.
5. **Photos / faces / map images (§12.5) are not implemented** — only wallpaper
   and icon sheet. Per-app and per-page images need a request path out of a
   sandboxed document.

## 6. Known issues

Ranked. Nothing here is a blocker for a deploy behind the caps; items 1–4 are
prompt work with a number already attached.

1. **Launchers in a single column, some off screen** (§12.3). 5/16 off screen on
   this boot; BAKEOFF-2 saw 5, 1 and 16 across ten desktops. `anthropic-haiku` is
   the only engine that drew a real 4×4 grid. The measurement
   (`data-os-launchers-offscreen`) works; one sentence in
   `prompts/system/desktop.md` — sixteen icons, rows of at most eight, none below
   the fold — is the cheap fix. **Not attempted in this session**: changing a
   prompt after the verification boot would have invalidated the numbers above.
2. **25% identity-parse failure on `cerebras-oss120`** (BAKEOFF-2: 1 boot in 4
   arrived as `UNNAMED/6BXG` with generic labels and no era). It parsed on this
   boot. It is the single biggest variety bug and it is an I1 problem, not taste.
3. **`store` is the least reliable app and the one people screenshot** — 3/16
   opens threw script errors in BAKEOFF-2 and both haiku stores hit the 2,500-token
   cap mid-card. The shape asks for 8–16 listings with a paragraph each, which
   does not fit. It was clean and the slowest app (2,427 ms) on this boot.
4. **`google.com/search?q=` sometimes renders the home page** instead of results
   (2 of 8 boots in BAKEOFF-2). `prompts/system/page.md` needs the query-string
   case sharpened.
5. **Boot documents hit the 800-token cap** (`truncated: true` on 3 of 4 cerebras
   boots in INTEGRATE-1; not on this one). Harmless — the identity comment is
   first and the boot screen is transient — but a truncated document can end
   mid-tag.
6. **Wikipedia is the dullest page in the OS** — every engine recites the real
   Moon accurately. Either make it about a moon that does not exist in this
   reality, or drop it from the demo script.
7. **A failed boot still buys its images** — images start the moment the identity
   comment parses. $0.024 bought two OSes across four haiku boots.
8. **Bake-off screenshots are not run-numbered** (`shots-bakeoff/<engine>/<boot>/`
   is overwritten in place), so BAKEOFF-1's shot references now point at
   BAKEOFF-2's pictures. `integrate.mjs` was fixed (`--shots=`); `bakeoff.mjs`
   was not.
9. **`mercury-2.5` is unjudged** — 403 from this network.
10. **Advertised vs measured throughput**: Cerebras' 2,000–3,000 tok/s is 343–1,467
    tok/s here, and `provider_ttfb_ms` swings 0.6–1.3 s boot to boot. Plan on the
    measured numbers.
11. **Cosmetic, `/bakeoff/run` only: the engine `<select>` sits on top of the boot
    document's first line** (`shots-final-v01/cerebras-oss120/01-boot.png` — the
    machine's own banner is behind the picker). SPEC §7 puts the picker on the boot
    screen and `/` has neither picker nor HUD, so this is only ever seen while
    judging, but it hides exactly the line a judge wants to read.

## 7. Deploy-readiness call — **YES**, per DEPLOY.md, with three variables that must be set

It is ready to go on Railway. The reasons, concretely:

- Clean clone → `npm ci && npm run build && node dist/server.js` works, which is
  exactly what `railway.json` runs (NIXPACKS, healthcheck `/healthz`), verified
  above from a wiped tree.
- The money stop is real and tested, not aspirational: every generation is priced
  at its full output budget *before* a token is bought and refused with the same
  `429 {queue:true}` screen a rate-limited visitor sees; images hold a separate
  in-flight lane so a slow wallpaper cannot take `/api/gen` down; every refusal
  now writes telemetry. At ~$0.03 a session, $25/day is ~800 sessions.
- Safety holds where it can: generated apps and pages are opaque-origin sandboxes
  with zero network, moderation runs locally on the critical path and remotely in
  parallel with a mid-stream abort, bot user agents are refused on `/api/gen`,
  and `robots.txt` disallows `/api/`.
- Quality is above the SPEC §10.3 gate on the default engine: 0 contract misses
  in 20 generations in BAKEOFF-2 and again on this boot.

**Do not deploy without these three**, all of them in DEPLOY.md's table and each
one a silent failure rather than a loud one:

1. `DEFAULT_ENGINE=cerebras-oss120` — otherwise the engine every anonymous
   visitor gets falls out of `engines.json` file order.
2. `TRUST_PROXY=1` (Railway's edge terminates the connection) — without it every
   visitor shares one rate-limit bucket; anywhere the process is directly
   reachable, set it nowhere.
3. A volume at `/data` with `CAPS_STATE_FILE=/data/caps-state.json` **and**
   `NAMES_RING_FILE=/data/names-ring.json` — otherwise every redeploy hands the
   world a fresh daily budget and resets §12.4's never-names ring.

Also set `MAX_USD_PER_DAY` below the prepaid credit on each provider, keep
`OPENAI_API_KEY` present (moderation is free and the local list is much blunter),
and put nothing in front of the service that buffers responses — the whole point
is watching it paint.

The honest caveat on the "yes": the residual same-origin desktop (deviation 1)
means a generated desktop script can call `/api/gen` and read kernel state. It
cannot reach any other network endpoint, cannot see a visitor's data because
there is none, and cannot persist anything. For a free, no-login, no-account toy
that is an acceptable v1 risk; it would not be for anything with a user account
behind it.

## 8. What the next session should do first

Fix items 1–4 above as prompt work, then re-bake `cerebras-oss120` alone against
BAKEOFF-2's numbers (`npm run bakeoff -- --engines=cerebras-oss120 --boots=4`,
~$0.13). Nothing else in `engines.json` needs trying until then. `npm run sweep`
is the cheap way to move the desktop numbers: one generation per data point
instead of thirteen.
