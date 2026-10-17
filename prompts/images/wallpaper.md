# wallpaper — the image prompt the SERVER builds

**Contract (seam S3).** The kernel asks for a wallpaper with `{kind, session}` and nothing else. The server owns every word of the prompt: it renders the single fenced block below — `{{variable}}` substitution only, no logic — and sends the result to the image model. Everything after the block is commentary for people and is never sent.

```text
desktop wallpaper, {{era_decade}} computer operating system default background, {{wallpaper_motif}}, {{palette_words}}, no text, no people, no animals, no objects in focus, soft, low contrast
```

## Variables

| variable | filled with |
|---|---|
| `{{era_decade}}` | the boot's `era_decade` die (`data/dice.json`), e.g. the decade alone |
| `{{wallpaper_motif}}` | the boot's `wallpaper_motif` die — one motif per boot, and the only thing that decides the picture's subject |
| `{{palette_words}}` | the identity's `palette_words`, the first three or four, comma separated |

Keep the rendered prompt under ~300 characters. If a die or the palette renders empty the sentence still reads, which is why every part of it is a comma-separated phrase and not a clause.

## Why it is worded this way (BAKEOFF-2, "Images")

The v0.1 prompt asked for a wallpaper for an operating system by name, abstract, no text — and got gallery-grade photography: a photographed animal or a single hero object, studio-lit, centre frame, seven boots out of nine. Beautiful, and not wallpaper. Every clause above is a fix for something that came back (no examples of the pictures are written down here, deliberately: this file is loaded next to a model):

- **`{{era_decade}} computer operating system default background`** — the decade and the words "operating system default background" are what make the model draw a *wallpaper* instead of a photograph. The old prompt had the machine's name in it, which bought nothing: the model cannot know the name.
- **`{{wallpaper_motif}}`** — the subject now comes from a die (≥ 40 motifs, all abstract, landscape or pattern), not from the identity's mascot. The mascot is what produced the animals.
- **`no people, no animals, no objects in focus`** — the three things that made the old wallpapers read as stock photography. A hero object in the middle of the screen is where the launchers go.
- **`soft, low contrast`** — launcher labels sit on this picture. A busy, high-contrast wallpaper makes every label unreadable, and the desktop prompt's label plates should not have to do all the work.
- **no personality, no mood, no tagline** — they pulled the picture toward illustration. The palette words are the only identity input left.

The identity's own `palette_words` stay in because they are the one thing that ties the picture to the machine: the honeycomb-sunrise and desk wallpapers of BAKEOFF-2 were the two that looked right, and both were palette-led and flat, and neither had a subject you could name.
