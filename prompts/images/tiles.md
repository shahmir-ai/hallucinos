# tiles — the image prompt the SERVER builds (T2)

**Contract.** This is the one image prompt with two authors. The document says *what its set of sixteen is*, in the `data-os-prompt` on the group's first element (seam S1); the server says *what a sheet is* — the theme's subject clause, the palette that ties an app's sheet to this machine, and the geometry the kernel slices at (seam S3). The server renders the single fenced block below — `{{variable}}` substitution only, no logic — and sends the result to the image model. Everything after the block is commentary for people and is never sent.

```text
{{theme_subject}}, {{set}}, {{palette_words}}, sixteen cells in a 4x4 grid, sixteen separate pictures, one picture in each cell, all sixteen different, each cell a complete picture in itself, every cell filled to its own edges with its own picture, evenly spaced, cells touching edge to edge, no margin around the sheet, every place and every subject invented and anonymous, no one continuous scene divided into cells, no shelf, no rack, no display stand, no wall of frames, no empty cell, no blank cell, no flat colour cell, no gradient cell, no gutters, no grid lines, no frames, no borders, no landmark, no monument, no famous building, no recognisable city, no flag, no signage, no text, no letters, no numbers, no captions, no logos, no watermarks
```

`prompts/images/tiles-<theme>.md` overrides this file for one theme and is read first (`server/imgprompt.ts` `buildTilesPrompt`). There is no such file today and there should not be one until a single theme misbehaves on its own: five copies of the geometry clauses are five places to forget the one clause the kernel depends on.

## Variables

| variable | filled with |
|---|---|
| `{{theme_subject}}` | the subject clause for the group's `data-os-theme` — what the sixteen pictures *are*. One of the five below |
| `{{set}}` | the group's own `data-os-prompt`, whitespace-collapsed, clamped to 320 characters, and moderated exactly as `photo` and `map` are. Renders empty when the document left it blank, and the sentence still reads |
| `{{theme}}` | the raw theme word, available and deliberately unused: `thumbnails` names a size rather than a subject, and an image model given the bare word draws a contact sheet of a contact sheet |
| `{{palette_words}}` | the identity's `palette_words`, the first three or four — **on an app document only.** A page never receives identity (SPEC §3.1), so every identity variable renders empty there and a page's sheet takes its colour from the set description alone |

### The five themes and their subject clauses

| `data-os-theme` | what `{{theme_subject}}` says |
|---|---|
| `faces` | portrait photographs of sixteen people who do not exist, head and shoulders, each facing the camera, even soft lighting |
| `posters` | sixteen printed poster designs for works that do not exist, each upright and filling its cell, flat graphic shapes, printed ink |
| `products` | sixteen product photographs of manufactured objects that do not exist, one object centred per cell, even studio lighting |
| `thumbnails` | sixteen small photographs of invented everyday scenes, one per cell, a mix of interiors, close views of objects, weather over open ground, crowds of strangers and plain abstract texture, every place invented and anonymous, even exposure |
| `covers` | sixteen cover designs for works that do not exist, each upright and filling its cell, flat graphic shapes and simple illustration |

`faces` is the alias: a document written to the older `data-os-img="faces"` + `data-os-face="n"` spelling resolves to this same template with this same clause, and nothing in that document has to change.

## Size

768×768, 4×4, sliced at exact quarters by `kernel/sheet.ts` — the same geometry as the icon sheet, and one billing unit like every other picture. **One sheet per document**, counting as one picture against the app's four or the page's two, however many tiles share it. That is the whole economic point: sixteen pictures for $0.003, which is what makes a poster wall or a contact list affordable at all.

## Why it is worded the way it is

- **`all sixteen different`, against the icon sheet's `sixteen identical`.** These are the two sheets and they want opposite things. The icon sheet's ruling (`prompts/images/icons.md`) is that its picture must carry *no* meaning, because FLUX schnell will not put sixteen named subjects in a requested order and a plate in the wrong cell is a weather launcher with a music note on it. A tile sheet is the case where mis-ordering costs nothing — no tile is promised to any particular row — so variety is the requirement rather than the risk.
- **The subject clause comes first and the geometry last.** The set description is the only part that varies per open, and it is the document's, which is why it is clamped: the grid clauses are what the runtime depends on and they have to stay within reach of the model's attention.
- **`each cell a complete picture in itself`** — the failure of a bare 4×4 request is one large picture with lines drawn across it, which slices into sixteen fragments of one thing.
- **`cells touching edge to edge, no gutters, no grid lines, no frames, no borders`** — mechanical, not decorative, and the clause that must never be trimmed: the kernel cuts at exact quarters, so a sheet drawn with a margin or a frame puts a neighbour's edge inside every tile. The icon sheet carries the same clause for the same reason, learned on the first real boot.
- **`every cell filled to its own edges with its own picture`, `no margin around the sheet`, `no empty cell, no blank cell, no flat colour cell, no gradient cell`** (R4) — HANDOFF-7 §7: "the first row is often blank", white gradient where rows 2 and 3 were photographs. `plain background` was in this template for the frames-and-gutters reason above and it is what asked for that: a baseline `thumbnails` sheet drawn with it (reviews/SERVER-v06.md) came back as a contact sheet with **white margins around every cell**, which the quarter-slice puts inside every tile. A sheet whose cells touch edge to edge has no background at all, so the clause could only read as permission to leave the sheet unpainted.
- **`sixteen separate pictures` and `no one continuous scene divided into cells, no shelf, no rack, no display stand, no wall of frames`** (R4, second measurement) — the coverage requirement was first written at SHEET level ("the whole sheet covered in pictures to all four of its edges") and bought the opposite failure: `products` came back as a photograph of a shop's **shelving unit** and `covers` as a **bookcase**, both with their rails crossing the slice lines, where the same themes on the old wording gave a clean 4×4. Coverage therefore belongs to the CELL, and the display furniture an image model reaches for when it is told to fill a frame is named.
- **`every place and every subject invented and anonymous … no landmark, no monument, no famous building, no recognisable city, no flag, no signage`** (R4) — HANDOFF-7 §7 again: `thumbnails` drew a recognisable Eiffel Tower and Spanish Roman ruins on the fake internet inside an invented machine. "scenes that do not exist" was the whole defence and it does not work — an image model reads "scene" as "photograph of somewhere", and somewhere is the places its training set has most of. The named subject CLASSES in the `thumbnails` clause (interiors, close views, weather, crowds, texture) are the positive half of the same fix: a class is a direction, where a named place is an attractor. SPEC §1.10's line — parody is in scope, impersonation is not — points the same way; so does immersion, which is the reason the map prompt has carried `no aerial photography` since v0.4.
- **`no text, no letters, no numbers, no captions, no logos, no watermarks`** — a poster wall and a shelf of covers are the two subjects an image model most wants to letter, and its lettering is illegible at tile size. The title, the price, the channel and the name are the document's job, in sibling elements, in this reality's own words.
- **No era die and no motif die.** The wallpaper, the icon sheet and the map are the *machine's* own pictures and carry `{{era_decade}}` to tie them to the shell. A tile sheet is the content of an app or of a web page, and a page has no machine at all: its period, if it has one, is in the set description the document wrote.
- **The palette only on an app's sheet.** A catalogue inside this OS should look like it belongs to it; the fake internet has its own reality and takes nothing from the identity. When it renders empty the template leaves an empty comma-separated slot, which reads as nothing to the image model — the same tolerance every other file here is written for.

## Deviation to note

The five subject clauses also exist in `server/imgprompt.ts` (`BUILTIN_TILES`), as the fallback for a tree with no `prompts/images/tiles.md` — which is how every other image kind works too. The table above is the reviewed wording; if the two ever disagree, this file is what the server actually sends, because a file that exists wins over the builtin.
