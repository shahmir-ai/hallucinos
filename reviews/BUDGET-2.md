# BUDGET-2 — reasoning inside `max_tokens`, measured on the document kinds

2026-09-17, ~20:26–20:34 PKT. HANDOFF-5's brief item 1: run the boot-budget
probe (`scripts/boot-budget.mjs`, SERVER-v03 §2) again for `app`, `page` and
`desktop`, on `cerebras-oss120` and `or-oss120-groq`, then set per-kind
`max_tokens` so content is never starved.

**Instrument:** `scripts/kind-budget.mjs` (new). The real prompt files, the
real engines, non-streaming, at the current budget and a raised one, reporting
`completion_tokens`, `completion_tokens_details.reasoning_tokens`,
`finish_reason`, whether a `<!doctype` came back and whether `</html>` closed
it. Raw rows: `reviews/budget-2-calls.json` (54 calls).

**Spend: $0.137** of the $0.30 ceiling (4 + 36 + 12 + 6 calls, $0.0085 +
$0.0835 + $0.0275 + $0.0172). No server was started and no port was used.

---

## The headline: the median document is nowhere near its cap, and `photos` is

| engine | kind | shape | budget | n | `finish=length` | median out | p100 out | median reasoning | closed |
|---|---|---|---|---|---|---|---|---|---|
| cerebras-oss120 | desktop | 16 launchers, taskbar | 3,500 | 3 | 0 | 1,636 | 1,654 | 164 | 3/3 |
| cerebras-oss120 | desktop | " | 5,000 | 3 | 0 | 1,577 | 1,697 | 152 | 3/3 |
| or-oss120-groq | desktop | " | 3,500 | 3 | 0 | 1,737 | **1,864** | 156 | 3/3 |
| or-oss120-groq | desktop | " | 5,000 | 3 | 0 | 1,642 | 1,649 | 104 | 3/3 |
| cerebras-oss120 | app | `notes` | 2,500 | 3 | 0 | 1,607 | 1,703 | 183 | 3/3 |
| cerebras-oss120 | app | `notes` | 4,000 | 3 | 0 | 1,545 | 1,696 | 154 | 3/3 |
| or-oss120-groq | app | `notes` | 2,500 | 2 | 0 | 1,557 | 1,609 | 211 | 2/2 |
| or-oss120-groq | app | `notes` | 4,000 | 2 | 0 | 1,515 | 1,559 | 150 | 2/2 |
| cerebras-oss120 | app | `browser` | 2,500 | 3 | 0 | 760 | 1,034 | 169 | 3/3 |
| cerebras-oss120 | app | `browser` | 4,000 | 3 | 0 | 801 | 922 | 247 | 3/3 |
| **cerebras-oss120** | **app** | **`photos`** | **2,500** | **3** | **1** | **1,991** | **2,500** | **258** | **2/3** |
| cerebras-oss120 | app | `photos` | 4,000 | 3 | 0 | 1,939 | **2,278** | 209 | 3/3 |
| cerebras-oss120 | page | reference | 2,500 | 3 | 0 | 1,267 | 1,346 | 250 | 3/3 |
| cerebras-oss120 | page | reference | 4,000 | 3 | 0 | 1,477 | **1,604** | 264 | 3/3 |
| or-oss120-groq | page | reference | 2,500 | 2 | 0 | 1,411 | 1,488 | 154 | 2/2 |
| or-oss120-groq | page | reference | 4,000 | 3 | 0 | 1,398 | 1,416 | 228 | 3/3 |
| cerebras-oss120 | page | `/search?q=` | 2,500 | 3 | 0 | 1,334 | 1,366 | 172 | 3/3 |
| cerebras-oss120 | page | `/search?q=` | 4,000 | 3 | 0 | 1,223 | 1,311 | 227 | 3/3 |

Three `or-oss120-groq` calls failed with an OpenRouter **429** (provider rate
limit, not a budget fault) and are excluded; the `n` column shows what
survived.

### Four findings

1. **HANDOFF-5's truncated app window is reproducible, and it is `photos`.**
   One of three `photos` opens at 2,500 hit `finish_reason=length` at exactly
   2,500 with an **unclosed** document — the same fingerprint HANDOFF-5
   photographed. The same app at 4,000 stopped on its own three times out of
   three, at 1,927 / 1,939 / 2,278 tokens. 2,500 is not a ceiling above this
   app's distribution; it is *inside* it.
2. **No other shape measured is near its cap.** Worst case per kind against the
   shipped budget: desktop 1,864 of 3,500 (1.9× headroom), `notes` 1,703 of
   2,500, `browser` 1,034, a reference page 1,604, a search-results page 1,366.
   The blank-window bug (HANDOFF-5 #1) is therefore **not** a budget fault —
   this probe rules the budget out for every kind except long apps.
3. **Raising a cap does not raise output.** Medians at the higher budget were
   flat or *lower* in 8 of 9 pairs (desktop 1,636 → 1,577; `notes` 1,607 →
   1,545; `photos` 1,991 → 1,939; search page 1,334 → 1,223). These documents
   are **prompt-bound, not budget-bound**: SPEC §12.1's brevity is being
   enforced by the prompts, exactly where SERVER-v03 §2 argued it should be. So
   the cap is headroom, not an invitation, and the measurement says so rather
   than the hope saying so.
4. **Reasoning is small at `reasoning_effort: low`, but it is not zero and it
   has a tail.** 73–333 tokens across 51 successful calls, median ~200. That is
   8% of a 2,500 budget on the median and 13% on the tail — enough to be the
   difference on a long document, which is how the `photos` call spent 332
   tokens thinking and then ran out of room to finish its markup. The boot
   probe's 1,681-token reasoning outlier (HANDOFF-4 #2) shows the tail is
   fatter than this sample; nothing here contradicts it.

---

## The ruling

`engines.json` `defaults.max_tokens`:

| kind | was | now | why |
|---|---|---|---|
| `identity` | 500 | 500 | unchanged; it emits one JSON object |
| `boot` | 1,600 | 1,600 | unchanged — 53 consecutive boots with a document (HANDOFF-5). Not re-probed; the brief asked for the three document kinds |
| `desktop` | 3,500 | **3,500** | p100 1,864. 1.9× headroom already. Raising it would only inflate the reservation |
| `app` | 2,500 | **4,000** | the one measured truncation. 1.75× over `photos`'s p100 of 2,278 |
| `page` | 2,500 | **3,200** | p100 1,604 measured, but a page's shape varies more than any other kind (article, listing, results, profile, video). 2× over p100, well short of app's cap |
| `repair` | 3,500 | **4,000** | a repair rewrites the whole document that ran out of room, so it needs the largest document cap, which is now app's |

**What the raise costs.** Nothing per token: `max_tokens` is a ceiling and
billing is on tokens produced, and finding 3 says the produced count does not
move. The real price is the **pre-reservation** —
`server/index.ts` estimates a generation at
`costUsd(engine, promptTokens, maxTokensFor(kind, engine))` and holds that
against `MAX_USD_PER_DAY` until the stream settles. On cerebras
(`usd_out` $0.69/M) app's extra 1,500 tokens of ceiling is **$0.001 more
reserved per app generation**, released the moment the generation ends. At
$25/day that is invisible. The second effect is the stream's byte ceiling
(`maxBytes = maxTokens × 5`), which goes from 12,500 to 20,000 bytes for an
app — the longest document in this probe was 6,917 characters, so the byte
ceiling was never the binding constraint and still is not.

**What it does not fix.** HANDOFF-5 #1, the app window that paints nothing at
all with no telemetry line. Finding 2 removes "the budget starved it" from that
list of hypotheses: a starved generation produces a *truncated* document with
`finish_reason=length` and a telemetry line, which is not what boot A showed.

---

## The instrument

`scripts/kind-budget.mjs`, ~$0.003 a call, prints its bill before it buys
anything and never starts a server:

```
node scripts/kind-budget.mjs                                   # 36 calls, the matrix above
node scripts/kind-budget.mjs --engines=cerebras-oss120 --kinds=app --app-id=photos --runs=3
node scripts/kind-budget.mjs --kinds=page --page-url='https://x.test/search?q=…'
node scripts/kind-budget.mjs --app-budgets=4000,6000
```

It assembles the prompts from the same files `server/prompts.ts` reads, with
the same variable names and the same optional fragments
(`user/reality.md`, `notes/reference.md`), against a frozen identity so it
measures the budget and not the weather of a fresh boot. It goes direct to the
provider rather than through `/api/gen` because the server's telemetry does not
carry `reasoning_tokens`, and the split between thinking and writing is the
whole question.

### Traps for the next pass

- **The middling shape hides the fault.** `notes` at 2,500 is clean three times
  out of three; `photos` at the same budget truncates. A per-kind budget is a
  claim about the *longest* document of that kind, so probe the longest one —
  which for `app` means `photos`, and would mean `store` or `games` next.
- **An OpenRouter 429 looks like a failed measurement and is not.** Three calls
  died on the provider's rate limit mid-run. The probe records `ok:false` with
  the status so the summary's `n` shrinks instead of the medians lying.
- **`visible_tokens` in the raw rows is `chars / 3.6`, not a tokeniser.** It is
  there to show the split, never to bill; `completion_tokens` is the provider's
  own number and is what the rulings above rest on.
