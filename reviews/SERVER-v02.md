# SERVER-v02 — the server half of the v0.1 punch list

2026-09-17. Scope: `server/**`, `engines.json`, `test/**` (server), `scripts/**`.
Nothing in `kernel/**` or `prompts/**` was touched.
Tests: **243 pass** (`npm test`), up from 195. Money spent on live calls: **$0.13**
(text $0.067 across three sweeps, images $0.066).

The punch list this closes: BAKEOFF-2 findings 1, 2, 6 and 7, HANDOFF-3 known
issues 2 and 7, and seams S1–S4.

---

## 1. Identity reliability — 0 UNNAMED in 40 boot heads (was 1 in 4)

BAKEOFF-2: *"one boot in four on `cerebras-oss120` was not named at all"* —
`UNNAMED/6BXG`, tagline "it boots.", generic labels, no era. "The single biggest
variety bug in the run, and it is an I1 problem, not a taste problem."

**Reproduced first, with real calls.** New instrument:

```
npm run identity-sweep -- --engines=cerebras-oss120 --n=20 --heads=reviews/identity-heads-1.json
```

It runs N `kind=boot` generations at `POST /api/gen`, reads each only until the
identity comment lands and then **aborts the stream**, so a boot costs its head
(~150 tokens) instead of its 800-token document: 20 boots is **$0.033**. Under
`IDENTITY_DEBUG=1` the server puts the first 1,200 characters the model actually
wrote on the telemetry line, which is how the failures below were diagnosed
rather than guessed at.

### What was actually wrong — two independent faults, both on the server

**(a) The boot stream sometimes arrives empty.** The failing heads are not
malformed, they are *nothing*: `head: ""` and, on one boot, `head: "<!--"`. With
`reasoning_effort: "low"` gpt-oss occasionally spends the whole 800-token boot
budget on reasoning and returns no visible content (`engines.json`'s own notes
recorded this behaviour for short calls; it happens on long ones too). No parser
can rescue that. The rescue call is the only answer, which makes fault (b) the
one that produced `UNNAMED`.

**(b) The rescue call could not rescue.** `kind=identity` asked for JSON in prose
and parsed the answer with `indexOf('{') … lastIndexOf('}')` + `JSON.parse`, with
no retry. Measured against the live endpoint: a 300-token identity call on
cerebras **comes back truncated mid-JSON** (reasoning tokens come out of
`max_tokens`), and strict `JSON.parse` of a truncated object throws. One failure
of the rescue = one characterless OS.

### The fix, in four parts

1. **A tolerant reader** (`server/identity.ts`). The opener is now a regex
   (`<!--  os-identity :`, `<!--OS_IDENTITY:` all match); every `-->` in the head
   is tried as the closing one, in two passes, so a `-->` inside a tagline no
   longer costs the identity; and the body goes through `tolerantJsonParse` —
   fences, trailing commas, smart quotes, raw newlines inside strings, and a
   body cut off mid-object (closed by `closeTruncated`). A model that skipped the
   comment wrapper and just wrote the JSON is caught by `findIdentityLoose`,
   which only ever looks *before* the document start so an object inside the boot
   screen's own script can never be mistaken for an identity.
2. **Acceptance is no longer all-or-nothing.** A name and a tagline are required
   (they are the character); 5 of the other 7 fields must be usable; the rest are
   coerced, as they always were. v0.1 threw away a complete identity for a missing
   `boot_message` and bought a second call for it. A mistyped archetype now costs
   a seeded archetype, not a round trip.
3. **The rescue call uses JSON mode, and retries once.** `"json_mode": true` per
   engine in `engines.json` → `response_format: {type:'json_object'}`
   (**verified live on cerebras**: 200, valid JSON, both with and without). The
   retry samples colder (≤ 0.7) because the same prompt at the same temperature
   is the same coin flip twice, and it only fires if the generation's clock still
   has 1.5 s on it. Two attempts of ~150 tokens ≈ $0.0002.
4. **The identity budget went up, 300 → 500 tokens.** The one number in
   `engines.json` that got bigger, for the reason measured above. It is only ever
   paid on the rescue path.

### Result

| run | boots | named | `UNNAMED` | rescues | rescue outcome |
|---|---|---|---|---|---|
| sweep A | 20 | **20** | **0** | 3 (2 empty head, 1 invalid) | all 3 rescued |
| sweep B | 20 | **20** | **0** | 2 (both empty head) | both rescued |

**40/40 named, 0 UNNAMED**, against BAKEOFF-2's 25% failure rate. The residual
fault rate — a boot stream that arrives empty — is ~10% and is now invisible to
the visitor; it costs $0.0002 and one `identity_fallback: true` telemetry line.

The 20 heads of sweep B are committed as `reviews/identity-heads-1.json` and
replayed for free by `test/identity-heads.test.ts` on every `npm test`. That is
the regression guard: a future change to the parser or the boot prompt that
breaks a class of real head fails a unit test instead of a bake-off.

### Two things the prompt author should know

- **The seed leaks into the name.** Sweep A ran with seeds like `idsw-3-…` and
  three machines called themselves `IDSW`, `IDS`, `IDSW0`. `{{seed}}` is in the
  identity prompt and the model reads it as material. Production seeds are random
  base36, so this is live: boots will occasionally be named `k3f9`. Either drop
  the seed from the identity prompt or tell the model it is not a name.
- **The register dice work.** Across 40 boots: `Chisel`, `tide3`, `RIVET`,
  `foam-spark`, `RUF`, `First Gear`, `Mild Echo`, `J-93`, `F7-21`, `Hawthorne`,
  `Third Mycelium`, `Moss Quill`, `PRACTICON`. BAKEOFF-2's "two nouns welded
  together, 7 of 9" is gone.

---

## 2. Image latency — full report in `reviews/IMG-LATENCY-1.md`

Headline: **wallpaper 7,255 → 2,959 ms (−59%), icon sheet 4,190 → 3,091 ms
(−26%)**, and the download leg (1.9–4.7 s) is deleted rather than optimised.
`sync_mode: true` makes fal's response carry the image inline as a `data:` URI —
which is the only form the CSP accepts anyway. Sizes down to 768×432 / 768×768 /
640² (every size ≤ 1 MP is the same $0.003, so this is free), steps 2 for a soft
wallpaper and 4 for the sheet.

Our own share of a wallpaper request is **7 ms**. The rest is schnell's ~2.0–2.3 s
floor, measured: halving the pixels again buys 100–200 ms and one step is slower
than two. The < 2.5 s target is met on a good call and missed on a median one by
fal, not by us.

**A failed boot no longer buys its icon sheet** (BAKEOFF-2 finding 6). The
`icons` request waits for the desktop generation of the same boot to produce its
first chunk (`IMG_ICONS_GATE_MS`, default 6,000 ms) and is otherwise refused with
`blocked: "no-desktop"`. The wallpaper still starts at identity time per SPEC
§12.5 — it is the one picture a boot screen can use.

---

## 3. The seams

**S1 — document images, server side.** `POST /api/img` takes `scope` (window id
for an app, navigation id for a page) and now also `scopeKind: 'app' | 'page'`.
The limits SPEC §12.5 sets are per *document*, not per kind, and `os.img` lets
any document ask for any of photo/faces/map — a contacts app wants `faces`, a
listings page wants `photo`. So the kernel declares the document class and the
kind's own default is only the fallback. **`boot` is never accepted from a
client**, so nothing can spend from the boot's four. Enforced: 4 per app
document, 2 per page document, by scope id, with the session ceiling (30) still
charged to the IP hash. The prompt is the document's own `data-os-prompt`,
moderated (local list synchronously, remote in parallel) and clamped to 700
characters, as before.

**S2 — the three new dice.** `naming_register`, `strange_detail` and
`wallpaper_motif` are read from `data/dice.json`, rolled once per boot from the
seed, and rendered into `{{dice_json}}` beside the original five. The prompt
author's file already carries 22 / 74 / 52 entries against S2's 12 / 60 / 40
minimums, and `test/dice.test.ts` now asserts those minimums against the real
file plus no-duplicates and actual variety across 60 seeds. A die the file
forgets falls back to a short dull builtin so a keyless clone still boots.

**S3 — the server writes the image prompts.** New `server/imgprompt.ts`. The
kernel sends `{kind, session}` for the boot's two pictures and **any `prompt` in
the body is ignored for them**. The wording is loaded from
`prompts/images/{wallpaper,icons}.md`: those files are written for people (a
contract, one fenced block, then commentary explaining each clause), so the
loader takes **the first fenced block only** — the commentary names the failures
the wording is fixing, which is the last text that should travel next to a model.
S3's own wording is the builtin fallback, so the server never depends on a file
another builder owns. Variables: `era_decade`, `wallpaper_motif`,
`palette_words`, `font_words`, `setting`, `temperament`, `material_a`,
`material_b`, `era`, `personality`, `icon_cells` (alias `app_shapes`).
Deliberately absent: **the OS name and the mascot** — a name in an image prompt
is what flux renders as text, and the mascot is what produced BAKEOFF-2's
photographed animals.

The dice replay from the seed, so the wallpaper's decade is the machine's decade
and not a second one. Which identity is asking is resolved by `server/sessions.ts`
(`BootMemory`) — one record per boot under three aliases, tried in this order:

1. the session **seed** (`/api/gen` always has it),
2. the kernel's **session id** (`/api/img` always sends it; `/api/gen` will carry
   it as an optional `session` field if the kernel starts sending it),
3. the client's **ip hash** (both routes always have it).

**(3) is the alias that fires today**, because the kernel's `GenRequest` has no
`session` field: `/api/gen` learns the identity under seed+ip, `/api/img` looks it
up under session+ip, and the ip is the overlap. It is right in practice — the
visitor asking for a wallpaper is the visitor who just booted — and two tabs on
one IP can at worst cross wallpapers, which costs nothing and is invisible.
**Kernel builder: adding `session: session.sessionId` to the `/api/gen` body for
`kind: 'boot'` and `kind: 'desktop'` upgrades this from "right in practice" to
"exact", and is the only change needed.** Without it, a visitor behind a shared
NAT could in principle get another visitor's palette in their wallpaper; with it,
never. The record holds an identity and a "desktop started" flag, nothing
generated, bounded at 4,000 entries with a 30-minute TTL.

**S4 — per-engine `timeout_ms`.** BAKEOFF-2 finding 2: haiku's desktops have a
median `total_ms` of **25,003 ms** against our own 25,000 ms cap, and two of four
boots died on *our* clock. `anthropic-haiku` now gets 60,000 ms, `openai-small`
and `gemini-flashlite` 45,000 ms, and everything else stays on `GEN_TIMEOUT_MS`.

---

## 4. Telemetry

**Every refusal now says which kind it was** (BAKEOFF-2 finding 1: *"a queue
screen and a dead engine are indistinguishable in the numbers"*, which is how two
engines looked dead for a whole run while they were only rate-limited).
New field `refusal`:

- `"queue"` — one of **our** caps said no and nothing was bought: the per-IP
  hour bucket, the day count, the USD ceiling, the in-flight ceiling, an image
  budget.
- `"engine_dead"` — the **provider** refused, hung, or died mid-stream: an HTTP
  error, our wall clock firing, a fal failure. Also written for
  `blocked: "no-desktop"`, because an icon sheet refused for want of a desktop is
  a boot the engine did not finish.

A reroute and a client that went away get neither: they are not refusals.

Also new on the line: `identity_fail` (`missing` / `bad-json` / `invalid`),
`identity_fallback_mode` (`json` / `text`), `identity_fallback_tries`,
`identity_head` and `identity_fb_head` (both `IDENTITY_DEBUG=1` only, model
output, never secrets), and `img_fetch_ms` / `img_scope` / `img_px` on image
lines — `img_fetch_ms: 0` is how you see `sync_mode` working in production.

**Bake-off shots are run-numbered** (BAKEOFF-2 finding 7):
`reviews/shots-bakeoff/<n>/<engine>/<boot>/`. The report's name is now decided
*before* the run rather than after it, because the shots are filed under it while
the run happens. BAKEOFF-1's and BAKEOFF-2's existing shots were left where they
are — moving them would break BAKEOFF-2's own references — so the old
`shots-bakeoff/<engine>/` trees are the pre-v0.2 ones and everything from the
next run forward is numbered.

---

## 5. New and changed files

| file | what |
|---|---|
| `server/identity.ts` | tolerant reader, `tolerantJsonParse`, relaxed acceptance, failure classes, early gate exit |
| `server/imgprompt.ts` | **new** — S3, the server-built image prompts |
| `server/sessions.ts` | **new** — `BootMemory`: one boot's identity + desktop-started flag, three aliases |
| `server/img.ts` | sizes, per-kind steps, `sync_mode`, `scopeForRequest`, scope-aware `take()` |
| `server/index.ts` | rescue call (JSON mode + retry), S3 prompt build, icons gate, S4 clock, refusal classes, `session` in the gen body |
| `server/engines.ts` | `json_mode`, `timeout_ms`, `timeoutFor()`, `response_format` on a JSON-mode call |
| `server/dice.ts` | the three S2 dice + `DICE_MINIMUMS` |
| `server/htmlstream.ts` | `extractJson` delegates to the tolerant parser |
| `server/telemetry.ts` | `refusal`, the identity diagnosis fields, the image fields |
| `engines.json` | `json_mode` / `timeout_ms` per engine, identity budget 300 → 500 |
| `scripts/identity-sweep.mjs` | **new** — heads-only boot sweep, `--heads=` capture |
| `scripts/img-latency.mjs` | **new** — the A/B behind IMG-LATENCY-1 |
| `scripts/bakeoff.mjs` | run-numbered shots |
| `reviews/identity-heads-1.json` | **new** — 20 real boot heads, the replay sample |
| `test/identity-heads.test.ts`, `test/imgprompt.test.ts`, `test/sessions.test.ts` | **new** |
| `test/{identity,img,dice,engines,routes,lanes}.test.ts` | updated for the above |

## 6. What is left, and what I would not do next

- **The kernel's `session` on `/api/gen`** (see S3). One line, and it retires the
  ip-hash alias.
- **`{{seed}}` in the identity prompt** names machines after the seed. Prompt work.
- **`identity_fail: "missing"` at ~10% on cerebras** is an engine behaviour (an
  empty boot stream), not a parser one. If it is worth removing rather than
  rescuing, the lever is `reasoning_effort` or a larger boot budget — both cost
  latency, which is the product, so I would leave it rescued.
- **Do not chase the image target below ~2.5 s with parameters.** Measured: it is
  fal's floor, not ours (7 ms of a wallpaper is our code).
- **`mercury-2.5` is still 403 from this network.** Unjudged, unchanged.
- E2E (`npm run test:e2e`) was not run in this pass: `kernel/**` was being
  rewritten in parallel for S1/S3 and its type errors are not mine to fix. The
  unit suite is green, and the server contract the e2e tests exercise (`/api/gen`
  streaming, `/api/img` shape, telemetry sentinel) is covered by
  `test/routes.test.ts`.
