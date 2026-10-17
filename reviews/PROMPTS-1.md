# PROMPTS-1 — the v0.1 prompt rewrite (SPEC §12, interfaces I1–I8)

2026-09-17. Prompt library only: `prompts/**` and `data/dice.json`. No code touched,
nothing committed. Measured on the real engines with a throwaway probe (below),
total spend **under $0.10**.

## What changed, file by file

| file | change |
|---|---|
| `system/boot.md` | rewritten. Now owns the **identity** as well as the boot screen (I1): the reply opens with one `<!--os-identity:{…}-->` line carrying the SPEC §3.1 fields **plus `archetype`**, then `<!doctype html>`. Dice are hard constraints, `never_names` is honoured, the example-name list is gone (SPEC §12.4), budget 800 including the identity line, fixed head order so text paints in the first ~100 tokens |
| `system/identity.md` | same field list including `archetype`, same dice rules, no example names. Still bare JSON — this is the server's fallback call when the boot comment fails to validate (I1), and the reboot path |
| `system/desktop.md` | the two archetypes of §12.3 with a structural skeleton each (taskbar / dock), icons-stay-icons, ticking clock + visible date, the two new hooks (I5), the wallpaper and icon picture slots (I3), budget 3,500, compact-markup rules. The nine-hook list and the closing tick-list both updated |
| `system/app.md` | budget 2,500, compactness, and a picture-slot section that is **only available to apps whose shape file asks for pictures** (≤ 4 per window) |
| `system/page.md` | budget 2,500, compactness, and the three page slots (≤ 2 per page): one photograph, one faces sheet, one map. Poster walls and thumbnail grids stay SVG |
| `system/voice.md` | §1 now allows the boot kind's identity line before the doctype; new §4 states the picture-slot contract once for every kind; §12 carries the new budget table and the compactness rules (shared classes, no comments, cheap SVG, spend on words not tags) |
| `user/boot.md` | `{{dice_json}}` + `{{never_names}}`; no more `identity_json` (boot writes it) |
| `user/identity.md` | `{{dice_json}}` + `{{never_names}}` |
| `user/desktop.md` | `{{archetype}}` echoed literally, nine-item checklist |
| `apps/maps.md` | rewritten for the `data-os-img="map"` surface with the SVG pins/routes/labels in a separate absolutely-positioned overlay |
| `apps/photos.md` | rewritten for four `data-os-photo="<camera caption>"` slots, slot reuse for the large view, everything else still drawn; no links in the app at all |
| `apps/calculator.md` | rewritten to his ruling: **never real**, proud of it, the dishonesty is a rule held for the session, the digits still stable and plausible |
| `apps/messages.md` | one line added: avatars are a `data-os-img="faces"` sheet |
| `data/dice.json` | new. 12 `era_decade`, 72 `setting`, 38 `temperament`, 44 `material_a`, 44 `material_b` — all short common nouns, no names. Keys are the singular roll keys `server/dice.ts` reads |
| `prompts/README.md` | rewritten: the identity-in-boot flow, the three new variables, the dice contract, the picture-slot table, the new budgets, and a "house rules learned the hard way" section |

## How it was measured

A scratchpad probe (not in the repo, and deliberately so: `scripts/desktop-sweep.mjs`
is the repo's tool and it goes through the server, which was being rewritten in
parallel). The probe reads `prompts/**` and renders them exactly as
`server/prompts.ts` does — voice + kind for the system turn, `user/<kind>.md` for
the user turn, the same `{{…}}` substitution — and calls the engine directly with
the I7 token caps. Hook checking mirrors the real validator: attribute **names**
inside opening tags, not CSS selectors.

Per boot it rolls the dice itself, feeds the growing name list back as
`never_names`, parses the identity comment with the server's own validity rules
(`server/identity.ts`: six required strings, two required arrays, archetype in the
allowed set), then generates the desktop from the identity it just read.

## Numbers

### `cerebras-oss120` (the default engine) — 8 boots after the fixes below

| | result |
|---|---|
| identity comment first, closes, parses, all fields, valid archetype | **8/8** |
| identity line length | 403–479 chars (budget is 1,600) |
| boot document closed inside 800 tokens | 6/8 (two hit `finish_reason: length`) |
| doctype → first visible body text | 352–448 chars ≈ 90–110 tokens |
| desktop passes all nine hooks + 16 launchers + 16 icon slots | **7/8** |
| the one miss | `<div data-os-clock">` — a dropped `=`, the SMOKE-1 §5 failure class. I5 patches a missing hook in place, so it costs a bare clock element, not a regeneration |
| desktop size | 1,092–1,441 tokens against a 3,500 budget |
| boot latency / desktop latency | 0.75–1.7 s / 0.9–3.1 s (single calls, no streaming) |

**Names, twelve boots, no repeats and every one dice-derived:** SporeLedger (mushroom
farm), TideSmith (reactor decommissioning + tides), DepotShell (bus depot),
VerdantVault (taxidermy), Mycelion (mushroom farm), VelvetCrack (hospice, plum
velvet + hairline cracks), Crestfield (dairy inspection), FerroLock (canal lock +
cast iron), Vinora (vineyard press house), NeptuneVault (deep sea cable ship),
TerraMoor (soil lab), GleamFurnace (glassblowing works).

BAKEOFF-1's finding was three *Granite Desks* in eleven boots and slate-blue
palettes three times out of three. The dice fix that: the name, the era, the job
and the colours all come off the roll now. **This was the "product problem, not a
cosmetic one" in BAKEOFF-1's verdict, and it is the biggest single win in this
pass.**

### `or-oss20-groq` — 3 boots

| | result |
|---|---|
| identity parses | **3/3** (BAKEOFF-1: 1 failure in 2, machine named `UNNAMED/VAUF`) |
| boot closed inside 800 tokens | 0/3 — it is verbose and runs to the cap every time |
| desktop passes | 2/3 |
| the failure | not a contract problem: the document degenerated into `[data-os-window] .content{background:white}` repeated to the 3,500-token cap. A 20b pathology, the same family as BAKEOFF-1's 180-second page |

### Apps and pages, `cerebras-oss120`, one generation each

| generation | tokens | picture slots emitted | other |
|---|---|---|---|
| `photos` | 2,216 | **4** `data-os-photo`, each a real camera caption | was emitting `href="#"` for album switching; fixed in the prompt |
| `maps` | 1,859 | **1** `data-os-img="map"` + SVG overlay | |
| `messages` | 1,682 | **4** `data-os-img="faces"` | |
| `calculator` | 1,068 | none | |
| `browser` | 973 | none | `data-os-page` + `data-os-url` both present |
| `reddit.com/r/…/comments/…` | 1,504 | **6** faces | |
| `amazon.com/dp/…` | 1,233 | **1** photo | |
| `pelicanfreight.com/depots/tilbury` | 1,537 | **1** photo | |
| `google.com/search?q=…` | 1,672 | none — correct, a results page needs no photograph | |

No `<img src="http…">` anywhere. Every document closed. The slot caps (≤ 4 app,
≤ 2 page) were respected without the server having to enforce them, which is what
the wording was for.

## The one thing that had to be found by measuring

The first probe returned **empty content on 2 of 3 boots**, `finish_reason: length`,
800 completion tokens, **797 of them reasoning tokens**. The reasoning trace showed
what it was doing:

> "Need 5-14 words. Count: 2040s language school teaching interface by Lexium
> Institute = 7 words? Actually words: 2040s(1) language(2) school(3)…"

The word-count constraints in the identity field list (`3-9 words`, `12-30 words`,
`under 12 words` — inherited from the pre-§12 identity prompt, where the identity
had its own 300-token call and could afford to deliberate) make a reasoning model
literally count words in its head, and at a 800-token boot budget **the counting
consumes the whole budget and the machine ships nothing**. Replacing every count
with a qualitative phrase ("one phrase", "one sentence", "a word or two") plus one
line of "write it straight through, there is nothing to count" took reasoning from
797 tokens to 242 and the boot from empty to complete.

Two smaller findings from the same loop:

- **`archetype` was `taskbar` 5 times out of 5** when the prompt said "pick the one
  that fits… both come up about equally often". A model asked to choose freely does
  not sample. The prompt now derives it from the die roll: last character in
  `a–m 0–4` → `dock`, else `taskbar`, which is exactly 50/50 over the kernel's
  `[a-z0-9]` seed alphabet, with "unless one plainly does not fit" left in. Eight
  boots since: 5 dock, 3 taskbar.
- **The photos slot description was copied from the prompt verbatim** ("a kitchen
  mid-renovation, cabinet doors stacked against the wall, afternoon light"), which
  is SPEC §12.4's attractor problem in a new place. The example is now a shape
  rather than a sentence.

## Open, and for other owners

1. **`boot` at `max_tokens: 800` (I7) is a budget shared with reasoning tokens.**
   Cerebras `gpt-oss-120b` spends 180–250 of it thinking even at
   `reasoning_effort: "low"`, and `gpt-oss-20b` spends more and never closes the
   document. The document itself fits in ~550 tokens. Either the engine cap for
   `kind=boot` wants ~1,100 (engines.json, per-kind override already exists), or
   the boot budget has to be read as "800 tokens of document". **Recommend raising
   the boot cap to 1,100 for the reasoning engines.** Prompt-side this is as small
   as it gets without cutting content people see.
2. **The boot prompt is 4,300 prompt tokens**, and most of it is `voice.md`
   sections the boot screen cannot use: the picture slots (§4), the interactivity
   contract and the `window.os` API (§9). `buildPrompt` prepends `voice.md` to
   every HTML kind. Skipping it for `kind=boot` (and making `system/boot.md`
   carry the four rules it needs) would cut the boot's prompt cost by roughly
   two thirds and reduce the reasoning pressure in (1). That is a one-line code
   change in `server/prompts.ts` and a prompt change to match; it is not done,
   because the prompts as they stand work on the current code path.
3. **`{{archetype}}` must be passed to `kind=desktop`** or the desktop has to
   re-read it out of `identity_json`. It is already in `PromptVars` and
   `server/index.ts` renders it, so this is just a note that the validator's
   archetype comparison depends on it.
4. **`data/dice.json`'s keys are the singular roll keys** (`era_decade`, `setting`,
   `temperament`, `material_a`, `material_b`) to match `server/dice.ts`'s
   `DICE_KEYS`. Anyone extending the lists keeps those names.
5. **Two picture-slot conventions are the prompt library's invention**, because
   SPEC §12.5 names the slots but not how the model says what the picture is:
   `data-os-photo`'s **attribute value is the image prompt**, and
   `data-os-img="faces"` goes on **every avatar element** (the kernel hands out
   cells of one sheet in document order, exactly as it does for the icon sheet)
   because CSS cannot share one element's background across its siblings. Both are
   in `prompts/README.md` and in the product README's Deviations list. The kernel
   must match them or the slots stay empty.
6. **The stray-quote failure class is not dead** (`<div data-os-clock">`, 1 in 8).
   Every hook in the prompt is written `name=""` and has been since SMOKE-1 §5;
   this is the residue. It now costs a patched-in bare element rather than a
   regeneration (I5), which is the right answer to a 12% attribute typo rate.
7. **Desktops come in at 1,100–1,450 tokens against a 3,500 budget** on
   `cerebras-oss120`, even after the prompt was told the budget is generous and
   that a desktop under 2,000 tokens is an empty desk. BAKEOFF-1 said the same
   thing from the screenshots ("the desktop is mostly empty space"). The wallpaper
   and icon-sheet images (§12.5) are the intended answer to this; if the next
   bake-off still reads as empty with images on, it is a model choice and the
   lever is the engine, not the wording.
8. **Not measured here:** `mercury-2.5` (the challenger), the reroute path, the
   `repair`/patch path, `update`→reboot lineage, and anything end-to-end. Those
   need the server, and the server was mid-rewrite. The first bake-off after the
   v0.1 build lands is where they get measured.
