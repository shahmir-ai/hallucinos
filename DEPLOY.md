# DEPLOY — Railway runbook

SPEC §1.9: **Railway. Never Vercel.** This file is the runbook; the deploy itself is Fable's call and has not been done.

## Password gate (read first)

Everything except `/healthz`, `/robots.txt` and `/login` sits behind one shared password (`server/auth.ts`). Nobody without it can reach `/api/gen` or `/api/img`, so nobody can spend the provider credit. The API keys never leave the server either way.

| variable | what it does |
|---|---|
| `APP_PASSWORD` | the password. **Unset on Railway = the service refuses every gated route with 503** (fails closed). Unset locally = no gate, which is how dev and the test suites run |
| `AUTH_SECRET` | signs the 30-day login cookie. Optional; without it a key is derived from the password, so changing the password signs everyone out |

Ten wrong guesses from one IP lock that IP out for 15 minutes. `robots.txt` disallows everything.

## What gets deployed

One Node 22 service. `npm run build` produces two artefacts and nothing else is needed at runtime:

- `dist/server.js` — the whole server, bundled (Hono + everything under `server/`).
- `public/kernel.js` — the kernel bundle, with the injected runtime inlined as a string.

At runtime the process also reads, from the repo, `engines.json`, `manifest.json`, `prompts/**` and `data/videos.json`. They are data, not code: changing a prompt or adding an app is a redeploy, not a rebuild of anything else.

`railway.json` is already present: NIXPACKS (which runs `npm ci` itself), build `npm run build`, start `node dist/server.js`, healthcheck `/healthz`.

## First deploy

1. **New service** in the Railway project, from this repo, **root directory: the repo root** (this repo holds only hallucinos).
2. **Variables** (below). At minimum one engine key, or the service will only offer `mock`.
3. **Volume**: mount one at `/data` and set `CAPS_STATE_FILE=/data/caps-state.json` **and** `NAMES_RING_FILE=/data/names-ring.json`. Without the first, the day counters live in memory and every redeploy hands the world a fresh daily budget; without the second, SPEC §12.4's "never use these names" ring resets and the first visitor after a deploy can be handed the name the last one got.
4. Deploy. `/healthz` must return `ok`; the first stdout line is a JSON `listening` record that names the engines it found, **what `/` will actually boot** (`default_engine`, `pinned`), **when a second lane gets bought** (`hedge_after_ms: {boot, desktop, other}`), the moderation mode and the caps — read it and check it says what you meant. T1 added the middle two because HANDOFF-6 §2 existed for two versions: neither was printed anywhere, so a deploy could not be checked against its own recipe.
5. Open `/` and boot the thing. Then open `/bakeoff` and watch the HUD for one boot.

## Variables

| variable | what happens without it |
|---|---|
| `PORT` | Railway sets it; the default is 8790 |
| `HOST` | **unset — every interface, IPv4 and IPv6** (the node wildcard), which is what Railway's edge needs and what lets a phone on the same Wi-Fi open `http://<laptop LAN ip>:<port>/` (README, "Test it on your phone"). It is a variable and not a hard `0.0.0.0` because that literal drops IPv6, and `localhost` resolves to `::1` first on macOS — the address the e2e suite uses. `HOST=127.0.0.1` binds loopback only (verified both ways, `reviews/SERVER-v06.md`); never set it on Railway |
| `DEFAULT_ENGINE` | the routed, hedged lane (`auto`) wherever the routing table resolves; otherwise the first keyed engine in `engines.json` order. **Set it explicitly.** Which engine every anonymous visitor gets is the single biggest cost and quality decision in the deploy. **T1/D6 (v0.5) made this variable work on `/`**: until v0.5 a value naming a real engine was ignored there (only a mock was honoured), so the recipe in this table's own earlier version — `DEFAULT_ENGINE=cerebras-oss120` — left `/` routed and hedged at the hedged price, reproduced three times in `reviews/HANDOFF-6.md` §2/R6. Now a keyed engine id IS what `/` boots: `/api/engines` answers `{"default":"<it>","pinned":"<it>"}`, the kernel page carries `<body data-engine="<it>">`, and the `listening` line prints both. A typo falls through to `auto`. `reviews/BAKEOFF-1.md` is the evidence for choosing; `reviews/HEDGE-3.md` and `reviews/SERVER-v05.md` are why `auto` is the lever for a bad hour rather than the default |
| `OPENAI_API_KEY` | no `openai-small`, **and moderation falls back to the local list** |
| `ANTHROPIC_API_KEY` | no `anthropic-haiku` |
| `CEREBRAS_API_KEY` `GROQ_API_KEY` `INCEPTION_API_KEY` `GOOGLE_API_KEY` `OPENROUTER_API_KEY` | those engines simply do not appear in `/api/engines` or the picker. `GROQ_API_KEY` is empty by design (no developer plan on this account): Groq is reached through `OPENROUTER_API_KEY`, which turns on `or-oss20-groq`, `or-oss120-groq` and `or-oss20-fast`. **`OPENROUTER_API_KEY` is also what makes the hedge exist**: it holds the hedge engine of every route in `engines.json`, and without it `auto` silently demotes to its primary alone (no error, no hedge, `/api/engines` still advertises `auto`) |
| `HEDGE_AFTER_MS` | 900 — how long a routed `app`/`page`/`repair` waits for a content token from the primary before the hedge lane is started (H2). Only ever read when the request asks for `auto`. HEDGE-3 alternated it against unhedged over 20 pages: +20% on the bill ($0.00335 vs $0.00279) and no median speed-up (929 ms vs 801 ms), and one page won outright by Groq while Cerebras produced 0 output tokens |
| `HEDGE_AFTER_MS_BOOT` | **0 — `boot` ONLY, and deliberate** (T1, architect's ruling): the boot stream is the first pixel of the product and the smallest prompt in it, so both lanes always race. What it costs, measured tonight over 40 alternated real boots (`reviews/SERVER-v05.md`, `reviews/hedge-6-triggers*.json`): **+34% per boot** ($0.00292 vs $0.00217) for **no median speed-up at this hour** (911 ms vs 861 ms to first content) and a p90 inside the noise. The primary won 40 of 40, so tonight the second lane was insurance that never fired — which is what the ruling buys, not speed. Set it to `1200` if a third of a cent a boot ever matters more than that insurance |
| `HEDGE_AFTER_MS_DESKTOP` | **600** (T1, new — the fix for D6). Before v0.5 the desktop shared `HEDGE_AFTER_MS_BOOT`, whose default is 0, so **every routed boot bought two desktops** — the biggest prompt and the biggest document in the product, for a lane that loses 19 times in 20. That, and not the boot, is what HEDGE-2's and HEDGE-3's "set it to 1200" was mostly pricing. 600 ms is past a good hour's first content token and well short of a bad hour (2.1-4.7 s of provider TTFB, measured on the same day as 0.55-0.7 s) |
| `ROUTING` | routing is ON: `engine:"auto"` resolves through `engines.json`'s `routes.default`. `ROUTING=off` makes `auto` behave exactly like `DEFAULT_ENGINE` and nothing is hedged — the kill switch |
| `ROUTES_JSON` | the table comes from `engines.json`. Setting it overrides that file for one process |
| `GEN_PER_IP_PER_HOUR` | 60 |
| `MAX_GEN_PER_DAY` | 10000 |
| `MAX_USD_PER_DAY` | **25** — the real ceiling (SPEC §1.8); set it *below* the prepaid credit on the providers |
| `CAPS_STATE_FILE` | day counters are memory-only and reset on every restart |
| `NAMES_RING_FILE` | the recent-OS-names ring is memory-only; identity variety (SPEC §12.4) degrades across restarts |
| `FAL_KEY` | **no images at all** (SPEC §12.5): `POST /api/img` returns 404 and the kernel keeps its SVG fallback. The OS still boots. Each image is a flat per-call charge (the model's own per-megapixel rate, since every size is under 1 MP) and counts against `MAX_USD_PER_DAY` like tokens |
| `IMG_MODEL` | `fal-ai/flux-1/schnell` at $0.003 an image. An **unrecognised value falls back to the default** rather than failing, so a typo cannot take the pictures away from every visitor. The alternatives, measured head to head on one prompt and one size (48 images, `reviews/IMG-LATENCY-2.md`): `fal-ai/sana/sprint` $0.0025 / 2,447 ms median, `fal-ai/sana` **$0.001** / 2,900 ms median and the tightest variance in the run, `fal-ai/z-image/turbo` $0.005 / 6,272 ms — **rejected**. The top three are inside each other's noise at n=6, so the default did not move on a 6% median; `sana` is a 3× cut on the image line of every boot and wants one eyes-on quality pass first. Every endpoint's rate is reserved and billed correctly and every image line carries `img_model` |
| `TRUST_PROXY` | **X-Forwarded-For is ignored** and every visitor shares one rate-limit bucket. Set `TRUST_PROXY=1` on Railway (its edge terminates the connection) and nowhere else — anywhere this process is reachable directly, a client that rotates the header mints itself unlimited buckets |
| `TRUSTED_PROXY_HOPS` | 0 — correct for Railway's single edge proxy (see below) |
| `MAX_CONCURRENT_GEN` | 12 — how many text generations may hold budget at once |
| `MAX_CONCURRENT_IMG` | 6 — the same for images, a **separate** lane: sharing the text lane let slow wallpapers serve every visitor the over-capacity screen |
| `GEN_TIMEOUT_MS` | 25000 — the wall clock on one generation (SPEC §12.1). BAKEOFF-1 saw a 180 s hang; this is what ends it |
| `IMG_TIMEOUT_MS` | **20000** (T3, raised from 18000) — the same, per fal image call. IMG-LATENCY-2 measured 48 images across four endpoints on the `sync_mode` path: medians 2.4-2.9 s, p100 3.2-3.6 s, 0 failures — but BAKEOFF-4 saw 8.9 s median and 13.7 s worst on the same code, and HANDOFF-6 an icon sheet at 13.0 s quiet and 14.2 s under load, so the distribution is fal's queue and not ours. Generous by design: nothing on screen waits for a picture, and a tight ceiling buys an empty grey square (BAKEOFF-3 lost fifteen of sixteen app pictures to a 10 s one) |
| `MARK_PER_IP_PER_HOUR` | 600 — flood bucket on `POST /api/mark` (it buys no tokens, so it is outside the generation cap) |
| `NAME_PER_IP_PER_HOUR` | 60 — the same for `POST /api/identity-seen`, which writes the global never-names ring |
| `MODERATION_ENDPOINT` `FAL_ENDPOINT` | **leave empty.** Test-only redirection of the moderation and image calls. `FAL_ENDPOINT` overrides `IMG_MODEL`'s URL entirely |
| `IP_SALT` | a constant default; set it to a long random string so rate-limit hashes are not comparable across deploys |
| `MOD_SALT` | falls back to `IP_SALT` |
| `MODERATION` | `auto` (OpenAI when keyed, local list otherwise). `local` forces the list, `off` disables it — never `off` in production |

### TRUSTED_PROXY_HOPS

The client address is read from the **rightmost** `X-Forwarded-For` entry, because a client can put anything it likes on the left. With Railway's edge in front of the process, the rightmost entry is the real client and `TRUSTED_PROXY_HOPS=0` is right. If another proxy of yours is added in front (Cloudflare, a custom load balancer), raise it by one per added hop and verify: send a request with `X-Forwarded-For: 10.0.0.1` from two different machines and confirm they land in different rate-limit buckets (watch `ip_hash` in the stdout lines).

## Cost, in one paragraph

`/api/stats` reports today's generations, tokens, spend and how close the caps are. The stop is `MAX_USD_PER_DAY`: before any token is bought, the generation is priced at its full output budget and refused with a `429 {queue:true}` if that would cross the ceiling — the same queue screen a rate-limited visitor sees. Budget arithmetic for a full day at `MAX_GEN_PER_DAY=10000`, if the money cap were not there: `groq-oss20` ≈ $26, `cerebras-oss120` ≈ $41, `anthropic-haiku` ≈ $263. So the count cap is not a budget; set `MAX_USD_PER_DAY` and treat prepaid credits on each provider as the last line (SPEC §8).

## Watching it

Every generation prints one JSON line to stdout: `{ts, kind, engine, ip_hash, tokens_in, tokens_out, ttfb_ms, total_ms, tok_per_s, usd, contract_ok, rerouted}`, plus `truncated` when the output cap fired, `mod_hash` only when moderation fired, and `error` when a provider failed (with the detail redacted of anything key-shaped). Railway's log search on `"contract_ok":false` is the prompt-quality alarm; on `"error"` the provider alarm.

## Rolling back

Redeploy the previous Railway deployment. There is no state to migrate — nothing generated is ever stored, and the only persistent file is the day-counter mirror on the volume, which any version can read or recreate.

## Things that will break it

- **No `public/kernel.js`** — the page loads and stays black. The `listening` line says `MISSING — run npm run build`. Cause: a build that ran `tsc` instead of `npm run build`.
- **A provider that renames `max_tokens`** — output runs long. The server's own byte ceiling stops it and marks the line `truncated:true`; fix the engine's `extraBody` in `engines.json`.
- **`MODERATION=auto` with no `OPENAI_API_KEY`** — the local list is used silently. That is by design (SPEC §6), but it is a much blunter instrument; prefer keeping the OpenAI key present, since the moderation endpoint is free.
- **`DEFAULT_ENGINE` set and `/api/engines` still answering `default: auto`** — that was the v0.4 behaviour and it is fixed (T1/D6); if you see it after v0.5 the deploy is running an older build, and every boot is being hedged at the hedged price.
- **`HEDGE_AFTER_MS_DESKTOP` unset on an old build** — harmless on v0.5 (600 is the code default) but on v0.4 and earlier the desktop shared the boot's 0 and every routed boot bought two of them.
- **Long-lived responses through an over-eager CDN** — generation responses are `no-store` and carry `x-accel-buffering: no`; do not put anything in front that buffers, or the whole point (watching it paint) is gone.
