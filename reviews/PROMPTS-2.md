# PROMPTS-2 — the v0.2 prompt pass (2026-09-17)

Scope: `prompts/**` and `data/dice.json` only. No code touched, nothing committed.
Punch list: `reviews/HANDOFF-3.md` §6 items 1, 3, 4, 6 (and the prompt half of 2 and 5),
`reviews/BAKEOFF-2.md` "Funniness and variety" + "Findings and fixes, ranked" 3–5,
and my side of seams **S1** (model-described picture slots), **S2** (three new dice),
**S3** (server-owned image prompts).

Unit tests after the pass: `test/prompts.test.ts` 18/18, `test/launchers.test.ts` 3/3,
`test/dice.test.ts` 9/9, `test/contract.test.ts` 19/19 — green. The 7 failures in
`identity`, `img`, `lanes`, `routes` are in `kernel/**` / `server/**` mid-flight from the
other two builders; no prompt or dice file is involved in any of them.

---

## 1. Every concrete content example is gone

BAKEOFF-2 proved the attractor effect twice: `voice.md`'s three worked oddities came back
almost verbatim across engines and boots (`0.4 units` in seven different disguises, a
literal `low ceiling in stairwell` in a browser status bar), and the one app name inside
`store.md`'s `os.install` snippet was sold in 10 of 10 stores that rendered a listing.
So the library now holds **no concrete content example anywhere**. Format examples stay
(the identity line, a hook's spelling, a CSS declaration, a call signature with
`<placeholders>`); content examples do not. The new house rule is written into
`prompts/README.md`.

| file | what came out | what replaced it |
|---|---|---|
| `system/voice.md` §5 | the folder dated next year / 0.4 units of an unnamed resource / low ceiling in the stairwell | the rule alone, plus "the oddity belongs to *this* machine" pointing at the identity's `personality` sentence, which now carries the rolled `strange_detail` |
| `system/voice.md` §5, §12 | the crate-of-plate-glass row, twice | the same rule stated as a shape ("names the thing, weighs it, says where it is in a sequence") |
| `apps/store.md` | the named kit inside the `os.install` example, and its whole invented shape string | `<name>` / `<slug>` / `<what this app is…>` placeholders, and an explicit "that listing's own name, never another card's" |
| `apps/photos.md` | the camera-caption example and the list of drawn thumbnails and album names | the briefing recipe (subject, where, light) and a rule that the four differ in subject *and* light |
| `apps/about.md` | the four credit lines | the shape of the credit list (ordinary → narrower → a single word → a span of years → not a job) |
| `apps/trash.md` | the named spreadsheet, the numbered drafts, 03:12 | the same story told as classes of file |
| `apps/weather.md` | the low-ceiling warning again, in the warnings bullet | one hazard "only this world has, in the vocabulary of the place this machine was built for" |
| `apps/calculator.md` | three invented units | "units this machine's trade would use, two of them invented" |
| `apps/taskmgr.md`, `apps/browser.md` | "a charge in an unnamed unit", "a figure in an unnamed unit" | wear / heat / who is attending it; "one number this machine thinks a person should be watching". These two were feeding the same 0.4-units cliché from the other end |
| `apps/maps.md` | the two quoted leg warnings, the quoted layer name | the warning's *subject* (how a stretch is crossed, when it is passable) |
| `system/page.md` | three invented domains, three example hrefs, the four reroute subjects, the tide-mill continuity line, the 47-partners notice | rules for reading a business out of a domain, an href *shape* per site kind, mild-and-specific reroute classes |
| `system/boot.md`, `system/identity.md` | the version codename, the worked era phrase, the worked five-dice roll, the two boot-log lines | field rules only; the dice supply the content |
| `system/desktop.md` | the stapler / pressure gauge / shift supervisor / 9px notice, twice; the window-chrome inventions; the four clock formats | the same invitations stated as classes ("whatever this machine's job would have put on its own screen") |
| `system/app.md` | the `os.setTitle` example | the rule |
| `prompts/images/*.md` | — | the commentary in these two files deliberately describes what came back in BAKEOFF-2 **without naming any picture**: the files sit next to a model |

## 2. S2 — three new dice in `data/dice.json`

| key | entries | minimum | what it decides |
|---|---|---|---|
| `naming_register` | 22 | 12 | the **shape** of the name: a single common word, a first name, a surname, a model number, an acronym, a capitalised codename, two words with a space, two nouns run together, a hyphenated pair, a word plus a number, all-lower-case, all-caps, a nonsense disyllable, a mineral, a tool, an adjective, a three-letter code plus a number, a place-shaped word, an ordinal plus a noun, a plant, an older-language word, a department name |
| `strange_detail` | 74 | 60 | the session's one quietly-wrong idea. No numeric-unit clichés at all — they are situations (a corridor counted as a room, a visitor signed in and never out, a certificate that expired in the past, a bell that rings for a shift that ended years ago) |
| `wallpaper_motif` | 52 | 40 | the wallpaper's subject, for the **server's** image prompt. All abstract, landscape or pattern; no animals and no single hero objects, which is what BAKEOFF-2's wallpapers were made of |

Every entry is short (longest 53 chars, well inside `server/dice.ts`'s 80-char clamp), no
duplicates, no names of people, places or brands. `_notes` in the file states the whole
contract including the new keys and the S3 relationship.

**Server side of S2:** `DICE_KEYS` in `server/dice.ts` needs the three new keys added, or
they are dropped on load and never reach `{{dice_json}}`. Nothing else changes: the roll
is already `one value per key`.

The prompts that consume them:

- `system/boot.md` + `user/boot.md`: the die roll is now "a decade, a setting, a
  temperament, two materials, a naming register and one strange detail", **all** of which
  must land in the identity. The register is stated as non-negotiable and names the habit
  it is there to break ("do not weld two nouns together unless that is the register you
  were given"). The strange detail is required to go **in the `personality` sentence**,
  which is how it reaches the desktop and every app afterwards — pages never see the
  identity and are strange on their own account.
- `system/identity.md` + `user/identity.md` got the same two paragraphs, because the
  fallback and reboot paths still use them and the two files must agree field for field.

## 3. Boot: the identity comment is the first thing on the wire

`system/boot.md` opens with it before anything else ("**the very first characters you emit
are `<!--os-identity:`** … the machine is waiting on it"), and `user/boot.md` now says it
**twice**: as its second line and as its last line, which is the position a streaming model
weights most. This is the prompt-side lever on HANDOFF-3 §6.2 (25% identity-parse failure on
`cerebras-oss120`); the parse itself is I1's problem. Budget unchanged at 800 tokens
including the identity line, and the boot-log bullets got shorter rather than longer.

## 4. Desktop: the launcher grid, label plates, glyphs, window controls

All in `system/desktop.md`, with a new section "The launcher grid — the rule that is broken
most often" and four new lines on the final checklist:

- **A grid, never a single line. At most 8 in a row, at most 5 in a column.** All
  `{{app_count}}` on screen at `{{viewport}}` with no page scrolling *and no scrolling
  inside the launcher area* — the old wording offered "or the launcher area scrolling
  inside itself" as an out, and that out is now closed. It also says to do the arithmetic
  once (icon + gap × columns fits, last row ends above the bar) and names the measurement.
- **The dock holds at most 8 launchers**, and the rest sit on the wallpaper as desktop
  icons in a grid, top-right. A dock of sixteen is what put Honeyhive's entire dock off
  screen.
- **A one-character glyph inside every `data-os-icon`** — the one picture slot that is not
  empty, because the first seconds of every boot and every keyless deploy show a grid of
  blank plates. Both skeletons and `voice.md` §4 carry the exception.
- **One `data-os-icon="<id>"` per app, only inside its launcher** — the fix for BAKEOFF-2's
  `16/20 icons filled`: the sheet has 16 cells, and a menu that repeats an app was
  declaring extra slots that can never fill.
- **Label plates.** Every launcher label gets a background plate from the model's own
  palette, stated with the one CSS rule that does all of them, because the wallpaper behind
  it is a photograph the model has never seen (FURNACE's dark-on-dark labels).
- **Window chrome: a readable title and three clearly visible controls**, at the end the
  archetype puts them; the template skeleton now shows `data-os-minimize` /
  `data-os-maximize` / `data-os-close` and says "visible without hovering".

## 5. Pages: search results, this reality's encyclopedia, fewer pictures

`system/page.md` gained two sections and `user/page.md` one closing line:

- **"A search URL is always a results page."** Any address containing `/search?q=` on any
  domain is 8–10 results; **the first link in the document is a result**, so no chrome above
  it may carry a link; the words in `q` decide what the results are about; the extras come
  after. Ends with the one failure this shape has, named. (HANDOFF-3 §6.4 — 2 of 8 boots
  answered with the home page and a pre-filled box.)
- **"A wikipedia-shaped page is about this reality's version of the subject."** Invented
  dates, people, places, measurements, disputes, and a references list of works, authors and
  journals that do not exist. "Take the subject's name and the article shape from the URL,
  and take nothing else from what you know about it." (HANDOFF-3 §6.6 — every engine recited
  the real Moon.)
- **Slots used sparingly, two at most**, with the explicit note that a page with no
  photograph is a normal page and that furniture-led shapes (a catalogue wall, a video grid,
  a forum list) need none.

## 6. S1 — the model-described picture slots have one spelling

`data-os-photo="<description>"` is gone. Every slot the model describes is now
`data-os-img="photo|faces|map"` **plus** `data-os-prompt="<one line>"`, stated in
`system/voice.md` §4 (the shared rules), `system/app.md` and `system/page.md` (the ceilings),
and in the four app shapes that use one:

- `apps/photos.md` — four `photo` slots, each briefed subject → place → light, the four
  required to differ in subject *and* light, slot reuse for the large view, everything else
  still drawn.
- `apps/maps.md` — one `map` slot whose prompt names **the terrain, not the town**, and an
  explicit "no text or labels in the picture — the labels are yours, in the overlay".
- `apps/messages.md`, `apps/mail.md` — the faces sheet, now with `data-os-face="0"…"15"`
  written by the model counting up in document order, one prompt describing who the people
  are, sixteen elements at the most, and a note that company and machine senders keep a
  drawn mark instead. `mail.md` had no picture slot at all before this.

The ceilings are stated where the model can act on them: **4 per app document, 2 per page
document, first in document order**, a `faces` sheet counting as one picture, and anything
past the limit keeping the background the model gave it. The prompts also ask for one line
well under twenty words (the server clamps at 700 chars) and never for text inside a picture.

**Kernel side of S1 to be aware of:** the launcher glyph only works if the kernel hides or
covers it when it fills `[data-os-icon]` — a `background-image` alone leaves the character
sitting on top of the picture.

## 7. S3 — `prompts/images/wallpaper.md` and `icons.md`

New folder, two files, both in the same shape: **one fenced block is the template, and it is
the only thing sent to the image model**; everything after it is commentary. `{{variable}}`
substitution only, no logic, same convention as the rest of the library.

```
wallpaper: desktop wallpaper, {{era_decade}} computer operating system default background,
           {{wallpaper_motif}}, {{palette_words}}, no text, no people, no animals,
           no objects in focus, soft, low contrast

icons:     4x4 grid of sixteen flat application icons, consistent style, {{era_decade}},
           {{palette_words}}, plain background, evenly spaced, cells touching edge to edge,
           no gutters, no grid lines, no frames, no shadows between cells, no text,
           no letters, no numbers. Sixteen cells in reading order: {{icon_cells}}
```

- `{{icon_cells}}` is the sixteen app shapes **in `manifest.json` order**, numbered, trimmed
  to about six words each; the order is load-bearing because the kernel slices by position.
- The no-gutter clause is kept from `kernel/img.ts`'s v0.1 prompt — it is a real lesson about
  slicing at exact quarters, not decoration.
- The wallpaper prompt drops the machine's **name**, its **mood** and its **mascot**: the
  model cannot know the name, and the mascot is what produced the animals. The palette words
  are the only identity input left, and in BAKEOFF-2 the two wallpapers that worked were both
  palette-led and flat.
- Rendered lengths: wallpaper under ~300 chars, icons under ~1,200.

## 8. Not done, and what it would cost

1. **Nothing here has been run against a real engine.** This pass is text; the numbers in
   BAKEOFF-2 stand until `npm run bakeoff -- --engines=cerebras-oss120 --boots=4` (~$0.13) or
   the cheaper `npm run sweep` for the desktop-grid numbers alone.
2. **`voice.md` is still prepended to `kind=boot`**, and its picture-slot section and whole
   interactivity contract are dead weight on a screen with no hooks — about two thirds of the
   boot prompt. Still a code change (PROMPTS-1 said the same).
3. **`store.md`'s cap.** The shape is now six one-line listings, which should fit 2,500
   tokens with room to spare; if it still truncates, the lever is `store`'s `max_tokens`.
4. **The reroute rule and the `rerouted` page are untested since the rewrite** — the reroute
   e2e covers the mechanism, not the new wording.
5. **`apps/games.md`'s mechanic list and `apps/terminal.md`'s command list survive** as
   deliberate exceptions: they are genre shapes and real shell verbs, not invented content,
   and the games app needs a mechanic small enough to be correct in 2,500 tokens.
