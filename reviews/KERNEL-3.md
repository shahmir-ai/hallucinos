# KERNEL-3 — the §12 kernel side (2026-09-17)

What the kernel does now that SPEC §12 and the pinned interfaces I1–I8 exist, what
it is defensive about, and what is still open. Everything below was built and
measured on the **mock engine at $0**; no provider key was used.

Suite at hand-off: **171 vitest + 46 playwright green** (`npx playwright test`,
`npx vitest run`), against `dist/server.js` built from the server builder's
current tree.

## 1. Identity in the boot stream (I1)

- `kernel/contract.ts` — `scanIdentityComment()` reads `<!--os-identity:{…}-->`;
  `Identity` gained `archetype`, and `coerceIdentity` fills a missing or bogus one
  from the seed (a constant default would have made every fallback machine
  Windows-shaped).
- `kernel/index.ts BootSplitter` — pulls the comment out of the stream before the
  bytes reach the boot frame, so the comment is never part of the boot document,
  and hands it over the instant the closing `-->` lands. Desktop generation and
  both image calls start from that callback.
- **Defensive by design:** the moment the stream head can no longer be a prefix of
  the marker (or 8 KB pass with the comment unclosed, or the stream dies), the
  buffer is flushed to the frame and the kernel makes one `kind=identity` call
  instead. The server's own mock fixtures do not emit the comment yet, so this is
  the path `/` currently takes on the mock engine — and `e2e/identity.spec.ts`
  proves the I1 path anyway by serving a canned boot stream through
  `page.route`, which is engine- and server-independent.
- A reboot's identity is overridden by the kernel: same `name`, `nextVersion()` of
  the old version (SPEC §4). A hallucinated rename on reboot is not detectable and
  the updater promised version+1 of *this* machine.
- `POST /api/identity-seen {name}` fires on every parsed identity (I2 ring buffer).

## 2. Nothing is replaced without a user action (§12.2)

- **No repair generation exists any more**, for the desktop or for an app. A
  missing hook is patched into the document that is already there
  (`injectMissing`, `frame.inject`). The only second generation the kernel will
  ever buy is after a server error sentinel (I1's `GEN_TIMEOUT_MS`), once.
- The desktop is mounted and wired **behind** the boot overlay (now
  `position:fixed; z-index:2147482000` on `<body>`, above anything the desktop can
  mount, below the kernel's own screens), and the overlay is lifted only when the
  desktop is interactive **and** the boot screen has been painted for ≥ 2.5 s. The
  lift also aborts the boot stream, so the rest of it is not paid for.
  `data-os-ready` now means *revealed*, not *mounted*.
- `data-os-desktop-ms` on `<html>` carries the kernel's own
  boot-request→interactive number.
- Interactivity during streaming was already delegation-based; there is now a test
  that proves it with a document that is minutes from finished (a new
  `MOCK_DELAY_MS=250` server on :8776).
- `e2e/noreplace.spec.ts` is the guard SPEC §12.2 asks for: `__osStats.opens === 1`
  per mounted document, a `MutationObserver` on the desktop's own nodes, and three
  idle seconds in which nothing may change.

## 3. Images (I3)

- `kernel/img.ts` — `POST /api/img`, prompt built from the identity (wallpaper) and
  from the identity plus each app's shape (the 4×4 sheet). Two calls per boot,
  started off the identity comment, never awaited by anything.
- `[data-os-img="wallpaper"]` gets it as `background-image`; if the model never
  declared the slot the picture still goes on `[data-os-desktop]` rather than being
  thrown away — it is already paid for.
- `[data-os-icon="<appId>"]` gets `background-size:400% 400%` and the cell's
  `background-position`, cell index = manifest order. A launcher carrying a bare
  `[data-os-icon]` instead of the per-app one also gets its cell; only an explicit
  slot has its placeholder glyph cleared.
- 404 (no `FAL_KEY`) is a no-op: the model's SVG stays. Filled elements are marked
  `data-os-img-filled` so the tests (and a human) can see what landed.
- **Not built:** the photos / faces / map calls of §12.5. They need a request path
  from inside a sandboxed document, which is a bigger surface than this session's
  brief (`wallpaper + icon sheet`) and is the obvious next kernel task.

## 4. Speculative generation (I4)

- `gen.start(req, key)` / `gen.claim(kind, key)` / `gen.take(handle, sink)` /
  `gen.drop` in `kernel/gen.ts`. A handle buffers its chunks; taking it replays the
  buffer and pipes the rest live. Untaken for 60 s → aborted upstream and dropped.
  `dropAll()` on teardown, and a window's own abort drops its handle.
- Started on `mousedown`/`touchstart` over any launcher (capture phase, so the
  model's own handlers cannot swallow it), and for the browser's google-shaped home
  the moment the browser opens — in parallel with its chrome.
- Shown at most once: `claim` removes it from the registry, and reopening the same
  app generates again (ruling 1.1 is intact, and tested).
- Side effect worth knowing: a taken handle's buffered part replays in one write,
  so a speculative document that finished before it was claimed paints in a lump
  rather than progressively. That is the trade the speed ruling asks for.

## 5. Hooks, marks, routes

- I5: `domMissing(apps, archetype)` now also requires `[data-os-archetype="<the
  identity's>"]` on `<html>`/`<body>` and a `[data-os-clock]`; both are patched in
  place (the fallback clock ticks — a dead clock is worse than none). The text
  validator takes the archetype as an *optional* argument so the server, which
  validates without an identity, is unaffected.
- I6: `POST /api/mark {gen_id, first_paint_ms, interactive_ms}` for boot, desktop,
  app and page. First paint is reported by the injected runtime from inside a
  double `requestAnimationFrame` after the first write, so it is a drawn frame and
  not the arrival of bytes. `gen_id` is generated client-side and sent with the
  request; a `gen_id` echoed in the telemetry sentinel wins.
- I8: the HUD and the picker exist only when the server says `bakeoff` **and** the
  path is `/bakeoff/run`. `/bakeoff` (the landing page) is the server's own page and
  carries no kernel UI.
- The HUD no longer wipes its numbers when the kernel narrates, and shows the
  `mod / srv / prov` TTFB breakdown when the server sends it.

## 6. Numbers (mock engine)

`reviews/PERF-KERNEL-1.md`, written by `e2e/perf.spec.ts` (3 boots):
boot paint **96 ms**, desktop interactive **270 ms**, desktop revealed **2,897 ms**
(the 2.5 s floor plus paint latency), app paint **92 ms**, page paint **113 ms**.
These are kernel overhead around a ~1,500 tok/s stream with no provider latency —
SPEC §12.1's targets are for the chosen fast engine and belong to a bake-off.

## 7. Open, in order of how much it matters

1. `server/mock.ts` still emits no `<!--os-identity:-->` in `kind=boot` and no
   `[data-os-archetype]` / `[data-os-clock]` / `[data-os-img]` / `[data-os-icon="<id>"]`
   in `kind=desktop`. Until it does, every mock boot pays for the I1 fallback round
   trip and every mock desktop is `data-os-contract=miss` with a patched archetype
   and clock. Not the kernel's file.
2. Photos / faces / map images (§12.5) — see §3 above.
3. `/bakeoff` currently renders the kernel page in the server tree I tested
   against; when it becomes the plain landing page, `e2e/bakeoff.spec.ts`'s last
   test should tighten from "no HUD" to "lists engines and links to
   `/bakeoff/run?engine=`".
4. Nothing measures a real engine yet. Every number here is the mock.
