# icons — the image prompt the SERVER builds

**Contract (seam S3).** The kernel asks for an icon sheet with `{kind, session}` and nothing else. The server owns every word of the prompt: it renders the single fenced block below — `{{variable}}` substitution only, no logic — and sends the result to the image model. Everything after the block is commentary for people and is never sent.

```text
4x4 grid of sixteen identical blank icon plates, sixteen cells, one plate centred in each cell, every plate the same shape, the same size, the same material and the same finish, {{era_decade}} interface hardware, {{palette_words}}, the middle of every plate left clear and unmarked, plain background, evenly spaced, cells touching edge to edge, no symbols, no pictograms, no marks, no objects, no text, no letters, no numbers, no gutters, no grid lines, no frames, no shadows between cells
```

## Variables

| variable | filled with |
|---|---|
| `{{era_decade}}` | the boot's `era_decade` die, so the plates belong to the same decade as the shell |
| `{{palette_words}}` | the identity's `palette_words`, the first three or four, comma separated |

`{{icon_cells}}` and its alias `{{app_shapes}}` are still rendered by the server and are deliberately **not** used here any more; see the ruling below. The rendered prompt is now ~490 characters instead of ~1,200.

## Size

768×768 at 4 steps (`server/img.ts`), sliced at exact quarters by `kernel/sheet.ts`, one billing unit like every other picture. SPEC §12.5 asked for 1024×1024 and IMG-LATENCY-1 cut it; HANDOFF-6 §3 measured why it mattered — at 1024 the sheet was the largest picture of the boot, took 5.3 s and 14.2 s under stress, and was the one most often lost to `IMG_TIMEOUT_MS`. The sheet is the picture the launcher grid is made of, so it is the one that must not be the slowest.

## The ruling this file implements (architect, 2026-09-17, verified live)

The sheet used to name sixteen app shapes in manifest order, and the kernel sliced it in that order. The slicing was always correct — cell *n* to the *n*th app — and the sheet was not: **FLUX schnell does not place sixteen specific subjects in a requested order.** On the verified boot the weather cell held a music note and the news cell held the cloud. Meanwhile the model's own emoji or glyph inside each `[data-os-icon]` was semantically perfect on every launcher — right up until the picture was laid over it and covered it.

So the division of labour is inverted. **The picture supplies the plate; the model supplies the meaning.**

- Sixteen **matching blank plates**: same shape, same material, same era, same palette, no symbols and no text. There is nothing in the sheet that can be in the wrong cell, because every cell is the same.
- The model's single glyph **stays visible, centred, on top of its plate** — `prompts/system/desktop.md` sizes it to read at plate size and asks for the model's own colour and shadow so it holds against whatever the plate turns out to be. The kernel applies the sheet cell as a *background behind the glyph* and no longer hides or covers it.

## Why it is worded the way it is

- **`sixteen identical blank icon plates` … `every plate the same shape, the same size, the same material and the same finish`** — the failure mode of "blank" alone is sixteen different blank things (a disc, a card, a lozenge, a slab). A launcher grid where every plate is a different shape looks broken in a way sixteen wrong symbols did not, because a person reads the grid as one set. Identical is the requirement; what the set *is* stays the model's.
- **`the middle of every plate left clear and unmarked`** — the glyph goes there. A plate with its own bevel, seam, screw or highlight through the centre fights the character sitting on it.
- **`no symbols, no pictograms, no marks, no objects`** — four ways of saying the same thing because the model will happily draw one anyway; a symbol is now a *defect*, not a miss. `no text, no letters, no numbers` stays for the same reason it always did: the word for the app is the model's job, in markup, in this machine's own language.
- **`cells touching edge to edge, no gutters, no grid lines, no frames, no shadows between cells`** — the kernel cuts at exact quarters (`kernel/sheet.ts`). A sheet drawn with margins or a frame puts a neighbour's edge inside every launcher. This is mechanical, not decorative, and it is the one clause that must never be trimmed.
- **`{{era_decade}} interface hardware`** — what makes the model draw a *plate* (a key, a tile, a button blank) instead of an illustration of nothing. The decade is the tie to the shell.
- **Sixteen, always.** The sheet is bought for the manifest and the kernel indexes it by cell. Because every cell is now interchangeable, a mis-ordered sheet is no longer possible — but a sheet with the wrong *count* still puts a quarter-cell edge in every launcher, so the geometry words stay exactly as they are.
- **No manifest order and no app shapes.** They bought nothing and cost ~900 characters of prompt, and every character of an image prompt competes with the geometry clauses that the kernel actually depends on.

## What a Store-installed app gets

Unchanged in shape: one extra 1×4 strip on demand. Now that the plates carry no meaning, that strip is the same prompt with a `1x4` grid of four identical blank plates — it does not need to know what was installed, which is the second thing this ruling simplifies.
