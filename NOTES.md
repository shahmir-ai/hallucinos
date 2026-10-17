# hallucinos

A hosted, free, no-login page that boots a **fully hallucinated operating system**. Every visible pixel is written by a language model on demand, and nothing generated is ever cached — reload anything and it is regenerated from scratch. We supply shapes (which apps exist, which affordances each needs) and a kernel that owns geometry, streaming, session state and safety. The browser inside it loads any URL you type and hallucinates the site from the URL alone.

`SPEC.md` is the contract. This file is what was built, how to run it, and where it differs.

---

## Deviations

Every difference from SPEC, one line of reason each.

- **The identity comment is re-emitted canonically, not forwarded byte-for-byte** (interface I1 says "the server strips nothing") — the server has to buffer the head of a boot stream anyway to validate it, and it re-renders the comment from the parsed payload: clamped to the contract's field sizes (a 22 KB `personality` was an input-token amplifier on every later generation) and with `<`/`>` escaped as `\u003c`/`\u003e` so no value can close the comment early with a stray `-->`. A malformed comment is removed rather than forwarded, so nothing scanning from the top can mistake it for the authority.
- **`/api/img` takes an optional `scope` field** beyond I3's `{kind, prompt, seed, session}` — "≤ 4 per app open, ≤ 2 per page" is not expressible from a session id alone. With `scope` (a window id, a navigation id) each app open and each page load is its own bucket; without it they share one, which is the conservative direction.
- **A flagged image prompt gets the same 404 as a missing `FAL_KEY`** — a distinguishable refusal would be a public oracle for "is this string flagged?", which is what SPEC §1.4's silent reroute exists to prevent.
- **`/api/img` also has a whole-session ceiling of 30 images** (SPEC §12.5 caps per boot, per app open and per page, but not per session) — a visitor looping app opens would otherwise spend the day's image budget alone.
- **The mid-stream reroute signal is `<!--os-reroute:{"reason":"moderation"}-->`** (SPEC §12.1 says "a stream sentinel" without naming it) — the kernel throws that document away and asks again; no telemetry sentinel is written, because the document is not finished and must not be reported as one.
- **`gen_id` is returned in an `x-os-gen-id` response header** as well as in the telemetry sentinel (I6 only implies it exists) — the kernel needs it *before* first paint to call `/api/mark`, and the sentinel arrives at the end.
- **`GEN_TIMEOUT_MS` is floored at 1,000 ms** — a misconfigured 50 would make every generation fail, and nothing is a bigger outage than a cap that rejects everything.
- **`cerebras-qwen38` lost its 12,000-token desktop override** with the I7 budget cut — SPEC §12.8 says qwen is out unless the cut tames its verbosity, so it now runs on the same 3,500 as everything else and the next bake-off decides. It is expected to truncate; that is the measurement.
- **`MODERATION_ENDPOINT` and `FAL_ENDPOINT` env overrides exist** (not in SPEC) — they point the two outbound third-party calls at a local fake so the late-reroute path and the image path have real tests. Under `NODE_ENV=test` a real fal call is refused outright: no suite of ours can buy an image by accident.
- **`prompts/user/*.md` exist for all six kinds** (SPEC §5 lists only `system/` files) — the per-request payload belongs in the user turn so the system message stays constant per kind, which keeps the untrusted-input block clearly separated from the rules.
- **Reboot is `os.reboot()` + `[data-os-reboot]`** (SPEC §2.2's runtime list has no reboot; SPEC §4 requires the updater to reboot into version+1) — something had to be named for the updater to call, and both paths are implemented.
- **The kernel computes the next version itself** and hands it to the identity prompt (`prompts/user/identity-lineage.md`), rather than asking the model to increment — SPEC §4 says version+1, and an off-by-one in a hallucinated version string is not detectable.
- **`os.install` takes `{id, name, shape, affordances?}`** (SPEC §2.2 says `{id, shape, affordances}`) — without a display name the Store's "Dowsing Kit" arrives on the desktop labelled `custom:dowsing-kit`, and SPEC §1.2 says the names of apps are the model's.
- **`GET /api/manifest` exists** (not in SPEC §2.1's route table) — the kernel needs the app list before the first generation, and shipping it inside the bundle would make adding an app a rebuild instead of a data change.
- **The desktop is mounted into the top document, not into a sandboxed frame** (SPEC §2.2 wants `default-src 'none'` on every generated document) — the kernel has to read the desktop's hooks and put iframes inside its window template, which is impossible across an opaque origin. Residual risk, stated plainly: a generated desktop script is same-origin with the kernel and can call `/api/gen`, read kernel state and reach `window.os`. The page CSP still blocks all other network access, markup that navigates away (`meta[http-equiv]`, `link`, `base`, `iframe[src]`, `object`, `embed`) is stripped before mounting, and *apps and pages* — everything the fake internet produces — are in opaque-origin sandboxes with `default-src 'none'` as SPEC requires. Closing it properly means moving the kernel's own fetches into a separate worker/frame; that is a v2 change, not a patch.
- **Generated documents are sandboxed `allow-scripts allow-forms`, and their CSP gains `form-action 'none'`** (SPEC §2.2 says "`allow-forms` only where needed" and does not list `form-action`) — it is needed everywhere: a sandbox without it blocks a form submission *before* the submit event fires, so the runtime's interception never runs and a search-shaped home page cannot search. `form-action 'none'` is the backstop that keeps an un-intercepted submit from navigating anywhere. `allow-same-origin` is never granted.
- **Contract validation is tokeniser-based, not `DOMParser`-based** (SPEC §3.2 says "runs on the parsed document") — the same validator runs in the kernel and in node. It strips comments, `<script>`/`<style>`/`<textarea>` bodies and the kernel's own telemetry sentinel, and only reads attribute names inside opening tags, so a CSS selector or a script string can no longer satisfy the contract. The **authority** for what gets injected is a second check against the live DOM after mounting (`kernel/inject.ts domMissing`).
- **Terminal commands and message text never reach the server**, so SPEC §8's requirement to moderate them is unimplementable as written — `prompts/apps/terminal.md` and `messages.md` tell the model to write the responder as inline script, so what you type there is handled inside the sandboxed frame and generates nothing. Everything that *does* reach a prompt is moderated (URL, address bar, referer, history, every string nested in params, Store-authored shapes). If a future terminal round-trips to `/api/gen`, its text goes through the same moderation call and this line goes away.
- **Extra env beyond SPEC §2.1's caps**: `MAX_USD_PER_DAY` (SPEC §1.8's $25 ceiling, enforced), `TRUSTED_PROXY_HOPS`, `CAPS_STATE_FILE`, `MODERATION`, `DEFAULT_ENGINE`, `IP_SALT`/`MOD_SALT`, and `MOCK_BREAK`/`MOCK_DELAY_MS` for the test servers.
- **`voice.md` states the token budget to the model** and spells out a forbidden-vocabulary list — engines truncate mid-document otherwise, and cheap fast engines break character with "generated"/"simulated" unless the exact strings are banned.
- **`/bakeoff` no longer boots, so the harness and `e2e/bakeoff.spec.ts` use `/bakeoff/run?engine=`** (SPEC §12.6 moved the boot behind a click) — `scripts/run.mjs` is updated; the e2e spec's three `/bakeoff?engine=` navigations belong to the kernel/e2e builder and need the same one-word change.
- **`reviews/BAKEOFF-1.md` is a partial judging run and says so in its first line** (SPEC §7 wants five boots per engine across every engine) — the machine it ran on was carrying other work, a boot with four apps and six page loads takes minutes, and one page load hit the harness's own 180-second ceiling. Two engines have full boots, six have contract sweeps only, and the report carries the exact command to finish it. `scripts/bakeoff.mjs` now writes its report on `SIGINT`/`SIGTERM` rather than throwing an interrupted run away, which is the fix for the underlying problem. The contract number SPEC §10.3 actually gates on is in `reviews/SMOKE-1.md` and is complete for both reference engines.
- **Bake-off reports are `reviews/BAKEOFF-<n>.md`, not always `BAKEOFF-1.md`** (SPEC §7 names one file) — the runner takes the next free number so a judged run can never be overwritten by the next one. `reviews/BAKEOFF-0-mock-rehearsal.md` is the harness proving itself on the mock engine at $0; the first real run is `BAKEOFF-1.md`.
- **The bake-off does six page loads per boot, not five** (SPEC §7 lists five URLs) — the browser app opens on its own google-shaped home, and that home is recorded as the first visit rather than thrown away; the five SPEC asks for follow it. Re-navigating to `google.com` would only have bought a second identical page.
- **A CSP refusal is not counted as a broken render** (SPEC §7 counts "a JS error on load") — a generated document reaching for the network logs a console error, which is the sandbox working. Those are counted and reported in their own column; only real script failures, blank frames, unstyled bodies and documents that never arrived count as broken.
- **engines.json prices and model ids are verified only for `openai-small` and `anthropic-haiku`** — the fast engines have no keys yet; their entries are flagged UNVERIFIED in `engines.json`'s own `_notes` and must be re-checked when a key lands (no code change, only `.env`).
- **Three OpenRouter engines pinned to Groq** (`or-oss20-groq`, `or-oss120-groq`, `or-oss20-fast`) stand in for SPEC §6's `groq-oss20` / `groq-oss120` — there is no Groq developer plan, so Groq is reached with OpenRouter's provider routing (`{provider:{order:["Groq"],allow_fallbacks:false}}`, and `{provider:{sort:"throughput"}}` for the third). The two direct Groq entries stay in `engines.json` and hide themselves until a `GROQ_API_KEY` appears.
- **`cerebras-qwen38` gets a 12,000-token desktop/repair cap** instead of SPEC §5's 7,000 — SPEC §5 allows per-engine `max_tokens` overrides, and this engine needs one: at 7,000 it hit `finish_reason: length` on five of six desktops and lost the taskbar and both templates to truncation, which the contract validator then reported as missing hooks. It is still the only engine that fails the contract gate; see `reviews/BAKEOFF-1.md`.
- **`scripts/desktop-sweep.mjs` (`npm run sweep`) exists** (SPEC §9's script list has dev/build/start/test/test:e2e/bakeoff) — SPEC §10.3's gate is a number about desktop generations only, and measuring it through a full bake-off boot costs thirteen generations and minutes of wall clock instead of one generation. Every prompt change in `reviews/SMOKE-1.md` was decided with it.
- **`prompts/system/desktop.md` now requires the launchers to be reachable without the page scrolling** — a legibility requirement (SPEC §2.2 and `voice.md` §9 already ask for no page scrolling), added because a real boot put all sixteen in one column and the last three ran off the bottom of the screen. It still says nothing about what the launcher area looks like.

### Integration deviations (2026-09-17, `reviews/INTEGRATE-1.md`)

- **`[data-os-clock]` is validated with no identity in hand** (the archetype deviation below says a hook the server cannot evaluate must not count as missing) — the clock is not one of those: it needs no identity, and checking it only alongside the archetype meant the server logged `contract_ok: true` for a desktop with no clock in it at all. The archetype *value* stays conditional; the clock does not.
- **`mountDesktop()` carries the generated `<html>`'s own `data-*`/`class`/`style` attributes onto the top document** (SPEC §2.2 says nothing about `<html>`) — I5 allows `[data-os-archetype]` on `<html>` as well as `<body>` and the text validator accepts it there, so without this the live-DOM check disagreed with the validator and patched a hook the model had actually sent. The kernel's own state flags (`data-os-ready`, `data-os-contract`, `data-os-desktop-ms`, `data-os-archetype-patched`) are never overwritten.
- **A mark that arrives before its generation finishes is held and folded into the line when it is recorded** (I6 implies a patch of an existing line) — the boot screen paints *before* the boot stream ends on every real engine, so §12.1's headline number was the one number telemetry dropped. (The `held: true` stdout line this originally added is gone — see the audit-fix deviations below; the number now rides on the generation's own line.)
- **A bare hostname passed to `os.navigate()` is treated as a new site, not a relative path** (SPEC §2.2 just says `navigate(url)`) — a generated page calling `os.navigate('reddit.com/r/cats')` was asking the fake internet for `https://<the site you were on>/reddit.com/r/cats`. The kernel's own `normalizeUrl` already did this for a typed address; the injected runtime now agrees with it. A real relative reference still resolves relatively, and a first path segment ending in a file extension stays a path.
- **Icon-sheet cells are inset 7% on every side** (SPEC §12.5 says "the kernel slices cells by `background-position`") — flux draws the 4×4 grid with gutters and stray rules, so slicing at exact quarters puts pieces of the neighbouring icons inside every launcher. The sheet prompt now asks for cells touching edge to edge as well.
- **The kernel adds one text-shadow rule to launcher labels when a wallpaper image lands** (SPEC §1.2: the shell's look is the model's) — the model styled those labels for a background it never saw, and the wallpaper is the kernel's own injection, so their legibility on top of it is the kernel's to insure. One rule, scoped to `[data-os-desktop] [data-os-app]`, no colours and no layout.
- **`data-os-launchers-offscreen` on `<html>`**, counted after mount and logged — §12.3 wants every launcher reachable without the page scrolling, and a single clipped column is the recurring failure (5 of 16 off screen on a real boot). Measured and reported, never repaired: rearranging the model's desktop is not the kernel's business.
- **The mock desktop fixture ships the §12 hooks** — a ticking `[data-os-clock]`, `[data-os-archetype]` from the identity, `data-os-img="wallpaper"` and per-app `data-os-icon="<id>"`. Without them the per-app icon path, the wallpaper slot and the archetype match were exercised nowhere on mock and every mock boot went down the patch path instead. `MOCK_BREAK=desktop-always|desktop-once` drops them, so the patch path keeps its tests.
- **`bootOnce()` races the kernel's error/queue screen** as well as `data-os-ready` — an engine answering 403 (Inception did) otherwise cost the harness 120 s per boot and produced nothing but a Playwright timeout.

### Bake-off harness deviations (2026-09-17, `reviews/BAKEOFF-2.md`)

- **The bake-off server runs with `GEN_PER_IP_PER_HOUR=100000`** (`--percap=` to change it; SPEC §2.1 sets the cap at 60) — SPEC §7's protocol costs 13 generations and 2 images per boot, so four boots exhaust the production cap and every later boot is served the kernel's queue screen instead of an OS. It silently cost a whole judging run: two engines looked dead and were only rate-limited. The daily USD cap (§1.8) is untouched.
- **One app open or page load is abandoned after `--step=45` seconds** (the harness used to allow 180) — §12.1's targets are 2.5 s, so nothing informative happens after the first minute, while a failing engine used to burn ten dead minutes per boot.
- **A launcher is opened with `mousedown` and then `click`** — that is what a real pointer does, and §12.1's speculative generation hangs off `mousedown`; a click-only harness measured a path no visitor takes, and the kernel's app first-paint mark only carries a gen id on the speculative path.
- **`frameChars` takes a 1.5 s element timeout and the boot-paint poll has a 130 s deadline that also ends on the kernel's error/queue screen** — the Playwright context default is 20 s, so polling for a boot iframe that does not exist (a boot that failed) cost 20 s per iteration and could poll for hours.
- **Known and not yet fixed: screenshots are not run-numbered.** Report files are (`BAKEOFF-<n>.md`), shots are not: a new run overwrites `reviews/shots-bakeoff/<engine>/<boot>/` in place, so BAKEOFF-1's shot references now point at BAKEOFF-2's pictures. They should be written under `shots-bakeoff/<n>/<engine>/<boot>/`.

### Kernel deviations from SPEC §12 / the pinned interfaces (2026-09-17)

- **`data-os-ready` now means *revealed*, not *mounted*** (SPEC §12.2 says the swap happens when the desktop is interactive; §12.3 adds the 2.5 s floor) — the desktop is mounted and wired behind the boot overlay and the overlay is lifted afterwards, so the attribute moved with the reveal. `data-os-desktop-ms` carries the earlier, interactive-at number.
- **The boot overlay lives on `<body>` with `position:fixed;z-index:2147482000`**, not inside `#os-root` — a fixed element creates a stacking context, so an overlay inside it could not stay above a desktop mounted into the body.
- **A reboot's name and version are enforced by the kernel**, overriding whatever the boot stream's identity comment says (SPEC §4's lineage). Same reason as the existing version deviation: a renamed machine in a hallucinated string is not detectable.
- **The wallpaper falls back to `[data-os-desktop]`** when the model never declared `[data-os-img="wallpaper"]`, and a launcher's bare `[data-os-icon]` is filled when the per-app `[data-os-icon="<id>"]` is absent (I3 names only the explicit slots) — the image is already bought and paid for.
- **The fallback clock ticks** (SPEC §12.3 requires a ticking clock; I5 says patch bare elements) — a patched-in dead clock reads as a broken OS.
- **The archetype check is optional in the text validator** (`validateDesktop(html, appIds, archetype?)`) and mandatory in the live-DOM check — the server validates the same text with no identity in hand, and a hook it cannot evaluate must not count as missing.
- **Speculative generations replay their buffer in one write** when they finished before being claimed (I4) — progressive painting is traded for the speed ruling in exactly that case.
- **`e2e/` gained a `MOCK_DELAY_MS=250` server on :8776** (playwright.config.ts) — proving that interactivity is attached mid-stream needs a document that is demonstrably unfinished when it is clicked.
- **Photos / faces / map images (§12.5) are not implemented** — this session's kernel brief was the wallpaper and the icon sheet; per-app and per-page images need a request path out of a sandboxed document.

### Deviations from the safety + kernel audit fixes (2026-09-17, `reviews/AUDIT-FIXES-1.md`)

Fourteen findings applied; the detail, the repro and the proof for each is in
that file. What changed that SPEC does not describe, or describes otherwise:

- **`/api/img` has its own in-flight ceiling, `MAX_CONCURRENT_IMG` (default 6)** (SPEC §2.1 names one concurrency limit) — image calls were reserving against `MAX_CONCURRENT_GEN`, so twelve slow wallpapers took `/api/gen` down site-wide and every visitor got the kernel's over-capacity screen while nothing was generating. Both lanes still hold against the one `MAX_USD_PER_DAY`.
- **`IMG_TIMEOUT_MS` default drops 20,000 → 10,000** — PARTIAL against the finding, which asked for ~5,000 on the grounds that schnell answers in ~0.8 s. Measured on the real endpoint instead: schnell itself takes **~2.6 s**, and then the server downloads the bytes (496 KB for a wallpaper, 931 KB for an icon sheet) — **6.6 s and 4.9 s end to end**. A 5 s ceiling killed the wallpaper on every real boot, and because a failure after fal's 2xx is now billed, the day's USD total looked exactly the same. 10 s covers the measured distribution with headroom, and the lane separation above is what actually protects `/api/gen`.
- **`POST /api/gen` accepts `rerouted: true` from the client** (SPEC §3.4 has the server decide) — the server derives `rerouted` from the local list only, so the kernel's retry after a mid-stream `<!--os-reroute-->` would lose the same race with the remote call forever. It is OR-ed with the server's own verdict, so a client can only ever make a page *more* wholesome, and the server skips the remote call when it is already set (otherwise the retry reroutes again, for ever).
- **A truncated document that has already painted is kept, not regenerated** (I1 says one regeneration on an error sentinel) — `sink.reset()` is `document.open()` on a document the visitor is looking at, which is exactly what SPEC §12.2 forbids. Only an *unpainted* sink is reset and re-asked; a painted one is finished, the truncation is logged, and `GenError` now carries the partial text and the gen id so it can still be reported. A **rerouted** document is discarded whatever it has painted: it was generated from the flagged string.
- **`/api/identity-seen` and `/api/mark` require a `gen_id` this process issued** (I2 and I6 describe neither as authenticated) — both are unmetered global state. The name ring is spliced into every later boot prompt, so it takes a boot/identity ticket, spends it on use (one name per generation), and moderates the name; `/api/mark` accepts only ids the server issued, writes each field once, and drops an unknown id without holding it (client gen_ids are accepted verbatim on `/api/gen`, so an ungated hold pre-poisons a future generation). Both get a per-IP hourly bucket of their own — `NAME_PER_IP_PER_HOUR` (60) and `MARK_PER_IP_PER_HOUR` (600) — because they buy no tokens and must not eat the generation cap.
- **The `held: true` mark line is gone** (it was an INTEGRATE-1 deviation) — an early mark is now held silently and appears in its own generation's line; logging the misses made the route a log-flood amplifier.
- **Every refusal writes a telemetry line and `/api/stats` carries `refused` + `refusals`** (SPEC §2.1 logs one line per *generation*) — all four 429 paths used to return before `telemetry.record()`, which is the blindness that voided BAKEOFF-1. A refusal that spent nothing stays out of the per-engine aggregates; one that had already been paid for (an image whose late moderation hit after fal billed) still aggregates.
- **`/api/gen` logs `contract_ok: null, aborted: true` when the client goes away mid-stream** — an engine that ends its iterator cleanly on the signal otherwise fell through to the contract validator, and every dropped speculative document landed in the bake-off's headline contract-miss rate.
- **`interactive_ms` for an app or a page is the FIRST chunk, and a new `complete_ms` is the end of the stream** (I6 names one field) — §12.2 rules that interactivity attaches during streaming, so the field labelled interactive was really total stream duration for two of the four kinds while meaning mounted-and-wired for the desktop. Desktop and boot are unchanged.
- **App and page gen ids are minted before the request, not read off the stream** — `mark()` returns early on an empty id, so §12.1's app and page first paints were only ever recorded for the pre-buffered speculative replay. BAKEOFF-2's "page first paint" column is that replay, not a page load.
- **The image session ceiling is charged to the ip hash, and the client's `session` is only a sub-key** (the existing `scope` deviation above assumed the session id was trustworthy) — rotating `session` per call got one IP 44 images against a documented 30. Two tabs on one machine still get their own per-scope buckets.
- **`SPEC_TTL_MS` is 10 s (was 60) and `gen.start()` drops the previous untaken prefetch of the same kind** — PARTIAL against the finding, which asked for "a couple of seconds": the browser's home page is claimed only after the browser chrome finishes streaming (~1.6–2.5 s on `cerebras-oss120`), so a 2 s TTL would miss that claim on every open and buy a second page generation instead of saving one. The drop-on-next-mousedown rule is what fixes the reported repro (16 scrubbed launchers bought 16 finished documents; now one).
- **`injectMissing`'s fallbacks and `#os-img-legibility` are removed by `unmount`** (SPEC §3.2 says nothing about teardown) — they are appended to `document.body` after the mount, so they were not in the `Mounted` record: a reboot left the dead machine's injected taskbar in the document, `readHost()` picked it, and `domMissing()` then recorded **no taskbar miss at all** for the second boot — the number SPEC §10.3 and the bake-off gate on. The fallback clock is also patched *after* the taskbar now, so §12.3 gets it in the bar.
- **An image fal rendered and billed but we could not keep is booked at $0.003** (SPEC §12.5 counts image cost against the day cap) — `ImgError.billable` is set once fal answers 2xx, so `empty`, `too-big`, a failed binary fetch and a timeout during the download are charged; a non-2xx and a timeout before the response are free.
- **`scripts/fake-mod.mjs` exists, and `playwright.config.ts` starts three more servers** (8777 with its remote moderation pointed at the fake on 8778, and 8779 with `MOCK_BREAK=app-error-once`) — the late-reroute path and the error-over-a-painted-document path cannot be reached without a remote that answers late and an engine that dies half way through. `MOCK_BREAK=app-error-once` is a new mock break mode.

### v0.5 server deviations (2026-09-17 night, `reviews/SERVER-v05.md`)

- **`DEFAULT_ENGINE` naming a real keyed engine now takes `/` off the router** (T1/D6). It was honoured only for a mock, so the deploy recipe in DEPLOY.md's own table did nothing and every `/` boot was hedged (HANDOFF-6 §2, reproduced three times). `/api/engines` gained `pinned`, the plain kernel page gained `<body data-engine>`, and the `listening` line now prints `default_engine`, `pinned` and `hedge_after_ms`. The kernel half (`chooseEngine` preferring `auto` on `/` whatever the default said) is another session's and was landing in the same tree as this pass: `e2e/routing.spec.ts` now tests both witnesses directly. One live consequence: every e2e server runs `DEFAULT_ENGINE=mock`, so `/` there is genuinely pinned, and a test that fakes `/api/engines` into advertising `auto` has to say `pinned: null` too — a `page.route` interception cannot change `<body data-engine>`.
- **Three hedge triggers instead of two** (T1): `HEDGE_AFTER_MS_BOOT=0` is now the **boot only**, `HEDGE_AFTER_MS_DESKTOP=600` is new, and `HEDGE_AFTER_MS=900` keeps app/page/repair/identity. SPEC §12.1 groups boot and desktop as "the first second"; they are not the same bet, and sharing one trigger meant every routed boot bought two desktops (D6). The triggers are read **per request** now, not at module load, so a test can set one around one call.
- **`IMG_KINDS.wallpaper` goes back up to SPEC §12.5's 1024x576** (T3), against IMG-LATENCY-1's 768x432. The 5-7 s that argued it down was mostly our own second round trip for the bytes, which `sync_mode` removed (IMG-LATENCY-2). Still one billing unit.
- **`IMG_TIMEOUT_MS` code default 18,000 → 20,000** (T3).
- **A new image kind, `tiles`, with a `theme`** (T2): one 768x768 4x4 sheet per document, sliced by the runtime exactly as `faces` was, in five themes (`faces`, `posters`, `products`, `thumbnails`, `covers`). SPEC §12.5 names only "a faces sheet per contact-shaped page"; the arithmetic that made that worth doing — sixteen pictures for $0.003 — is not about faces. `kind: "faces"` is kept as an exact alias (same size, same bucket, same slicing) so a kernel that has not shipped the field keeps its pictures. Its prompt has **two authors**: the theme clause and the grid geometry are the server's, the set description is the document's own `data-os-prompt`, and the palette is the machine's **for an app only** — a page receives no identity (SPEC §3.1). An unknown theme is a 400, not a fallback.
- **`/api/mark` accepts `contract_patch`, and `/api/stats` counts it per engine as a rate** (T4). `contract_ok` says whether the hooks were present; this says whether they were **usable** — the architect's D2 (a window whose `[data-os-close]` was found by the validator and invisible on screen). The denominator is the contract-checked generations, not all of them, so an engine that served more pages does not look better. The patch kinds are an allowlist (`chrome`, `task`, `label`, `hooks`, `archetype`, `clock`, `other`) because the field arrives over HTTP; the **kernel half of T4 is not in this pass** (`kernel/**` is another session's).
- **The judged harnesses fail loudly** (T3): `scripts/run.mjs` records an app open that produced no window, or a window that never inked, prints the kernel's `window.__osTrace()` excerpt, puts a Failures section in the report and **exits non-zero**; `bootOnce` attaches the trace to the boot record on any boot failure. HANDOFF-5 lost four of four windows on boot A and the run exited 0 with "0 chars" in the table. `--viewport` (default `1440x900`, `mobile` = 390x844, or `WxH`) is new, and below 768 px the context is a touch device — SPEC §2.2's mobile geometry had never been driven by any harness.
- **`scripts/hedge-probe.mjs --triggers=0,1200`** runs one server per trigger value on consecutive ports and alternates the requests, because the trigger is configuration and cannot be a request field. It is how D1 was measured, and it reports p90 as well as the median.

### v0.6 server deviations (2026-09-18, `reviews/SERVER-v06.md`)

- **`HOST` is new, default every interface** (see "Test it on your phone"). The process already bound the node wildcard; this only makes it switchable and prints it on the `listening` line. The default is deliberately *not* the literal `0.0.0.0`, which would drop IPv6 and with it `localhost` on macOS.
- **One retry on a fast image failure, and the provider's error body in the log** (HANDOFF-7 §11.7). `error: "img upstream"` was every dead picture's whole account of itself, so 7 photo deaths in 90 were unexplained for a pass. Image failures now carry `img_err` and `img_status` (stdout only — the client still reads `image unavailable`), and a failure that arrived inside `IMG_RETRY_MAX_MS` (6 s), was never billed, is not a 429/401/402 and does not read as a refusal of the content is retried **once** with a simplified prompt (`simplifyImgPrompt`: the first two clauses, plainer). Single pictures only — `tiles` and `icons` are excluded, because the grid clauses the kernel's quarter-slice depends on do not survive the simplification.
- **R4 in the tile prompts**, and the measurement is in the review rather than a claim here: the sheet prompt lost `plain background` (a baseline sheet drawn with it came back with white margins inside every slice line) and gained per-cell coverage, the invented-and-anonymous clause, and the named display furniture (`no shelf, no rack, no display stand, no wall of frames` — stating coverage at *sheet* level bought a photograph of a shop's shelving unit). The document-side half is a bounded tile box (`max-width` per theme, a fixed `aspect-ratio`) and the first row of a grid on the first screen, in `prompts/system/page.md` and `prompts/apps/store.md`. **4×4 compliance is seed-dominated at this sample size and the anti-landmark clause is unproven** — twelve real sheets, table in the review.
- **`prompts/system/desktop.md` asks for the time and the date as two elements with a visible gap**, in the archetype skeletons, in the rule, in the hook list and in the closing checklist. HANDOFF-7 §4 measured the jam on 1 of 4 bars and named the pair: it is between the time and the date, not between the OS name and the clock.

## What is where

```
SPEC.md          the contract
server/          Hono streaming proxy: prompts, moderation, caps, telemetry
kernel/          the runtime: geometry, streaming into frames, session, contract
kernel/injected/ the script injected into every generated document (window.os)
prompts/         everything the model is ever told (see prompts/README.md)
engines.json     engines + prices + per-kind token caps
manifest.json    the 16 app ids and their one-line shapes
test/  e2e/      vitest (unit) and playwright (browser)
scripts/         build, dev, smoke (SPEC §10.3), bakeoff (SPEC §7)
reviews/         smoke and bake-off reports and screenshots
```

## Running it

```bash
npm install
cp .env.example .env        # keys optional: the mock engine needs none
npm run dev                 # http://localhost:8790 on the mock engine
npm run build && npm start  # what Railway runs
```

- `/` — the OS. Black, empty, boots immediately.
- `/bakeoff` — the engine **landing page** (SPEC §12.6): every keyed engine with its price and whatever the last `reviews/BAKEOFF-<n>.md` measured, and a Boot button each. It boots nothing.
- `/bakeoff/run?engine=<id>` — that Boot button: the OS plus the telemetry HUD.
- `?engine=<id>` — pick an engine for this boot.
- `/api/stats` — today's generations, tokens, spend, refusals by reason, and how close the caps are.
- `POST /api/gen` — the one streaming route. `kind=boot` answers with the identity comment first (SPEC §12.1); every response carries `x-os-gen-id`.
- `POST /api/img` — one `fal-ai/flux-1/schnell` image as a `data:` URI (SPEC §12.5). 404 without `FAL_KEY`, and the kernel keeps its SVG fallback.
- `POST /api/identity-seen` — the kernel reports the OS name it just parsed, against the `gen_id` of the boot it came out of; the server keeps the last 200 as "never use these" (SPEC §12.4). The ticket is required, spent on use, and the name is moderated.
- `POST /api/mark` — the kernel reports first paint, interactive and complete against a `gen_id` the server issued. Each field is writable once.

The server half of SPEC §12 is written up in **`reviews/SERVER-v01.md`** — the
wire format of each interface, what the caps actually are, and what has never
been run against a real provider.

**`reviews/AUDIT-FIXES-1.md`** is the safety + kernel audit applied: the image
lane that was taking `/api/gen` down, the `<!--os-reroute-->` the kernel was
ignoring, the painted documents it was resetting, the four 429 paths that wrote
nothing down, and the two unauthenticated bookkeeping routes.

**`reviews/HANDOFF-3.md`** closes v0.1: the clean-clone verification (195 vitest
+ 51 playwright green, `npm ci && npm run build && npm start`), the §12.1
numbers from a final real boot on `cerebras-oss120`, bake-off #2's per-engine
table, the ~$0.03 cost of a session, the known issues in rank order, and the
deploy-readiness call (**yes**, with three variables that must be set).

`reviews/INTEGRATE-1.md` is where the three halves were put together and
measured on real engines: the §12.1 numbers on `cerebras-oss120` (boot paint
~1.3 s, desktop interactive ~2.5 s, apps ~1.6 s, pages ~1.8 s), the cost of a
boot ($0.030 including two $0.003 images), the eight seams that were fixed, and
the four things still open — one of them being that **`mercury-2.5` answers HTTP
403 to every call, `/v1/models` included**, so SPEC §12.8's challenger cannot be
judged with the key in `.env` today.

`npm run dev` forces `DEFAULT_ENGINE=mock`, so it never spends. `npm start` does not: with keys in `.env` it defaults to the **first keyed engine in `engines.json` order**, which today is `cerebras-oss120`. Every engine id and price in `engines.json` has since been verified against the live provider APIs (see its `_notes`), and BAKEOFF-2 chose that engine on measured numbers — but set `DEFAULT_ENGINE` explicitly anyway, because which engine every anonymous visitor gets should not fall out of file order.

### Test it on your phone

The dev and play servers listen on **every interface**, so the phone in your
pocket can boot the same build over the Wi-Fi you are both on — no deploy, no
tunnel, no certificate.

```bash
npm run dev                  # or: node dist/play.js
ipconfig getifaddr en0       # your laptop's LAN address, e.g. 192.168.18.113
```

Then open `http://<that address>:<port>/` on the phone — `:8790` for
`npm run dev`, `:8799` for the play server. Both are on the same Wi-Fi or
nothing works: this is your laptop answering, not the internet.

- **Verified, both directions** (2026-09-18, `reviews/SERVER-v06.md`): with no
  `HOST` set the process binds the node wildcard — `lsof` reads `TCP *:8781
  (LISTEN)`, one IPv6 socket that accepts IPv4 too — and `curl
  http://192.168.18.113:8781/healthz` from the LAN address answers `200`. With
  `HOST=127.0.0.1` it binds `TCP 127.0.0.1:8781` and the same LAN request gets
  nothing, which is the off switch.
- **`HOST` is a variable, and its default is every interface, not the literal
  `0.0.0.0`.** Binding that string would drop IPv6, and `localhost` resolves to
  `::1` first on macOS — which is what the e2e suite and every `curl localhost`
  in this repo use. So: unset = IPv4 + IPv6 everywhere (what a phone needs, and
  what Railway needs), `HOST=127.0.0.1` = loopback only.
- The boot log says which: `{"event":"listening","host":"*"}`, or the address you
  pinned.
- **Nothing is deployed.** There is no hosted hallucinos; this is the only way
  to see it on a phone today, and it lives as long as the terminal does.
- **Every cap still applies**, because it is the same server: `MAX_USD_PER_DAY`
  (25), `GEN_PER_IP_PER_HOUR` (60), `MAX_GEN_PER_DAY`, the image budget's 30 a
  session and 4/4/2 a document. The phone and the laptop come from the **same
  LAN address as far as the process is concerned** only when they are behind one
  NAT — on the same Wi-Fi they are two different local IPs and therefore two
  different per-IP buckets, so testing on both spends from one day counter but
  two hourly ones. `npm run dev` pins the mock engine and spends nothing at all;
  pictures still cost $0.003 each if `FAL_KEY` is set.
- The phone is where the tile sheets look best and where the windows look worst
  (`reviews/HANDOFF-7.md` §8) — which is the reason this section exists.

### Tests

```bash
npm test          # vitest: 195 tests — contract, caps, moderation, prompts, streaming, telemetry, the /api/gen surface
npm run test:e2e  # playwright: 51 tests — builds, then boots nine mock servers and drives a real browser
```

The e2e suite blanks every provider key, so it can never spend money. It runs
nine servers of its own: the main one, a rate-limited one, one that always breaks
the desktop contract, one that breaks it once (the repair path), two slow ones
(60 ms and 250 ms per chunk, so a mid-stream click can be aimed at), one whose
window template collapses its content box, one whose remote moderation points at
`scripts/fake-mod.mjs` (port 8778) so a verdict can land *after* a stream has
started, and one whose first app document dies half written
(`MOCK_BREAK=app-error-once`). It covers the SPEC §10.2 list: boot → contract → browser → google-shaped page → search → results → click a result → page; calculator, notes, store + install; reload regenerates; the moderation reroute; the caps 429 and the queue screen; `/api/engines` listing only keyed engines; the repair pass and the bare-injection fallback; the `/bakeoff` engine picker and HUD the bake-off harness reads; and **zero network from any generated frame**, asserted by intercepting every request the browser makes while the mock's hostile probe (an external `<img>` plus `fetch`/`Image`/`XHR` to `beacon.example.com`) runs in every document.

### Real engines

```bash
npm run sweep   -- --engines=openai-small --n=10       # SPEC §10.3's gate, one generation per data point
npm run smoke   -- --engines=anthropic-haiku,openai-small --desktops=10  # SPEC §10.3 → reviews/SMOKE-1.md
npm run bakeoff                                                          # SPEC §7    → reviews/BAKEOFF-<n>.md
npm run bakeoff -- --engines=cerebras-oss120,or-oss20-groq --boots=5
npm run bakeoff -- --engines=mock --boots=1 --report=BAKEOFF-0-rehearsal  # $0, and does not burn a judged number
node scripts/integrate.mjs --engines=cerebras-oss120 --budget=2            # SPEC §12 seam check → reviews/INTEGRATE-1.md
```

**`scripts/integrate.mjs`** is the seam instrument: one boot per engine through
`/bakeoff/run`, four apps and five page loads, and the checks no single builder
could make from their own side of the pinned interfaces — that the identity
comment named the machine (I1), that the wallpaper and the icon cells reached the
DOM as `data:` URIs and how many image calls the boot bought (I3), that
`[data-os-archetype]` matches the identity and the clock really ticks (I5), and
that the kernel's first-paint marks landed on their telemetry lines (I6). It
writes screenshots and a JSON result to `reviews/shots-<label>/<engine>/`
(`--shots=<label>`, default dated; `--out=` overrides the JSON path), and
reports `NO BOOT` with whatever the kernel's error screen said rather than
hanging when an engine is down. The measured numbers are in
**`reviews/INTEGRATE-1.md`** and, after the audit fixes,
**`reviews/AUDIT-FIXES-1.md`**.

> The shots directory used to be `reviews/shots-v01/<engine>/` with fixed
> filenames, so a second run overwrote the first run's pictures in place — it
> ate INTEGRATE-1's `cerebras-oss120` screenshots before it was noticed, and
> `reviews/shots-v01/` is untracked. Hence the label.

**`npm run sweep`** is the cheap instrument: N desktop generations straight at
`POST /api/gen`, no browser, no apps, no pages, reading `contract_ok` and the
validator's miss list out of the telemetry sentinel. Three fixed identities
rotate so an engine is never judged on one mood, and `DUMP=<dir>` writes every
document out, which is how a miss gets diagnosed instead of guessed at. It is
what `reviews/SMOKE-1.md`'s before/after column was measured with.

Both drive the real kernel in a real browser and take every number from the server's own stdout telemetry line, so a report cannot disagree with the logs. Both take `--budget=<usd>` and stop when they reach it.

**Every browser runner takes `--viewport`** (T3): the default is `1440x900`,
`mobile` is `390x844`, and `WxH` is taken literally. Below 768 px the browser
context is a real touch device (Android UA, touch points), so SPEC §2.2's
mobile geometry — every window full-size, no dragging — and §12.3's launcher
grid can be judged at phone width. Nothing had ever driven them there.

**And every browser runner now fails loudly.** An app open that produced no
window, a window the kernel never registered (`windowId` null), or a window
that exists and never inks is recorded with an excerpt of the kernel's own
`window.__osTrace()`, printed as it happens, given a **Failures** section in
the report, and **exits the run non-zero**. HANDOFF-5's verification boot A
lost four of four windows and the run exited 0 with "0 chars" in its table;
that is the hole this closes.

```bash
npm run bakeoff -- --engines=mock --boots=1 --viewport=mobile   # §2.2's mobile geometry, $0
node scripts/hedge-probe.mjs --n=10 --kind=boot --engine=auto --triggers=0,1200   # T1/D1
```

**The bake-off** (SPEC §7's judging protocol, automated) starts its own server on a free port and picks the engine with `/bakeoff/run?engine=`, exactly as a visitor who clicked a Boot button on `/bakeoff` would. With no `--engines` it judges every keyed non-mock engine in `/api/engines`. Per boot it does identity → boot screen → desktop, then opens `browser`, `calculator`, `notes` and `store`, and inside the browser loads its google-shaped home, searches "best pizza in town" through whatever search box the model built, clicks the first result, then `reddit.com/r/cats`, `netflix.com` and `en.wikipedia.org/wiki/Moon`. It records, per generation, `contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, tokens and `usd` from the server's stdout, and photographs the HUD at every step as a second witness; per boot, time to boot-screen first paint, time to desktop ready, and broken renders (blank frame, unstyled body, JS error on load, document that never arrived). Screenshots land in `reviews/shots-bakeoff/<engine>/<boot>/<step>.png`. Flags: `--engines=`, `--boots=` (5; also a positional list — `--boots=5,5,3` gives
the first two engines five boots and the rest three), `--apps=`, `--query=`,
`--budget=` (15), `--port=`, `--moderation=`, and `--report=<basename>` to write
`reviews/<basename>.md` instead of taking the next free `BAKEOFF-<n>` — rehearsals
and prompt-iteration runs use it so they cannot burn a judged run's number.
`Ctrl-C` (or `SIGTERM`) writes the report for the engines that finished and
exits, so a long run that has to be given back is not thrown away.

The report ends with a **funniness and variety** section the harness deliberately leaves blank: names, taglines and shot paths per boot, and a scorecard for a human. Taste is not a number this thing can produce.

## What the kernel repairs

SPEC §2.2 gives the kernel geometry, and two of its repairs exist because a real
engine broke them, not because they were designed in:

- **A collapsed window.** The window chrome is the model's, and a template that
  sizes `[data-os-content]` with neither `flex` nor a height collapses it to
  zero. The frame still mounts, the document is still generated and paid for,
  and the window is a title bar with nothing under it — which is what every
  `cerebras-oss120` window did in `reviews/BAKEOFF-1.md`. `fitContent()` measures
  the content box once the window is in the document and, only when it really is
  collapsed, makes it fill what is left of the root. A template that sized itself
  correctly is not touched; both halves are asserted in `e2e/geometry.spec.ts`
  against the `MOCK_BREAK=content-collapse` server.
- **Missing hooks**, as SPEC §3.2 requires: one repair generation, then bare
  unstyled elements injected and `contract_ok=false` recorded.

## Adding an app

1. Add the id and a one-line shape to `manifest.json`.
2. Write `prompts/apps/<id>.md` — shape, required hooks (if the kernel needs any), two or three seeds. Never a design.
3. That is all. The desktop prompt demands a launcher for every id in the manifest, and `system/app.md` renders the new file as `app_shape`.

If the new app needs a hook the kernel must find, add it to `kernel/contract.ts` (`validateApp`) and to the injection fallback in `kernel/injected/runtime.ts`.

## Safety and cost, as built

- **Moderation** (SPEC §1.4, §8): `sexual` and `sexual/minors` only, via `omni-moderation-latest` when `OPENAI_API_KEY` is set, falling back to a local list. A hit sets `rerouted: true` and the page prompt renders a wholesome unrelated site at the same shape — never a refusal, and nothing in the response tells the client it happened. The string is never logged; the salted hash is written only when something fired.
- **Caps**: per-IP per hour and per-day counts, plus a **USD ceiling** checked against each generation's worst case before any token is bought. The client address is taken from the rightmost `X-Forwarded-For` hop, so a client cannot pick its own bucket. Day counters are mirrored to `CAPS_STATE_FILE` so a redeploy does not reset them.
- **Per-request limits**: 32 KB body; url 2,048; referer 2,048; title 200; three history entries of 512; params JSON 4 KB; a client-supplied manifest may only *name* known apps (the server's own shape text is used) plus up to 32 `custom:` apps with 200-character shapes.
- **Output**: `max_tokens` per kind, plus a server-side byte ceiling that stops the stream and aborts upstream if a provider ignores it. A client that disconnects aborts the upstream generation.
- **Errors**: a provider's response body never reaches the browser (it contains key fragments); the client gets `engine unavailable` and the status, the detail goes to stdout with secrets redacted.
