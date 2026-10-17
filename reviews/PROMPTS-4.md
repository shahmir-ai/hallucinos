# PROMPTS-4 — the prompt half of v0.5: a window you can close, a label that stays, and the tile sheet

2026-09-17, ~23:15–02:xx PKT. Scope: `prompts/**` only (plus `data/dice.json`, which
needed nothing). **No code was touched in this pass** — every file below is prompt
text. The five items are the prompt halves of the architect's live test (D2, D3, D4)
and of seam T2; the kernel halves (T1, T3, T4 and the runtime's tile slicing) belong
to the session writing `server/**` and `kernel/**` in this same tree.

**Tree at the end of this pass:** `npm test` **340/340** and
`npm run test:e2e` **102/102 green on mock**. (Mid-pass the unit run was 302/305, the
three failures all in `test/img.test.ts` and all from the concurrent session's T3 size
change landing ahead of its tests; that session closed them and added its own, which is
where 305 → 340 comes from. No prompt test failed at any point, and the e2e run was
taken before the last of those code changes.)
**Spend: $0** — nothing was bought and no provider key was used.

---

## 1. D2 — the window with no title bar and no visible close control

The defect: the opened window's top was the app's own header; `[data-os-close]` was
found by the validator and was invisible or zero-sized. A visitor could not move that
window and could not put it away.

Three changes, all in `prompts/system/desktop.md` and `prompts/user/desktop.md`:

1. **A new last section, `## Last of all: the window template, because every window on
   this machine wears it`.** It is now the final thing in the system file, after the
   pre-answer checklist, and it restates five requirements as numbered lines: a visible
   title bar ≥ 28 px above `[data-os-content]`; its background *clearly a different
   colour from the window body*; a readable one-line `[data-os-title]`; three controls
   ≥ 20×20 each carrying its own visible mark and each with a real box "so a control
   whose mark is missing still has a size"; and the focused/unfocused bar difference
   (§5 below). It names the failure in the model's own terms — *not a job left to the
   app's own heading inside the content area, which is a different document and cannot
   move or close anything* — because the app document is exactly what stood in for the
   chrome on the live boot. The closing "answer with the document alone" line moved
   into this section so the last words of the prompt are still the output rule.
2. **The same five, restated as a block at the end of `prompts/user/desktop.md`.**
   Small models obey the end of the prompt, and the user turn is the end of the
   request. It is 218 tokens and it is the cheapest lever in the library.
3. **The structure example no longer shows empty controls.** It read
   `<button data-os-close=""></button>` — an empty element, which is precisely the
   zero-sized control the live test found, sitting in the one block of this file that
   models copy verbatim. All three now read `…its mark…`, the library's placeholder
   convention, and the block's intro says every `…` is a placeholder for a word or a
   glyph of yours.

## 2. D4 — "sky23:12:50"

`prompts/system/desktop.md`, "Both archetypes", two new rules:

- **The bar is laid out with space between its parts** — a flex row with its ends
  pushed apart (`justify-content:space-between`, or `margin-left:auto` on the far-end
  part), name or start control at one end, clock and date at the other, and the open
  middle is where the machine appends window entries.
- **Nothing in a bar touches its neighbour** — a `gap` on the bar and padding on every
  child, "a name and a time that meet with nothing between them are read as one word",
  and inside `[data-os-clock]` the time and the date are separate elements with a gap
  or a separator between them. The second half matters: the live defect was the name
  against the clock, and the clock's own internals are the next place it happens.

## 3. D3 — labels visible before the sheet, gone after it

`prompts/system/desktop.md`, a new section after the label-plate rules: **"Every
launcher keeps its label, from the first paint onward"**. Four rules:

- the icon box is a **fixed 48×48** and the label is a **sibling outside that box**,
  under or beside the icon, inside the launcher;
- the launcher's own box is *icon + gap + one line of label* — size it to its contents,
  leave its overflow visible, "a launcher fixed to the icon's 48 px cuts its own label
  off";
- the label reads off the screen **at all times**, with nothing hovered, focused or
  clicked; a `title` attribute is not a label;
- **no rule keyed to the icon touches the label.** This is the one aimed straight at
  the defect: the prompt now tells the model exactly what the machine does a second
  after the document lands (sets a background on `[data-os-icon]`, marks that one
  element, changes nothing else) and forbids any rule *or script line* that hides,
  empties, fades or moves a label when the icon gains a background, an attribute or a
  class.

Three checklist lines were added for the same three items, and one existing line was
sharpened.

## 4. T2 — the tile sheet

One mechanism for every grid of small pictures, replacing the `faces`-only spelling.
The attribute shape, as the prompts now teach it:

```html
<div data-os-img="tiles" data-os-theme="posters" data-os-tile="0" data-os-prompt="…the set, under 25 words…"></div>
<div data-os-img="tiles" data-os-theme="posters" data-os-tile="1"></div>
```

- Five theme words, a closed list: `posters` (a catalogue), `thumbnails` (a feed),
  `products` (a shop or listing), `faces` (people), `covers` (music or books).
- `data-os-tile` counts up from `0` in document order, sixteen at the most.
- **`data-os-prompt` is on the group's first element and on no other.** This is the
  money rule and it is stated in every file that offers the slot, in the model's own
  economics: *a prompt repeated onto a second tile buys a second sheet and spends the
  page's whole picture budget on one grid*. It is not a theoretical risk — the runtime
  collects `[data-os-img][data-os-prompt]` and charges per collected slot, so the old
  `faces` wording, which put the description on the example element and never said
  "first only", could buy four sheets of the same sixteen people in one app document.
- One sheet counts as **one** picture against the app's four and the page's two.

Files: `prompts/system/page.md` (the slot list rewritten, a new "The tile sheet" section,
the shape table's catalogue/feed/product/thread rows now name their theme),
`prompts/system/app.md` (the `faces` bullet became the `tiles` bullet),
`prompts/system/voice.md` §4 (the shared slot vocabulary and "a tile sheet is one
picture"), `prompts/apps/mail.md` and `prompts/apps/messages.md` (`faces` theme),
`prompts/apps/store.md` (**new** slot: the six listing icons on one sheet, `products`
or `covers`), and `prompts/apps/photos.md` unchanged, as the brief asked — it wants
four real photographs, not sixteen small ones.

**`prompts/images/tiles.md` is new** and is the server-owned half of the prompt. It was
written twice: the first version invented its own variables, and the concurrent session
had meanwhile fixed the contract in `server/imgprompt.ts` `buildTilesPrompt` —
`{{theme}}`, `{{theme_subject}}`, `{{set}}` plus the usual image variables, with
`prompts/images/tiles-<theme>.md` as a per-theme override read first. The shipped file
uses *their* names, so what it renders is the builtin composition plus two clauses
(`each cell a complete picture in itself`, `no captions`). A file that exists wins over
the builtin, so this mattered: the first version would have rendered
`{{theme_noun}}` as the empty string and shipped a sheet prompt with no subject in it.

The file also records why this sheet is the icon sheet's opposite: the icon sheet must
carry **sixteen identical** plates because FLUX schnell will not place named subjects in
a requested order, and a tile sheet wants **sixteen different** pictures because no tile
is promised to any particular row. The geometry clauses (edge to edge, no gutters, no
frames) are the same in both and are mechanical — `kernel/sheet.ts` cuts at exact
quarters.

## 5. Focus state (HANDOFF-5 #4)

`prompts/system/desktop.md`, "Focused and unfocused": the difference is no longer left
as "make them obviously different". **The required difference is the title bar's own
`background` colour** — one colour focused, a different colour unfocused, "far enough
apart to name from across the room" — with everything the era wants on top of it. The
CSS skeleton now shows `background:…` in both rules with the comments `/* one colour */`
and `/* a different colour */`, the checklist line says the two bars differ in
background colour, and the new last section repeats it as item 5.

---

## What this costs, measured

Input tokens per request, from the e2e telemetry and the file sizes:

| request | `tokens_in` now | prompt delta this pass |
|---|---|---|
| `desktop` | **12,070** (mock e2e) | **+1,570** — system/desktop.md +1,352, user/desktop.md +218 |
| `page` | ~7,000 | +475 |
| `app` | ~6,000 | +76 shared, +87 mail, +83 messages, +318 store |

+13% on the desktop request's input. Input is the cheap half (a fraction of a cent per
thousand boots) and prefill on the fast engines is tens of milliseconds, but it is not
free, and **if TTFT regresses the trim target is named**: the mid-file section "The
window chrome — the requirements of a usable window" and the new last section now
overlap by roughly 60%. The overlap is deliberate for this pass — the defect was a
model ignoring a rule that sat three thousand tokens up — and the right time to collapse
it is after a live boot shows which position the rule is obeyed from.

## Verification actually done

- **Render check.** Every file rendered with a realistic variable set: no leftover
  `{{placeholder}}` in any of `desktop`, `page` or `app` (a placeholder that renders
  blank is a silent prompt weakening — `test/launchers.test.ts` exists because of one).
- **`npm test`** — **340/340** at the end of the pass, `test/prompts.test.ts`,
  `test/imgprompt.test.ts`, `test/contract.test.ts` and `test/launchers.test.ts`
  included (those four are the ones that read this library).
- **`npm run test:e2e`** — **102/102** on the mock engine, ports 8770–8780, 5.8 min.
  Port 8799 and `dist/play.js` untouched.
- **`prompts/images/tiles.md` extraction** — the first fenced block is what the server
  sends; checked at 354 characters, well inside `IMG_PROMPT_MAX` (1,400) with the
  theme clause, the 320-character set clamp and the palette added.

**Not verified: any of it on a real engine.** No boot was bought in this pass. Every
claim above is about what the prompt now says, not about what a model does with it, and
the three live defects can only be closed by a boot of `/` on a `dock` archetype with a
window opened and looked at. That is the next pass's first ten minutes.

## What remains

1. **The tile sheet's two halves agree — checked against the code, not assumed.**
   The kernel half landed while this pass was running, and it wants exactly what the
   prompts now teach: `collectImgSlots` selects `[data-os-img]` (the prompt is no longer
   in the selector), takes **the group's first member as the asker**, marks every later
   member of the same theme with that one slot, and charges the document once;
   `fillTiles` slices by `data-os-tile`, keeps `data-os-face` alive for the `faces`
   theme, and finds members by slot so two sheets cannot slice into each other.
   **One asymmetry worth knowing:** a group whose prompt is on the *second or third*
   tile rather than the first leaves the earlier tiles unmarked and unfilled — they are
   skipped before the asker exists. "First element and no other" is therefore
   load-bearing in both directions, which is why every file that offers the slot says
   it in those words. A test that writes the prompt on tile 2 and asserts tiles 0–1
   stay unfilled would pin it.
2. **The five theme subject clauses live in `server/imgprompt.ts`** (`BUILTIN_TILES`),
   against this library's rule that no prompt text belongs in the server. They are
   mirrored in `prompts/images/tiles.md`'s theme table, which is what actually ships
   (a file wins over the builtin), and the file says so. If the architect wants the rule
   held strictly, the move is five `tiles-<theme>.md` files — and the cost is five copies
   of the geometry clauses, which is five places to forget the one clause the slicing
   depends on. Recommend leaving it as one file.
3. **`voice.md` §12's budget table is stale.** It tells the model app 2,500 and page
   2,500; `engines.json` now allows 4,000 and 3,200 (BUDGET-2, integrated in HANDOFF-6
   §5). Deliberately left alone: the numbers in the prompt are what make a model finish
   and close its document, speed is the product, and raising them is a behaviour change
   nobody asked for in this pass. It should be an explicit decision, not a drift.
4. **The launcher-off-screen ruling is still open** (HANDOFF-6 remaining issue 1: 2 of 9
   `dock` boots put every launcher off screen). `prompts/system/desktop.md` forbids it
   in three places now and a fourth sentence will not fix it. That is the kernel-clamp
   vs accept-it decision the architect still owes, and no prompt edit in this pass
   touched it.
5. **A page's tile prompt renders an empty comma-separated slot.** Simulated against
   the shipped template: an app's sheet renders 497 characters and reads cleanly; a
   page's, with every identity variable blanked by `buildTilesPrompt` (SPEC §3.1),
   renders `…printed ink, the genre mix of this catalogue, , sixteen cells in a 4x4
   grid…`. Harmless — this is a comma-separated prompt vocabulary and an empty slot is
   nothing to the image model — and unavoidable in a renderer with no logic, which is
   the library's own rule. The one-line fix belongs in code beside the existing
   whitespace collapse in `buildTilesPrompt`: collapse `, ,` the same way. Worth doing
   because a page's sheet is the common case, not an edge case.
6. **`prompts/apps/maps.md`'s `data-os-prompt="map"` marker** is still only a collection
   marker whose text the server discards (`prompts/images/map.md` explains it). One
   kernel line would let a `map` slot be collected without the attribute; until then the
   wording stays.
