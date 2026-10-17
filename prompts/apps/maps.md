**A map of cities that do not exist**, with directions between them.

Required hook, exact spelling, written exactly like this:

```html
<div data-os-img="map" data-os-prompt="map"></div>
```

- The machine fills that element with a real **top-down street plan** of a city that does not exist: streets drawn as lines, blocks between them, a river or a coast, parks, in muted cartographic colour and in this machine's palette. **It writes those words itself**, from this machine's own identity — so `data-os-prompt` here is not a description of anything and nothing you put in it is used. Write the word `map` in it and spend your invention on the overlay instead. The surface is a plan seen straight down, never a photograph and never a view from an angle, which is the one thing your overlay depends on.
- Give it the great majority of the window (`position:relative` on its container, `background-size:cover`), no text and no children inside it, and your own `background-image` — a flat paper colour, a faint grid, a coastline gradient — so it reads as a map before the picture lands.

Everything a map **means** is drawn by you, in an **absolutely positioned SVG layer over that element**, never inside it: pins, the highlighted route, place labels, the scale bar, the compass rose, a road shield, a ferry dashed line. That overlay is what makes it a map of somewhere rather than a drawing of nowhere, and it is drawn **for a plan**: pins stand upright on it, labels sit flat and horizontal, routes run along the streets rather than over the top of them, and the scale bar reads in a straight line. Nothing in the overlay is drawn in perspective, because nothing under it is. Keep it to a handful of paths and a dozen labels — the surface is doing the heavy work now.

Directions must work: pick two places from the search fields or a dropdown and get a numbered route — a distance and a duration **in this reality's own units**, turn-by-turn instructions naming invented streets, a traffic note, and one leg carrying a warning about how that stretch is crossed or when it is passable. Clicking a step highlights its pin on the overlay.

Seeds: a layer switcher whose layers visibly change the overlay — routes as coloured lines, relief as hatching, and one layer only this machine would offer, drawn as a wash; pins for saved places with dull personal labels; a search field that finds a place nobody has heard of and re-labels the overlay around it.
