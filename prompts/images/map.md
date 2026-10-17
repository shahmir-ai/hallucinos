# map — the image prompt the SERVER builds

**Contract (seam S3).** The kernel asks for a map surface with `{kind, session}` and nothing else. The server owns every word of the prompt: it renders the single fenced block below — `{{variable}}` substitution only, no logic — and sends the result to the image model. Everything after the block is commentary for people and is never sent.

```text
flat top-down illustrated street map of a city that does not exist, printed cartographic style, {{era_decade}} paper map, a street network drawn as lines, city blocks between the streets, a river or a stretch of coast, parks and open ground, {{palette_words}}, muted, low contrast, seen straight down from directly above, no perspective, no buildings drawn in elevation, no aerial photography, no satellite imagery, no photograph, no people, no vehicles, no text, no letters, no numbers, no legend, no compass, no pins, no markers
```

## Variables

| variable | filled with |
|---|---|
| `{{era_decade}}` | the boot's `era_decade` die, so the map is printed in the same decade as the shell |
| `{{palette_words}}` | the identity's `palette_words`, the first three or four, comma separated |

Rendered length ~530 characters. Size is 768×576 at 3 steps (`server/img.ts`), one billing unit like every other picture.

## Why this became a server-owned prompt

Until v0.3 the map was one of the three slots the *model* described, through `data-os-prompt` on its own `[data-os-img="map"]` element — and `prompts/apps/maps.md` asked it to name "the terrain this place sits in". That wording is what SPEC §12.5 asked for ("a map of a city that does not exist, top-down, muted cartographic colours"), routed through a model that never sees the result. Two things go wrong with it:

1. **A terrain brief gets terrain, not a map.** "A cold estuary, low farmland, lightly built up" is an honest answer to the question asked and produces a *landscape* — which, viewed from above, is an aerial photograph, which is exactly what the app's own instructions then tell the model to apologise for by drawing an overlay on top of it.
2. **The surface has to match the overlay's projection or the overlay is nonsense.** The model draws pins, labels, routes and a scale bar in an absolutely positioned SVG layer. Those only read as a map over a *plan* — a flat, straight-down street drawing. Nothing in a per-document prompt guaranteed the projection, so the two halves could disagree on every open.

So the map joins the wallpaper and the icon sheet on seam S3: the server writes the words, from the identity and the dice, and the same three clauses are in every one of them.

**One loose end, deliberately left in the prompt rather than in the kernel.** The runtime collects picture slots with `querySelectorAll('[data-os-img][data-os-prompt]')` and skips any whose prompt is empty (`kernel/injected/runtime.ts`), so a map slot written with no `data-os-prompt` would never be asked for at all. Until the kernel collects `map` without that attribute, `prompts/apps/maps.md` asks the model to write the literal word `map` in it — an attribute that exists only as the collection marker, whose text the server discards. The alternative was a kernel change this pass does not own.

## Why it is worded the way it is

- **`flat top-down … seen straight down from directly above, no perspective`** — the projection stated three ways, because it is the one thing the overlay depends on and one clause of it is not enough. `no buildings drawn in elevation` kills the three-quarter isometric city, which is what "top-down city" alone tends to draw.
- **`no aerial photography, no satellite imagery, no photograph`** — the failure this file exists to prevent. A photograph from above is not a map; it has no street network a route can follow.
- **`printed cartographic style`, `{{era_decade}} paper map`** — what makes it a *drawing* of a city rather than a picture of one. The decade is the tie to the shell, the same as the wallpaper's.
- **`a street network drawn as lines, city blocks between the streets, a river or a stretch of coast, parks and open ground`** — the four things a person recognises a street map by, named positively and generically. No city is named and no place is described: the invented city is the model's, in its own labels, in the overlay.
- **`no text, no letters, no numbers, no legend, no compass`** — every one of those is the model's job in SVG, in this machine's own language, and an image model's version of them is illegible scribble at any size.
- **`no pins, no markers`** — the pins are the overlay. A drawn pin under a real one is two pins on one place.
- **`muted, low contrast`** — the overlay's labels and routes sit on this picture. It is the wallpaper problem again, and the same answer.
