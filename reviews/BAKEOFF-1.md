# BAKEOFF-1 (SPEC §7) — partial, and honest about it

Run 2026-09-17. **This is not the complete judging run SPEC §7 asks for**, and it
should not be read as one. It is what a machine under heavy competing load got
through before the time box closed, plus every number that *was* measured
cleanly. The verdict at the bottom is a shortlist, not a decision.

What exists here:

| engine | full boots (4 apps + 6 page loads each) | desktop contract, sweep of 6–8 | judged |
|---|---|---|---|
| `cerebras-oss120` | **3** | **6/6** | yes |
| `or-oss20-groq` | **1 complete + 1 partial** | **6/6** | partly |
| `or-oss120-groq` | 0 | **6/6** | contract only |
| `or-oss20-fast` | 0 | **6/6** | contract only |
| `mercury-2.5` | 0 | **8/8** (5/6 before the reasoning fix) | contract only |
| `cerebras-qwen38` | 0 | **5/8** (1/6 before the token-cap fix) | contract only |
| `anthropic-haiku` | 3, earlier run, shots cleared | **10/10** | reference, see SMOKE-1 |
| `openai-small` | 1, earlier run, shots cleared | **8/8** | reference, see SMOKE-1 |

To finish it on a quiet machine:

```bash
npm run bakeoff -- --engines=cerebras-oss120,or-oss20-groq,or-oss120-groq,or-oss20-fast,mercury-2.5,cerebras-qwen38 --boots=5 --budget=8
```

It will cost roughly $2 and take about an hour. `Ctrl-C` now writes the report
with whatever finished rather than throwing the run away — that was added
because this run lost two earlier attempts to exactly that.

## Speed: the thing the fast engines were keyed for

Time to a live desktop, from the first byte of the page load, median of the boots
that completed:

| engine | boot screen first paint | desktop live | tok/s (HUD, page generations) | $/desktop |
|---|---|---|---|---|
| `cerebras-oss120` | **1.1 s** | **2.3 s** | 1,038–1,240 | $0.0028 |
| `or-oss20-groq` | 1.6 s | 4.3 s | 638 | $0.0012 |
| `anthropic-haiku` | 8.2 s | 21.4 s (best of 3; worst 29 s) | 174–184 | $0.026 |
| `openai-small` | 9.6 s | 20.3 s | 129–155 | $0.0016 |

SPEC §2.2's target is "boot screen painting within 1.5 s, desktop live within 6 s
on a ≥1,000 tok/s engine". `cerebras-oss120` meets it; nothing else has been shown
to. The reference engines miss it by a factor of four to ten, and that is the
whole argument for the fast slot: **a hallucinated OS that takes twenty seconds to
appear is a different product from one that takes two.**

Per page load, wall clock (click to document closed, including about 1 s of the
harness's own polling):

| engine | google home | search results | first result | reddit | netflix | wikipedia |
|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1.3–2.2 s | 2.4–3.6 s | 2.1–2.4 s | 2.4–2.9 s | 2.1–2.5 s | 2.5–3.3 s |
| `or-oss20-groq` | 2.0–2.5 s | 2.8–3.2 s | 3.3 s | 3.3–3.7 s | 2.5 s / **one 180 s timeout** | 2.9 s |
| `anthropic-haiku` | — | 24–28 s | 17–20 s | 27–41 s | 18–26 s | 14–20 s |

## Contract and failures

- `cerebras-oss120`: 3/3 boots and 6/6 sweep desktops passed the contract. No
  broken renders, no JS errors in the boots that completed.
- `or-oss20-groq`: 2/2 boots passed, 6/6 sweep. Two defects worth naming:
  - **boot 1's identity failed to parse** and the kernel's fallback named the
    machine `UNNAMED/VAUF`. That is `coerceIdentity` doing its job, but it means
    the model returned something that was not the identity JSON. One in two is
    far too often for the one generation whose whole purpose is the name on
    screen.
  - **`netflix.com` never arrived** on boot 2: 180 s, blank, unstyled, JS error.
    The step's own timeout is what ended it.
- `cerebras-qwen38`: **5/8**, the only engine that fails SPEC §10.3's gate. Not a
  prompt problem — it writes past 7,000 output tokens on every desktop and was
  being cut off mid-document (`finish_reason: length`, now surfaced as
  `truncated` in the telemetry). Raising its cap to 12,000 took it from 1/6 to
  5/8; the rest of its misses are dropped launchers at the end of the list. It is
  a verbose model against a budget, and it costs 12k tokens a desktop to be
  mediocre at this.
- `mercury-2.5`: **8/8** once `reasoning_effort: "none"` was set. Before that it
  returned empty content every time — every token went to reasoning. Its tokens
  arrive in blocks (it is a diffusion model) and the kernel paints each block as
  it lands, so progressive painting survives.

## Cost, per visitor

One boot with four apps and six pages, taken from the telemetry of the boots that
ran (`cerebras-oss120`) or extrapolated from its desktop cost (the rest):

| engine | $/session | at 1,000 sessions/day |
|---|---|---|
| `or-oss20-groq` / `or-oss20-fast` | ~$0.008 | ~$8 |
| `mercury-2.5` | ~$0.004 | ~$4 |
| `cerebras-oss120` | ~$0.015 | ~$15 |
| `or-oss120-groq` | ~$0.015 | ~$15 |
| `cerebras-qwen38` | ~$0.030 | ~$30 |
| `openai-small` | ~$0.010 | ~$10 |
| `anthropic-haiku` | **~$0.17** | **~$170** |

SPEC §1.8's ceiling is $25/day. On `anthropic-haiku` that is 150 visitors. On the
Groq-through-OpenRouter engines it is roughly three thousand. That is the second
argument for the fast slot, and it is not close.

Mercury's prices are the ones Inception's own `/models` reports — $0.04 in /
$0.15 out per 1M, far below the $0.25/$1.00 the spec estimated. Groq's came from
OpenRouter's per-provider endpoint listing.

---

## Funniness and variety — my read

Taste is the thing the harness cannot score, so this is a person's opinion with
the evidence attached. Shots for `cerebras-oss120` and `or-oss20-groq`:
`reviews/shots-bakeoff/<engine>/<boot>/`. **The `anthropic-haiku` and
`openai-small` shots referenced below no longer exist**: those boots came from an
earlier run of this same harness, and `reviews/shots-bakeoff/` was cleared when
the run was restarted after a harness fix. What survives of haiku's output is
`reviews/shots-smoke/`, from the first smoke run and therefore from the older
prompts. The descriptions are from the images as they were watched; regenerating
them costs two more haiku boots (about $0.45), which the command at the top of
this file will do.

### `cerebras-oss120` — fast, competent, and it keeps having the same idea

Machines: **Mosaic Rift 7**, **Granite Desk**, **QuarkBridge 7** (this run);
**Granite Desk**, **Granite Desk**, **Granite Ledger**, **Aetherforge Sentinel**,
**Garnet Forge**, **TerraMold 9**, **Nimbus Quarantine**, **Nimbus Forge**,
**FjordVault** in earlier runs.

Read that list again. Across eleven boots it produced *Granite Desk* three times,
*Granite Ledger* once, *Garnet Forge* once, *Nimbus* twice and *Forge* three
times. **This is the weakest thing about it and it is a product problem, not a
cosmetic one**: SPEC §0's hook is "every boot is a different OS with a different
name, look and personality" and people are meant to screenshot theirs and
compare. Two people getting *Granite Desk* kills that. The palettes repeat too —
slate-blue with a yellow or magenta accent, three times out of three here.

What it does well is *inside* the pages. `QuarkBridge 7`'s search results are the
best single artefact of the whole run: "Pizza Place — Classic & Artisan Pizzas,
42 Oak Street, Townsville, open 11am–11pm, best-selling Margherita uses 0.4 lb of
fresh mozzarella, delivery in 30 min for $3.99", next to a Quick Facts panel that
says the average pizza price in Townsville is $13.45 and that pepperoni is on 68%
of orders. A status bar under it reads `host: search.quarkbridge.local ·
conn-age: 0.4 · Δ-units: 7`. Its r/cats has 3,212,874 subscribers, 12,305 online,
five subreddit rules, and posts by `u/whiskerwizard`, `u/purrfectpics` and
`u/marketmeow` — "Cat entrepreneur launches catnip coffee", 9.1k, 219 comments.
That is the product working.

App naming is the other bright spot: `trash` became **The Chute**, `taskmgr`
became **Floor Supervisor**, `terminal` became **Speak Plainly**, `maps` became
**Cartograph**. The launcher art is weak — flat squares and circles in one accent
colour — and the desktop is mostly empty space.

Funny? 3/5 · Varied across boots? **1.5/5** · Would you screenshot it? Yes, once.

### `or-oss20-groq` — more character per boot, less reliable

Machines: **UNNAMED/VAUF** (identity failed to parse) and **Quillium**.

`Quillium`'s desktop is the best-looking shell in the run: a dark slate rail down
the left with a warm ochre field beside it, serif labels, and the apps renamed
into one consistent voice — **Nave**, **Captures**, **The Chute**, **Compute**,
**Trade**, **Correspondence**, **Chatter**, **Speak Plainly**, **Floor
Supervisor**, **Atlas**, **Forecast**, **Ledger**, **Chronicle**. That is a
machine with an opinion, and it arrived in 4.8 s for a tenth of a cent.

Against that: one identity in two came back unparseable, and one page load in six
never arrived at all. Two boots is not enough to know whether that is bad luck.

Funny? 3.5/5 · Varied? not enough data · Would you screenshot it? Yes.

### `anthropic-haiku` — the best writer, at ten times the price and ten times the wait

Machines: **Meridian**, **Tidewatch**, **Mnemosyne**, **TIDETRACK**. No repeats
in four, and the personalities are legible: Meridian is a 1987 field-survey
machine whose window furniture includes a compass version string set sideways in
9px type; Mnemosyne is a blue-title-bar 1995 workstation whose Software Store
says "Version 2.4 — 847 titles available" and sells **INDEXER PLUS** by *Systema
Corporation* — "full-text search across your entire filing system with Boolean
operators and proximity matching, inverted index updated hourly". Tidewatch's
taskbar reads `TIDE: RISING · AGE: 47 MIN · FLOW: 0.73 KG/S` and never explains
itself.

It is the only engine whose desktops feel *designed* rather than assembled. It is
also 21–29 s to a desktop and about $0.17 a visitor. As the model behind `/` it
is unaffordable; as the thing Shahmir shows people, it is the one that sells the
idea.

Funny? 4.5/5 · Varied? 4/5 · Would you screenshot it? Yes, repeatedly.

### `openai-small` — cheap, fast enough, and thin

**Clypeus Protocol**, **Nebula Forge**. Now reliably passes the contract, but the
documents are short (1,100–3,200 output tokens against haiku's 3,500–4,600) and
it shows: bare launcher grids, little invented detail, pages that stop after a
paragraph. It is the reference engine, and it reads like one.

### Not judged on taste

`or-oss120-groq`, `or-oss20-fast`, `mercury-2.5` and `cerebras-qwen38` produced
no full boots in this run — only desktops, through the sweep. Their contract
numbers are above; their character is unknown. `or-oss20-fast` is the same model
as `or-oss20-groq` with the provider chosen by throughput rather than pinned, so
it is a routing experiment rather than a taste one.

## Verdict

**Shortlist for Shahmir to play with on `/bakeoff?engine=<id>`:**

1. **`cerebras-oss120`** — the only engine that meets SPEC §2.2's timing target
   (2.3 s to a live desktop). Cheap enough. **Its variety problem must be solved
   before it can be the default**: try a higher temperature for `kind=identity`
   only, or feed the seed into the identity prompt more aggressively. If eleven
   boots produce three Granite Desks, the hook does not work.
2. **`or-oss20-groq`** — half the cost, 4.3 s, and the best-looking single shell
   in the run. Needs five clean boots before anyone trusts it: one bad identity
   and one dead page load in two boots is not a rate, it is a warning.
3. **`anthropic-haiku`** — not a candidate for `/`, but keep it on `/bakeoff` as
   the quality ceiling and for anything Shahmir films.

**Do not ship `cerebras-qwen38`**: 5/8 on the contract, twelve thousand tokens a
desktop, and it is the most expensive of the fast engines.

`DEFAULT_ENGINE` is still unset, which means `npm start` silently picks
`cerebras-oss120` by file order. That happens to be the right answer today, but
it should be written down rather than fallen into.
