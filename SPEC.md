# hallucinos — SPEC v0 (2026-09-17)

Working name only. The product names itself on every boot; the folder needs a name, the OS does not.

Architect: Fable 5.1. Builder: Opus 5 (high). Owner: Shahmir. Read this whole file before writing code. Rulings in §1 are not open; everything else says where the builder has latitude.

---

## 0. What this is, in one paragraph

A hosted, free, no-login web page that boots a fully hallucinated operating system. Every visible pixel is written by a language model on demand. Nothing generated is ever cached; reloading anything regenerates it from scratch. We supply only **shapes** (which apps exist and which affordances each needs) and a **kernel** that owns geometry, streaming, session state and safety. The browser inside it loads any URL you type and hallucinates the site from the URL alone; the home page is a hallucinated Google whose results are hallucinated too. The audience hook: every boot is a different OS with a different name, look and personality. People screenshot theirs and compare.

Prior art (see `docs/research/hallucinos/PRIOR-ART.md` when written; summary in the chat that produced this spec): hallucinated browsers exist as ~10 bring-your-own-key desktop apps with 5–280 GitHub stars; hallucinated wikis exist (Halupedia: 150K users in a week, May 2026); Google (Jun 2025) and Steve Sanderson at Build (Jun 2026) demoed hallucinated OS shells; none is hosted, free, keyless, fast **and** shell-hallucinated. That combination is the product.

## 1. Rulings (Shahmir, 2026-09-17 — not open for debate)

1. **No caching of generated content. Ever.** Reload = regenerate. Back = regenerate. The only identity a thing has is its URL (or app id) plus the shape metadata we derive from it. Two people typing `netflix.com` get two different Netflixes. The same person reloading gets a third.
2. **The shell is hallucinated too.** We give shapes, never placement, names, icons or style. The taskbar exists; where it is and what it looks like is the model's. Icons and names of apps are the model's.
3. **No year slider. No "lenses".** Those were other people's gimmicks. Default browser home is a hallucinated Google-shaped search page.
4. **Moderation scope: sexual content and anything involving minors only.** Reroute silently (never a refusal screen). Hate speech is *not* filtered in v1 (his call, to be revisited on evidence). No public "trending" or "recent" list in v1.
5. **Video is out of v1.** Netflix-shaped and YouTube-shaped pages render posters and players as SVG/CSS; nothing plays. Leave a slot: `data/videos.json` (list of `{title, url, poster}`) that the page prompt can offer to the model when non-empty. Shahmir fills it later from fal.
6. **No image model in v1.** All visuals are SVG, CSS, emoji, unicode, drawn by the LLM. External `<img>` are blocked by CSP and rewritten by the runtime into an inline placeholder that carries the alt text.
7. **The model is chosen by bake-off, not by fiat.** Engines are configuration. Shahmir may play with each and pick.
8. **Budget:** build phase unconstrained; production ≤ ~$25/day enforced by caps, not by hope.
9. **Hosting: Railway.** Never Vercel.
10. **Ethics:** parody of real brands is in scope; impersonation, fake reviews and fabricated social proof are not. Generated pages must never claim to be the real site (no "official" language), and must never render real people's private data. Names of real people the *user* types are allowed.

## 2. Architecture

Single Node 22 / TypeScript service. Two parts in one repo folder.

### 2.1 `server/` — stateless streaming proxy (Hono)

| Route | Purpose |
|---|---|
| `GET /` | Kernel page. Visually empty (black, full viewport). Boots immediately. |
| `GET /bakeoff` | Same kernel with the engine picker and stats HUD enabled (§7). |
| `POST /api/gen` | Body `{kind, engine, seed, identity?, params, context}`. Builds the prompt from `prompts/`, runs moderation on user-supplied strings, applies caps, calls the engine with `stream: true`, strips code fences and any prose before `<!doctype`/`<html`, and streams the HTML back as `text/html; charset=utf-8` chunked. Never buffers the whole document. |
| `GET /api/engines` | Engines whose key env var is present, with display name and price table. |
| `GET /api/stats` | Today's generation count, tokens, estimated $, per engine. |
| `GET /healthz` | 200. |

`kind` ∈ `identity | boot | desktop | app | page`. `identity` returns JSON, not HTML (§3.1).

Caps (env-configurable, defaults): `GEN_PER_IP_PER_HOUR=60`, `MAX_GEN_PER_DAY=10000`. Over cap → `429` with JSON `{ "queue": true, "retryAfter": s }`. Bot user agents (Googlebot, GPTBot, ClaudeBot, curl, wget, python-requests, scrapy, headless indicators) → `403` on `/api/gen` only. Output hard cap per kind (§5). Every generation logs one JSON line to stdout: `{ts, kind, engine, ip_hash, tokens_in, tokens_out, ttfb_ms, total_ms, tok_per_s, usd, contract_ok}`.

### 2.2 `kernel/` — the runtime (vanilla TypeScript, one esbuild bundle, no framework)

The kernel is the only code with opinions, and its opinions are all non-visual:

- **Session state** (memory + `sessionStorage`): `seed`, `identity`, `manifest` (app list, extendable at runtime by the Store), `windows[]` (`{id, app, params, title, geometry, z, minimized}`), per-browser-window `history[]` + cursor. Reload of the tab = new boot (state cleared). The only continuity inside a session is *which things exist*, never what they look like.
- **Geometry**: absolute positioning inside the model's `[data-os-windows]` layer; cascade placement; drag by `[data-os-drag]`; resize by `[data-os-resize]` if present; z-order on focus; minimize/restore; at viewport width < 768px every window is full-size and there is no drag.
- **Streaming into iframes**: each generated document renders progressively (you must be able to watch it paint). Approach: every content iframe is a sandboxed (`allow-scripts`, plus `allow-forms` only where needed; **never** `allow-same-origin`) bootstrap document that the kernel feeds chunks over `postMessage`; the bootstrap writes them with `document.write` and injects the CSP meta and the runtime script *before* the first model byte. Builder may pick another mechanism if it demonstrably streams and keeps generated content off the network.
- **CSP for every generated document**: `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data: blob:`. Zero network from generated content. Verified by a test that watches for any request from an iframe.
- **Runtime injected into every generated document** (`window.os`): `open(appId, params?)`, `close()`, `navigate(url)`, `reload()`, `back()`, `forward()`, `home()`, `setTitle(t)`, `install(appSpec)` (Store only: adds `{id:'custom:<slug>', shape, affordances}` to the session manifest and the desktop is told via `os.event('installed')`), `state()` (read-only snapshot). Plus automatic interception inside pages and apps: any `<a href>` click → `navigate(resolved)`; any `<form>` submit → `navigate(action + '?' + serialized fields)`; `[data-os-app="id"]` click → `open`; `[data-os-close]` → `close`; `[data-os-nav="back|forward|reload|home"]` → the matching call; `[data-os-url]` input: Enter → `navigate(value)`; the kernel writes the current URL into `[data-os-url]` after each navigation. `<img>` elements with non-`data:` src are replaced by an inline SVG/CSS box that shows the alt text (the "hallucinated image").
- **Contract validation** (§3) with one repair pass, then fallback.
- **Boot sequence**: `identity` (JSON, ~150 tokens) → in parallel `boot` (full-screen streaming document shown while waiting) and `desktop`. When the desktop passes validation it replaces the boot screen. Target: identity < 1 s, boot screen painting within 1.5 s, desktop live within 6 s on a ≥1,000 tok/s engine.
- **Queue state** is the one screen the kernel draws itself (plain monospace text on black, no styling opinions): "the operating system is over capacity, retry in N s". Error state likewise.

## 3. The shape contract — the only thing we impose

### 3.1 Identity (kind=identity, JSON)

`{ name, tagline, version, era, personality, palette_words[], font_words[], mascot?, boot_message }`. Generated once per session with high temperature. Passed into `boot`, `desktop` and every `app` generation. **Pages never receive identity** — the fake internet is not the OS; it has its own reality. Pages receive only the session seed for flavor.

### 3.2 Desktop (kind=desktop) — required hooks

- `[data-os-desktop]` — the icon/launcher area (anywhere, any layout).
- `[data-os-windows]` — the layer windows live in (must be positioned so absolute children work; the kernel adds `position:relative` if missing).
- `[data-os-taskbar]` — some element, anywhere, any orientation.
- `template[data-os-window]` — the window chrome: inside it `[data-os-title]`, `[data-os-content]` (empty container the kernel puts the iframe into), `[data-os-close]`, `[data-os-drag]`; optional `[data-os-minimize]`, `[data-os-maximize]`, `[data-os-resize]`.
- `template[data-os-task]` — one taskbar entry: inside it `[data-os-title]`, optional `[data-os-icon]`.
- At least one launcher `[data-os-app="<id>"]` for every app in the manifest, plus optionally a menu; placement, art and labels are the model's.
- May include its own `<script>` for clocks, animations, sounds-off-by-default, whatever; must not depend on the network.

Validation runs on the parsed document. Missing hooks → one **repair** generation whose prompt includes the exact list of missing hooks ("you forgot: …"), then, if still missing, the kernel injects the missing pieces as bare unstyled elements and records `contract_ok=false`. The contract-miss rate per engine is a first-class bake-off number.

### 3.3 Apps (kind=app)

A full HTML document for the window content. Free-form. The browser app additionally must contain `[data-os-page]` (an empty container the kernel mounts the page iframe into), `[data-os-url]` (a text input) and may contain `[data-os-nav]` buttons; tab strips and bookmarks are the model's choice and are decorative unless wired through the runtime. Apps receive `identity`, the manifest, and their own `shape` text (§4).

### 3.4 Pages (kind=page)

A full HTML document. Receives `url` (parsed into domain, path, query), `referer` (the previous URL and its `<title>`, so a click makes sense), the last three URLs of history, the session seed, and `rerouted: true` when moderation fired. No identity. The prompt teaches **shape inference**: `reddit.com/r/x` → subreddit-shaped (post list, votes, comment-shaped things); `reddit.com/r/x/comments/…` → thread-shaped; `youtube.com` → feed-shaped, `/watch` → video-page-shaped with an SVG player; `netflix.com` → catalogue-shaped; `en.wikipedia.org/wiki/X` → article-shaped; `google.com` → search-shaped; `google.com/search?q=` → results-shaped with 8–10 results whose hrefs are plausible invented URLs; `amazon.com/dp/…` → product-shaped; unknown domain → infer the business from the name and render it with full confidence. When `rerouted`, the page must be a wholesome, unrelated site at the same domain shape, with no acknowledgement.

## 4. Apps manifest v1 (ids fixed; everything visible is the model's)

| id | shape (one line the prompt expands) |
|---|---|
| `browser` | a web browser: address bar, some navigation, a page area; home is google-shaped |
| `photos` | a photo library of pictures that do not exist, drawn as SVG/CSS art with captions |
| `trash` | a recycle bin holding files deleted by the previous user of this machine |
| `calculator` | a calculator that is under no obligation to be correct; it decides per boot how honest it is |
| `store` | an app store of apps that do not exist; "install" calls `os.install()` and the app appears on the desktop |
| `mail` | an inbox: invented senders, spam from invented companies, one thread that is oddly personal |
| `messages` | group chats with invented contacts who reply when you type |
| `terminal` | a shell where the model is the shell; commands do what the OS thinks they do |
| `taskmgr` | a task manager of invented processes and resource graphs |
| `maps` | a map of cities that do not exist, drawn as SVG, with directions between them |
| `weather` | forecasts for places that do not exist, with warnings |
| `news` | a news reader for today in this reality |
| `notes` | the OS's own diary, including entries about the user |
| `games` | a launcher that writes and runs a playable canvas/JS game on the spot |
| `update` | a system updater; "install" triggers a full reboot into version+1 (new identity, same name lineage) |
| `about` | about this computer: the OS's own history, specs, credits |

Per-app affordances are listed in `prompts/apps/<id>.md`. The manifest is data (`manifest.json`); adding an app is adding a shape file. Custom apps installed from the Store are shape text authored by the model at install time.

## 5. Prompt library (`prompts/`)

- `system/voice.md` — shared rules: be specific, confident and strange; invent names, prices, people, dates; never mention AI, models, prompts or "generated"; never break character; keep the shape recognizable and everything inside it invented; output **only** one HTML document starting with `<!doctype html>`, no fences, no commentary; inline CSS; no external resources of any kind; no `<img>` with http src (use inline SVG, CSS shapes, emoji); include the required hooks exactly as data attributes; size limits per kind.
- `system/identity.md`, `system/boot.md`, `system/desktop.md`, `system/app.md`, `system/page.md` (shape-inference rules with the examples in §3.4), `system/repair.md`.
- `apps/<id>.md` — shape + affordances + one or two "things it could do" seeds, never a design.
- Per-engine overrides in `engines.json` (`temperature`, `max_tokens`, reasoning switches, any wording tweak the engine needs to obey "no fences").

Token caps: identity 300, boot 1,500, desktop 7,000, app 4,500, page 4,500, repair 7,000. Temperature 1.0–1.2 by default (bake-off may change per engine).

Builder latitude: wording is yours; test it on real engines and iterate until the contract-miss rate on the smoke engines is under 10%.

## 6. Engines (`engines.json`; a line appears in the picker only if its key env is set)

| id | endpoint (OpenAI-compatible chat completions unless noted) | model | key env | notes |
|---|---|---|---|---|
| `cerebras-oss120` | `https://api.cerebras.ai/v1` | `gpt-oss-120b` | `CEREBRAS_API_KEY` | ~2,000–3,000 tok/s; set reasoning to the lowest setting |
| `cerebras-qwen38` | same | `qwen-3.8-27b` | `CEREBRAS_API_KEY` | ~1,850 tok/s; disable thinking (check Cerebras docs for the exact parameter) |
| `mercury-2.5` | `https://api.inceptionlabs.ai/v1` | verify id via `GET /models` (expected `mercury-2.5`) | `INCEPTION_API_KEY` | diffusion, ~1,100 tok/s; tokens arrive in blocks — ensure streaming still paints progressively |
| `groq-oss20` | `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b` | `GROQ_API_KEY` | ~1,000 tok/s; the cheap-and-weird slot |
| `groq-oss120` | same | `openai/gpt-oss-120b` | `GROQ_API_KEY` | ~500 tok/s |
| `openai-small` | `https://api.openai.com/v1` | cheapest current small non-reasoning model (verify via `/models`) | `OPENAI_API_KEY` | slow reference engine, available today |
| `anthropic-haiku` | Anthropic's OpenAI-compatible endpoint `https://api.anthropic.com/v1/` or the Messages API | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` | available today; use for the smoke test |
| `gemini-flashlite` | `https://generativelanguage.googleapis.com/v1beta/openai/` | current Flash-Lite | `GOOGLE_API_KEY` | optional; ~300 tok/s |
| `openrouter-*` | `https://openrouter.ai/api/v1` | any of the above via provider pinning | `OPENROUTER_API_KEY` | optional one-key path |
| `mock` | in-process | fixtures | none | canned documents streamed at ~1,500 tok/s; used by tests and UI work |

Every engine entry carries `usd_in`, `usd_out` per million for cost telemetry. Moderation uses `OPENAI_API_KEY` (`omni-moderation-latest`, free); when absent, fall back to a small local list of the obvious domains/terms so the demo still runs.

## 7. Bake-off page `/bakeoff`

Identical to `/` plus, on the boot screen only, an engine `<select>` (also settable by `?engine=`), and a HUD in a corner: engine, kind of the last generation, TTFB, tokens/s, tokens, estimated $, contract result, running $ for the session. The HUD is the only non-hallucinated visible UI on that route and must not exist on `/`.

Judging protocol (Fable runs this before Shahmir looks): per engine, 5 boots; per boot open 4 apps and visit 5 URLs (`google.com` search "best pizza in town", one result, `reddit.com/r/cats`, `netflix.com`, `en.wikipedia.org/wiki/Moon`). Record contract-miss rate, time to boot-screen paint, time to desktop, median tokens/s, broken-render rate (blank, unstyled, or JS error on load), and a written read on funniness and variety. Output `reviews/BAKEOFF-1.md` with screenshots under `reviews/shots-bakeoff/`. Then Shahmir plays with the top two or three.

## 8. Safety and cost, concretely

- Moderation on: URL, search query, address-bar input, app params, terminal commands, message text. Categories that fire: `sexual`, `sexual/minors` only. Fire → `rerouted: true`, never a refusal, never a log of the string beyond a hash.
- Prompt injection: user strings are data inside a delimited block; the worst case is a strange page, and the sandbox means a strange page cannot phone home.
- Caps as in §2.1. Prepaid credits on every provider are the last line.
- Cost telemetry per generation; `/api/stats` for the day.
- `robots.txt`: disallow `/api/`. The site itself may be indexed (it is one page).

## 9. Repo layout

```
products/hallucinos/
  SPEC.md                 this file
  README.md               what it is, how to run, how to add an app
  DEPLOY.md               Railway runbook (written by the builder; deploy is Fable's call)
  package.json            scripts: dev, build, start, test, test:e2e, bakeoff
  engines.json  manifest.json  data/videos.json (empty list)
  prompts/{system,apps}/*.md
  server/  kernel/  test/ (vitest) e2e/ (playwright)
  reviews/                smoke + bake-off shots and reports
  .env.example            every key name in §6 plus caps
  railway.json            NIXPACKS, build `npm run build`, start `node dist/server.js`, healthcheck `/healthz`
```

## 10. Definition of done for the build hand-off

1. `npm run dev` boots on the `mock` engine at `http://localhost:8790` (port env `PORT`, default 8790).
2. Playwright e2e on `mock`: boot → desktop passes contract → open `browser` → google-shaped page → search → results → click a result → page; open `calculator`, `notes`, `store` (install one app → it appears); reload a page and assert the document changed; moderation reroute test (local fallback list); caps test (429 after limit); `/api/engines` lists only keyed engines; no network request originates from any generated iframe (assert via request interception).
3. Real-engine smoke with the copied `.env` (`anthropic-haiku` and `openai-small`): one full boot each, open 3 apps, visit 3 URLs; screenshots to `reviews/shots-smoke/`; contract-miss and timing numbers in `reviews/SMOKE-1.md`. Iterate prompts until both engines pass the contract on ≥ 9 of 10 desktop generations.
4. Fast engines wired and testable the moment their keys land (no code change, only `.env`).
5. Railway config present and `npm run build && npm start` works from a clean clone. Not deployed.
6. README and DEPLOY written; every deviation from this spec listed at the top of README under "Deviations", with one line of reason each.

## 11. Non-goals (v1)

Video playback, image models, accounts, persistence across reloads, share cards (people screenshot their own OS; the OS name is on screen), multiple users seeing each other, mobile-first polish beyond §2.2's full-size windows.

---

## 12. v0.1 amendments — Shahmir's first test, 2026-09-17 ~12:30 PKT (D84)

He booted every engine on `/bakeoff`. Verdicts, turned into rulings. These override anything above that conflicts.

### 12.1 Speed is the product

Every engine felt too slow, the fast ones included. Targets on the chosen fast engine, measured by the bake-off runner: boot screen painting **< 1.0 s** after the click; desktop **interactive < 4 s**; app window content **< 2.5 s**; page **< 2.5 s**. Means, all of them:

- **Identity folds into the boot stream.** `kind=boot` emits the identity JSON inside an HTML comment as its first ~120 tokens; the kernel parses it the moment it arrives and starts the desktop (and the image calls, §12.5) immediately. No separate identity round trip.
- **Token budgets cut:** desktop ≤ 3,500, app ≤ 2,500, page ≤ 2,500, boot ≤ 800, repair = patch (§12.2). Prompts demand compact markup: shared classes, no decorative CSS bloat, no comments, no filler content. The archetype and the hooks matter; volume does not.
- **Moderation off the critical path.** The local list runs synchronously (microseconds). The remote moderation call runs in parallel with the generation; if it flags after the stream has started, the server aborts the stream and the kernel starts the rerouted generation (rare path, may repaint).
- **Speculative generation, not caching.** The browser's chrome and its google-shaped home generate in parallel the moment the browser opens. On `mousedown`/`touchstart` on any launcher, that app's generation starts before the click completes. A speculative generation is shown at most once and then discarded; ruling 1.1 stands.
- **TTFB breakdown in telemetry:** `moderation_ms`, `server_ms`, `provider_ttfb_ms`, so slowness is attributable.

### 12.2 No visible document is ever replaced except by a user action

He saw screens load, be unclickable, then change to a different UI. Rulings: interactivity attaches during streaming (event delegation from the first chunk, not at `document.close()`); the repair pass is a **patch** that injects the missing hooks in place, never a regeneration; the boot screen swaps to the desktop only when the desktop is interactive; a nested page frame fills an empty page area and never overwrites a painted one; generated scripts that rebuild their own document on load are the model's business, but the kernel must never be the cause. The kernel re-review verifies this with a test that fails if any mounted document's root node is replaced without a user event.

### 12.3 Desktop archetypes — "it should be a proper OS desktop"

The desktop prompt requires the model to pick **one** archetype and follow its structure exactly. Era, colours, names, wallpaper, icon art, fonts, sounds, wording, menu contents remain the model's.

- **`taskbar`** (Windows-shaped, any version the model likes): a bar along the bottom edge with a launcher/start control at one end, one entry per open window in the middle, and a ticking clock with the date at the other end; launchers as **icons in a grid on the wallpaper**, top-left aligned, label under icon; windows with a title bar carrying minimize, maximize and close at the right.
- **`dock`** (Mac-shaped, any version): a menu bar along the top with the OS name or menu at the left and a ticking clock at the right; a dock along the bottom (or a side) holding the launchers as icons; desktop icons optional and top-right aligned if present; windows with three coloured controls at the left of the title bar.

Icons stay icons: a launcher is an icon with a label, never a list row and never only a menu entry (a menu may exist in addition). A clock that ticks (the model writes its own script) and a visible date are required. A **boot screen is required and stays visible ≥ 2.5 s** while the desktop generates behind it. Contract hooks (§3.2) are unchanged; the archetype is validated by two extra hooks: `[data-os-archetype="taskbar|dock"]` on `<html>` or `<body>`, and `[data-os-clock]` on the clock element.

### 12.4 Identity variety — the server rolls the dice

Two Haiku boots in a row named themselves Meridian 2.x. The word is not in any prompt; the model's prior converges. Rulings: the **server** draws era decade, setting (from a list of ≥ 60), temperament (≥ 30), and two material words (≥ 40 each) from lists in `data/dice.json` and passes them as hard constraints; a server-side ring buffer of the last 200 OS names generated is passed as "never use these"; identity sampling at temperature ≥ 1.2 where the engine allows; the example-name list is removed from the identity prompt (examples are attractors).

### 12.5 Images — SVG icons are not good enough

fal `fal-ai/flux-1/schnell`: $0.003 per image at any size ≤ 1 MP (billing rounds up to the megapixel), ~0.8 s, commercial use. Per boot, two calls started in parallel with the desktop the instant identity is known: a **wallpaper** (1024×576) and an **icon sheet** (1024×1024, a 4×4 grid, one cell per manifest app in manifest order, prompt derived from identity and each app's shape; the kernel slices cells by `background-position`; Store-installed apps trigger one extra 1×4 strip on demand). The desktop HTML references them through `data-os-img="wallpaper"` and `data-os-icon="<appId>"` attributes the kernel fills with `data:` URIs (CSP unchanged, still no network from generated content). Photos app: 4 images per open, lazily, ~$0.012. Contact-, profile- and social-shaped pages: one "faces" sheet per page, sliced. Maps: one image, "a map of a city that does not exist, top-down, muted cartographic colours", as the map surface, with the model's SVG pins, labels and routes on top. Limits: ≤ 4 image calls per boot, ≤ 4 per app open, ≤ 2 per page; image cost counts toward the daily USD cap; when `FAL_KEY` is absent, fall back to SVG as before. Image prompts are moderated the same way as text.

### 12.6 `/bakeoff` is a landing page

It lists the keyed engines with their measured tokens/s and price, has a **Boot** button per engine, and boots only on click. `/` is unchanged (boots straight into the default engine).

### 12.7 Maps stays, on the image surface (§12.5)

Dropped after bake-off #2 if it still reads as noise.

### 12.8 Engine choice

Decided by BAKEOFF-1 numbers plus his play. Until then the default engine is the fastest one that passes the contract (`cerebras-oss120`), and Mercury 2.5 is the challenger on variety and price. Qwen 3.8 is out unless its verbosity is tamed by the budget cut.

### 12.9 v0.2 rulings from BAKEOFF-3's open issues (2026-09-17 evening, HANDOFF-4)

Three decisions taken while closing BAKEOFF-3's list. They are here because each one is a rule about the product, not an implementation detail.

- **One image lane for the whole process, two at a time, boot pictures first.** A picture holds a `POST /api/img` open for 3–14 s. Four of those (the doc lane's two plus the boot's two, which bypassed it) alongside the boot and desktop streams is six connections, which is a browser's per-origin HTTP/1.1 limit — so the next `POST /api/gen` never left the browser and an app window stayed blank with no telemetry line anywhere. Generations are never starved of a connection: at most two images, and the kernel never needs more than three live generations.
- **A page is not worth a picture until it has been looked at.** Page pictures die with the navigation that leaves the page, which is right; but the money is spent before that and the visitor spends the interval looking at a reserved empty block. A page therefore waits `PAGE_IMG_DWELL_MS` (1.2 s) before its slots are bought, and a page left inside the dwell is never bought for. Apps keep no dwell: an app document stays on screen after its generation ends and its pictures live as long as its window.
- **Desktop icons below windows below the taskbar, repaired by the kernel.** §12.3 describes a desktop's parts and not their stacking, and stacking is geometry, which §2.2 gives the kernel. It raises the windows layer above `[data-os-desktop]` and the bar above the windows layer, only where the model's own document would have lost, and drops pointer events on a windows layer the model left empty so the launchers underneath stay clickable.

Also measured and reverted: the wallpaper's 2 inference steps. 2 and 4 are indistinguishable in latency (2.9–14.1 s either way; the variance is fal's queue), so the picture that fills the screen takes the detail.
