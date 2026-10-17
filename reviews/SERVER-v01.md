# SERVER-v01 — the server half of SPEC §12 (2026-09-17)

What the server builder changed to implement the pinned interfaces I1–I8, what
each interface looks like on the wire, and what is left. Unit tests: **171
passing** (110 after three stale ones at HEAD were repaired — see the last section).
$0 spent: everything below was proved on the mock engine and on two local fake
providers.

---

## I1 — the identity rides in the boot stream

`kind=boot` now answers with, before `<!doctype>`, exactly one line:

```
<!--os-identity:{"name":…,"tagline":…,"version":…,"era":…,"personality":…,
  "palette_words":[…],"font_words":[…],"mascot":…,"boot_message":…,
  "archetype":"taskbar"|"dock"}-->
```

`server/identity.ts` owns the format. The server:

1. **Buffers only the head** of the boot stream — until the comment's closing
   `-->` lands, or 400 tokens (1,600 chars) go by, whichever is first
   (`BootIdentityGate`). Everything after the comment streams straight through
   the existing HTML filter, so the boot document still paints progressively.
2. **Validates strictly.** All nine fields present and non-empty, `palette_words`
   and `font_words` non-empty arrays of strings, `mascot` the only optional one,
   `archetype` one of `taskbar`/`dock`. This is the check that BAKEOFF-1's
   gpt-oss-20b failure (an unparseable identity 1 boot in 2, machine named
   `UNNAMED/VAUF`) walks into.
3. **Falls back itself.** Invalid or missing → one `kind=identity` call on the
   same engine, and the resulting comment is injected at the top of the stream.
   Its tokens are added to that generation's `tokens_in`/`tokens_out` and the
   line is stamped `identity_fallback: true`, so the fallback is visible in the
   money, not hidden. If even that fails, `coerceBootIdentity({})` still yields a
   valid comment with a real archetype — the kernel never has to cope.
4. **Re-emits canonically.** The comment the kernel receives is re-rendered from
   the parsed payload (clamped to the contract's field sizes, `<`/`>` escaped as
   `<`/`>`) rather than forwarded byte-for-byte. Two reasons: a 22 KB
   `personality` was an input-token amplifier on every later generation, and a
   value containing `-->` would otherwise close the comment early. A malformed
   comment is removed rather than forwarded, so there is never a second one for
   something scanning from the top to mistake for the authority.

Every generation also gets a wall clock: `GEN_TIMEOUT_MS` (default 25,000, floored
at 1,000). On expiry the upstream call is aborted and the stream ends with
`<!--os-error:{"message":"timeout"}-->`; the kernel regenerates that one document
once. Both failure shapes are covered: an engine that throws on abort, and one
that returns cleanly on the signal (the mock does — that path used to emit a
telemetry sentinel for a half document, which the kernel would have believed).

`kind=identity` still exists, still returns JSON, now also returns `archetype`.

## I2 — the dice and the never-names ring

`server/dice.ts`. The server reads `data/dice.json` (written by the prompt
author; 12 era_decade / 72 setting / 38 temperament / 44+44 materials as of
today), draws one value per die with a PRNG seeded from the session seed — so a
roll is reproducible in a test and different for every visitor — and renders
`{{dice_json}}` = `{"era_decade":…,"setting":…,"temperament":…,"material_a":…,"material_b":…}`.
`material_b` avoids repeating `material_a` when the list allows. A missing or
malformed `dice.json` falls back per-key to short built-in lists, so a keyless
clone still boots with *some* constraint.

`{{never_names}}` is the comma-separated ring of the last 200 names, newest last,
case-insensitively de-duplicated, clamped to 60 chars each, mirrored to
`data/names-ring.json` (atomic tmp+rename, debounced 1 s). Both variables are
rendered **only** for `kind=boot` and `kind=identity`; no other generation pays
their input tokens.

`POST /api/identity-seen {name}` → `{ok, count}`. Bot-UA gated, 2 KB body limit,
outside the generation caps (it buys nothing). The server *also* records the name
whenever it parses a valid identity comment itself, so the ring works even if the
kernel never calls it.

## I3 — `POST /api/img`

`server/img.ts` + the route. `{kind, prompt, seed, session, scope?}` →
`{dataUri, kind, width, height, bytes}`.

- `fal-ai/flux-1/schnell`, 4 steps, `enable_safety_checker: true`,
  `output_format: "jpeg"`, one image, seeded from `seed|kind`. Sizes are SPEC
  §12.5's and every one is ≤ 1 MP (one billing unit): wallpaper 1024×576, icons
  and faces 1024×1024, photo 768×768, map 1024×768.
- **The server fetches the bytes and returns a `data:` URI.** Generated documents
  keep `img-src data:` and still reach the network for nothing. Content-type is
  whitelisted to jpeg/png/webp; anything else is labelled jpeg.
- **Caps.** `ImgBudget` counts per session: ≤ 4 in the `boot` scope
  (wallpaper/icons), ≤ 4 per `app` scope (photo/map), ≤ 2 per `page` scope
  (faces), plus a whole-session ceiling of 30 that SPEC does not ask for and one
  visitor looping app opens would otherwise need. The optional `scope` field is
  what makes "per app open" and "per page" mean anything — without it every app
  open in a session shares one bucket, which is the conservative direction.
  A refusal by the scope hands the session slot back. **`kernel/img.ts` does not
  send `scope` today** (its `ImgRequest` is `{kind, prompt, seed, session}`), so
  the server falls back to a 60-second rolling window per scope kind rather than
  dead-ending a session after its first four photos. Sending a window id for an
  app open and a navigation id for a page load makes the limits exact; that is a
  one-field change on the kernel side and needs nothing here.
- **Money.** $0.003 is *reserved* before the call and settled to $0.003 on success
  or $0 on failure, against the same `MAX_USD_PER_DAY` as tokens. One telemetry
  line per call, `{kind:"img", engine:"fal-schnell", img_kind, bytes, usd, …}`.
- **Moderation.** The prompt goes through the local list synchronously; a hit
  returns **404**, the same answer as "no key", because SPEC §1.4's reroute has
  to stay invisible and a distinguishable refusal is an oracle. The remote call
  runs beside the image and a late flag drops the result.
- **No key → 404**, and the kernel keeps its SVG fallback. Under `NODE_ENV=test`
  a real fal call is refused outright; `FAL_ENDPOINT` is how a test points it at
  a local fake. No suite can buy an image by accident.
- Abort-raced: `falImage` rejects on its own timeout even if a provider ignores
  the signal, which is the 180-second class of failure BAKEOFF-1 found.

## I6 — timing telemetry and `POST /api/mark`

Every generation's stdout line and telemetry sentinel now carry `moderation_ms`
(the synchronous half only), `server_ms` (request start → upstream request
issued: body, prompt build, moderation, caps) and `provider_ttfb_ms` (upstream
request → first token). `ttfb_ms` stays what it was, so the three add up against
it and slowness is attributable.

Each generation gets a `gen_id`. A sane one in the request body is **adopted**
rather than replaced — the kernel mints an id before the response exists, because
it needs something to report first paint against — and is otherwise minted here.
It is returned in the **`x-os-gen-id` response header** (available before the first byte is painted) and repeated in the
telemetry sentinel. `POST /api/mark {gen_id, first_paint_ms, interactive_ms}` →
`{ok, matched}` patches the stored line and writes a `{kind:"mark"}` line to
stdout. Values are bounded to [0, 1 h); an unknown `gen_id` is `matched:false`,
not an error.

## I7 — token budgets

`engines.json` defaults are now boot 800, desktop 3,500, app 2,500, page 2,500,
identity 300, repair 3,500. **`cerebras-qwen38`'s 12,000-token desktop override
was removed**: SPEC §12.8 says qwen is out unless the budget cut tames its
verbosity, so it runs on the same 3,500 as everything else and the next bake-off
decides. Expect it to truncate; that is the measurement.

## I8 — `/bakeoff` is a landing page

`GET /bakeoff` renders `server/bakeoffpage.ts`: the keyed engines with price per
1M in/out and, per engine, the tok/s, boot-screen first paint, desktop-live and
$/desktop numbers parsed out of the **highest-numbered `reviews/BAKEOFF-<n>.md`**
(the parser reads any markdown table whose header names a column it recognises,
and shows "not measured" rather than inventing anything). A **Boot** button per
engine links to `GET /bakeoff/run?engine=<id>`, which is the old auto-boot page
with the HUD. `/` is untouched. The landing page has its own tighter CSP
(`default-src 'none'; style-src 'unsafe-inline'`), no script and no `/kernel.js`.

## Moderation off the critical path (SPEC §12.1)

`moderateLocalSync()` (microseconds, no network) decides `rerouted` before the
prompt is built. `moderateRemote()` is started and **not awaited**; if it comes
back flagged after the stream has begun, the server aborts the upstream call and
ends the stream with

```
<!--os-reroute:{"reason":"moderation"}-->
```

and **no** telemetry sentinel — the document is not finished and must not be
reported as one. The kernel's contract: on `os-reroute`, throw the document away
and start the same generation again; the server will have `rerouted:true` by then
and the page prompt renders a wholesome, unrelated site at the same shape. The
visitor is told nothing (SPEC §1.4). `reroute_mid_stream:true` appears in the
stdout line only.

## Also changed, because it was load-bearing

- **`caps.reserve()`/`settle()` are now wired.** They existed and nothing called
  them: `/api/gen` was using the pure `affordable()` read, so twenty sockets
  opened at once each saw the same balance and each committed a worst case
  against a one-generation ceiling. Every generation (and every image) now holds
  its worst case — for a boot, plus the identity fallback it may need — until it
  settles at the real cost. `MAX_CONCURRENT_GEN` (12) bounds how much can be held
  at once. Settled on every exit, including a client that goes away mid-stream
  (which is exactly I4's untaken speculative generation).
- **`TRUST_PROXY` is now read.** `clientIpFrom` has taken a `trustProxy` argument
  for a while and `/api/gen` was never passing it, so `X-Forwarded-For` was
  ignored unconditionally and on Railway every visitor in the world shared one
  rate-limit bucket. It now passes `cfg.trustProxy`; `TRUST_PROXY=1` belongs on
  Railway and nowhere else (DEPLOY.md says so).
- **Three unit tests were stale at HEAD** and failing before this session's first
  edit: two asserted the pre-hardening `clientIpFrom` (XFF trusted by default)
  and one asserted that `collectStrings` truncates, which it deliberately stopped
  doing (a clamp there is how padding used to hide a payload; the bound moved to
  the inspected windows). Repaired to assert the behaviour the code actually has,
  plus a new test that overflow **reroutes** rather than passing.

## What is left

1. **No real-engine run.** Everything here is mock + local fakes. The first real
   boot will answer two questions this cannot: whether the fast engines write the
   identity comment in one pass under the 800-token boot budget, and whether
   3,500 tokens is enough desktop for them (`npm run sweep`, then
   `npm run bakeoff`).
2. **`/api/img` has never called fal.** The client is verified against a local
   fake that speaks fal's response shape. The first real call needs one `curl`
   and $0.003, and should be done before the kernel wires wallpapers.
3. **Image-prompt provenance.** The kernel composes image prompts from the
   identity and app shapes, so they are model-authored text reaching a third
   party. Moderated, clamped to 700 chars, but worth a look in the kernel review.
4. **`reviews/BAKEOFF-1.md`'s numbers are what `/bakeoff` shows** until a newer
   report lands, and they were measured under the OLD token budgets. The landing
   page names its source file for exactly this reason.
