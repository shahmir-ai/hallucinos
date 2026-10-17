**An app store of applications that do not exist.** Browsing it is fun; installing from it actually installs.

**Six listings. Exactly six**, and each one gets **one line** of pitch — no paragraph, no second sentence. Alongside the name: a developer (a company or a single person), a version, a size, a price or the word for free, a rating with a review count, and an icon — one picture slot each, from the sheet below, with your own drawn art underneath it. Six listings that finish beat sixteen cut off mid-card, and the pitch line is where the whole app is won: it is the funniest line on the screen and a person reads all six.

One of the six is featured at the top of the page, and one of the six looks abandoned — years since its last update, and one furious review.

**Write the listings as markup.** Six blocks in the document, one shared class, one CSS rule that dresses all of them. **Never** a JavaScript array of objects that a script turns into cards: this window paints while it streams, so a catalogue built by a script shows nothing until the last byte and shows nothing at all if one bracket is wrong.

**Install is real.** Each listing's install button calls `os.install` with **that listing's own name and its own shape** — the values on that card, never the values from another one:

```html
<button type="button" onclick="os.install({id:'custom:<slug>',name:'<name>',shape:'<what this app is, in one or two sentences>'})">…your word for install…</button>
```

- `<name>` is that listing's name exactly as printed on its card. `<slug>` is the same name in lowercase letters, digits and hyphens only. The `id` must start with `custom:`.
- `shape` is the important field: one or two sentences of plain English saying what the app *is* and what a person can do in it. It is the entire brief for that app when it opens, so be concrete and interesting. Never write a design there, never mention this store.
- Keep each call on one line, single quotes inside the attribute, no line breaks and no apostrophes inside the strings.
- After a successful install, change that button to an installed state and say, in character, that the app is now on the desktop — because it is: the machine adds a launcher for it, and it opens from there or with `os.open('custom:<slug>')`.

Picture slot — the listing icons, one sheet for all six:

```html
<span data-os-img="tiles" data-os-theme="products" data-os-tile="0" data-os-prompt="…what these six things are, under 25 words…"></span>
<span data-os-img="tiles" data-os-theme="products" data-os-tile="1"></span>
```

- One element per listing, in listing order, each with the **next tile**: `data-os-tile="0"` through `"5"`. Every one carries `data-os-img="tiles"` and the same `data-os-theme` — `products` for a catalogue of tools and machines, `covers` for a catalogue of things to read or listen to. Pick the one that suits the six you wrote.
- **`data-os-prompt` sits on the first of them and on no other**, and describes the set in one line: what kind of things these are, and the light. All six together count as **one** picture; a second prompt in the group buys a second sheet of the same six.
- Each one stays empty of text and children, **square and bounded** — one class with an `aspect-ratio:1` and a `max-width` of 220px or less, `background-size:400% 400%`, and a background of your own underneath so the catalogue is finished before the sheet lands. An icon that grows with its card stops being an icon. The name, the developer, the version and the price go in sibling elements. Your drawn SVG mark can sit beside the slot or stay as the slot's own background.
- **The featured listing and the first of the six are on the first screen**, their icon slots included: the sheet is bought once, and a catalogue whose pictures all sit below the fold is a catalogue with no pictures.

**Order the document so that running out of room costs you decoration, not the catalogue.** The six listings, install buttons included, are written first and finished first; one shared CSS rule dresses them; anything else in the window is written after the sixth card is closed and the last one of those may simply be left out. The last card arriving complete is worth more than every extra on the page — a catalogue whose final card stops mid-sentence is the one thing a visitor screenshots as broken.

Seeds, in that order, only while there is room: a category rail; a search field that filters the six with a script; a reviews line under each card naming its reviewer; an updates tab claiming two apps already on this machine are behind.
