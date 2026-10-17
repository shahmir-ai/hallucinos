# PROMPTS-3 — the boot screen inks first, windows get usable chrome, and the encyclopedia's numbers are rolled

2026-09-17, ~18:40–21:00 PKT. Prompt-author side of the v0.3 seams (H3 ink, H4
focus state, H5 reality offset) plus the two legibility items the architect
listed: window chrome and viewport fit. **Files touched: `prompts/**` and
`data/dice.json` only.** No code, nothing committed.

Live spend this pass: **$0.019** — three real boots, one desktop, three
reference pages built straight from the prompt, one page end-to-end through the
server after the code side landed H5.

Tree at the end of the pass: `npm test` **277 passed / 27 files** (the extra
tests are the code side's, run against this `data/dice.json`), `npm run build`
clean.

---

## 1. `prompts/system/boot.md` — ink inside the first 60 tokens (H3, item 4)

The old fixed order was doctype → `<head>` → `<style>` → body → first line. A
`<style>` block has no box, so on the bad hour the runtime's ink signal could not
fire until the whole stylesheet had been written: that is HANDOFF-4's four
seconds of black, and no kernel change removes it on its own.

The order is now **doctype, charset, `<body style="…">`, then one printed line
per POST step, each in its own plain element**; the `<style>` block lands after
four or five lines have printed and restyles what is already on screen. The
whole first look — margin, background, colour, type, padding — rides in the one
`style` attribute on `<body>`, which is what turns the screen from white to this
machine's. `<head>` and `<html>` are dropped (the doctype is what
`HtmlStreamFilter` looks for, so the stream still starts cleanly), and the
closing instruction is `</body>` rather than `</html>`.

**Measured, `cerebras-oss120`, 3 boots, ~18:50 PKT:**

| boot | ttfb | identity comment closed | **first inkable element** | chars after the comment | `<body style>` | `<style>` before first text |
|---|---|---|---|---|---|---|
| 1 | 1,415 ms | 1,415 ms | **1,416 ms** | 137 | yes | no |
| 2 | 1,129 ms | 1,129 ms | **1,130 ms** | 160 | yes | no |
| 3 | 991 ms | 991 ms | **995 ms** | 165 | yes | no |

Ink now arrives 1–4 ms after the identity comment, 137–165 characters into the
document — inside the 60-token budget with room to spare (60 tokens ≈ 240
chars). Whatever the provider's TTFB is on the hour, the boot frame paints as
soon as the first chunk exists, which is the most the prompt side can buy.

Two things the probe also showed, neither of them mine to fix:

- **Reasoning still eats the boot budget.** All three boots spent 708–800
  output tokens for 1.0–1.8 KB of HTML, and 2 of 3 hit the 800 cap mid-document
  (`truncated: true`). A truncated boot screen now *inks* — that was the point —
  but it ends without `</body>`. HANDOFF-4's ranked #2 stands.
- The identity comment is still the whole of TTFB, so H2's hedge is what moves
  the number the visitor feels.

## 2. `prompts/system/desktop.md` — window chrome and viewport fit (H4, items 1–2)

A new section, **"The window chrome — the requirements of a usable window"**,
stated as requirements rather than as a look, since one template dresses every
window this machine will ever open:

- title bar **≥ 28 px** (`min-height`), contrasting with the window body **and**
  with the wallpaper (two different jobs, both named);
- the title one readable line with `overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap`, because `[data-os-title]` is filled by the kernel and can
  be longer than the model expects, and a wrapping title pushes the controls off
  the bar;
- **three controls, each with a visible mark, each ≥ 20×20 of hit area**, visible
  without hovering, with a gap between them;
- a border, outline, shadow or plate so the window has an edge over any
  wallpaper and over the next window;
- **H4:** `[data-os-focused="true"]` and `[data-os-focused="false"]` are both
  always present on the window root, so the prompt asks for a rule for each and
  says they must be obviously different; `[data-os-active]` on the task entry
  gets the treatment the era gives a pressed key or a current tab. The attributes
  are also written into the template-structure block as comments, and into the
  two `## The parts` bullets, so a model that skims finds them three ways.

**Viewport fit** (item 2), in `## Also`: `html,body{margin:0;padding:0;width:100%;
height:100%;overflow:hidden}`, everything inside that rectangle, bars and docks
wholly inside it (the `100%`-plus-padding trap and the straddling dock are named
explicitly), and no part of the shell — launcher area, bar, menu — with a
scrollbar of its own. Eight new lines in the closing checklist cover all of it.

**Measured, one desktop, `cerebras-oss120`, dock archetype, 1,762 ms / 5.4 KB:**
`min-height:28px` on the title bar ✓, `min-height:20px` on the controls ✓,
`[data-os-focused="true"]` and `="false"` rules both present ✓,
`[data-os-active]` rule present ✓, `text-overflow:ellipsis` ✓,
`overflow:hidden` + `html,body{height:100%}` ✓, both templates ✓, six
control hooks ✓. First try, no retry.

## 3. `data/dice.json` — `reality_offset` (H5, item 3)

Five new lists under `reality_offset`, well over the minimums:

| list | count | min | shape |
|---|---|---|---|
| `calendar_quirk` | 46 | 40 | one short invented string |
| `unit_system` | 44 | 40 | `{name, units:[3]}` — the three read as distance, mass, duration, in that order |
| `place_pair` | 64 | 60 | `[name, name]`, used together so a session's two places belong to one world |
| `historical_event` | 64 | 60 | one short invented event name |
| `scale_factor` | — | — | `{min:0.37, max:2.9, decimals:2}`; the server rolls the number |

128 distinct place names, 132 distinct unit names, no duplicates in any list,
nothing over the 80-char clamp, nothing naming a real place, person, product or
event. Unit names are authored as **trade families** (a system name and three
units that sound like one measure), which is why `unit_system` is objects rather
than two flat lists. `_shape` in the file documents the rendered object and the
minimums for whoever adds entries next.

One coordination note for the record: the code side briefly read this as flat
`unit_system` / `unit_name` / `place_name` lists, I flattened to match, and it
then landed on the structured shape the architect's seam describes — so the file
is structured, `test/dice.test.ts` is green against it, and nothing about it is
in flight any more.

### Where the offset is stated

- **`prompts/user/reality.md`** (new) — the block the code side's optional
  fragment renders into the page and app **user** turns. This is the position
  HANDOFF-4 issue 6 proved: the same rule in the system prompt lost to the
  model's prior for three bake-offs running.
- **`prompts/system/page.md`** — a new section, "Every quantity, date and place
  on this page comes from this reality's own measure": the calendar for every
  date, the three unit names for everything measured, the scale factor applied
  to every real-world figure *before* it is written, the two places, the one
  event; and figures must agree across infobox, prose and tables.
- **`prompts/notes/reference.md`** — the same rule as a four-step procedure
  (recall → multiply → round → state in this world's unit), plus a **last pass**:
  read back every figure and ask *is this the number the other world uses?*, and
  recompute derived figures from the ones on the page rather than recalling them.
- **`prompts/system/app.md`** — the app-side version: dates in file lists, log
  lines and headers; sizes, weights, durations and capacities in this world's
  units; the same multiply-before-you-write rule.

Every one of those refers to the block by its heading rather than by position,
and each says what to do when the block is empty, because `render()` turns an
unsupplied `{{reality_json}}` into nothing at all.

**Measured — three reference pages (`en.wikipedia.org/wiki/Moon`), built
straight from the prompt at scale 1.63:**

| probe | units used | places | event | real Moon figures left |
|---|---|---|---|---|
| A (before the last-pass rule) | all 3 | both | yes | mean distance unscaled (384 000) |
| B (last-pass rule added) | all 3 | both | yes | none in the infobox; eccentricity, density, speed still real |
| C (derived-figure rule added) | all 3 | both | yes | eccentricity only |

Probe C's infobox: mean radius 2,831 (1,737 × 1.63), semimajor axis 627,000
(384,400 × 1.63), orbital period 44.5 (27.3 × 1.63), mass 1.20×10²³
(7.34×10²² × 1.63) — the factor is genuinely being applied, in the session's
unit names, and the parent body is one of the rolled place names. The two prompt
lines added between A and C are what closed the misses, so they are worth their
tokens.

**End-to-end through the server**, after the code side landed H5
(`POST /api/gen`, `kind=page`, `en.wikipedia.org/wiki/Lighthouse`, session-rolled
offset, 1,654 tokens out, $0.0029): location "Braxby Reach, Ilm" (a rolled
pair), height "62 verge", lantern power "12 moll" (the rolled system's units),
built "Year 12, Month 3" (the rolled calendar). The seam clicks.

## 4. Prompt size, for the record

System + user, rendered, at ~4 chars/token: boot ~5.4k, desktop ~9.3k, page
~7.1k (reference shapes; ~6.4k otherwise), app ~5.0k. The reality block costs
~50 tokens and is rendered **once** per request; the rules that refer to it are
prose. Desktop grew ~700 tokens this pass, page ~700, app ~370 — all input
tokens, ~$0.0002 a generation on `cerebras-oss120`.

## 5. Residuals

1. **A truncated boot screen ends unclosed.** Harmless in an iframe, and it now
   inks first, but the 800-token boot budget is mostly reasoning on this engine.
   Prompt levers are exhausted; this is engine choice or budget (HANDOFF-4 #2).
2. **Dimensionless figures still recite** — an eccentricity, a ratio with no
   unit. Two prompt lines already recovered the derived ones; a third line for
   pure ratios would probably work, and is not obviously worth the tokens, since
   nothing about a bare `0.0549` reads as the real world to a visitor.
3. **The chrome and viewport requirements are n=1 on a real engine.** They want
   the bake-off's nine desktops, and the harness should measure title-bar height,
   control hit area and a focused/unfocused difference the way it already
   measures launcher overlap — otherwise none of it stays fixed.
4. **The reality offset is never stated on a desktop or a boot screen**, by
   design (no measurements there) — but the clock and the date on the desktop are
   the one place a session's calendar is visible and currently ignores it. Worth
   a ruling, not a guess: a taskbar clock in a nine-day week is either the best
   detail in the product or the thing that makes the shell unreadable.
5. **`scale_factor` rolled 2.88, 2.85 and 2.38 on the first three session seeds
   I sampled.** Small sample, code side's rng, but worth one look — a factor
   that is always large is a factor that reads as a theme rather than as a world.
