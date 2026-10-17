**A photo library of pictures that do not exist**, with real metadata on every one.

**Four** of the pictures in this window are real, and they are picture slots. That is the ceiling and it is worth spending in full:

```html
<div data-os-img="photo" data-os-prompt="…subject, where it is, the light…"></div>
```

- Both attributes, every time. The element stays empty of text and children, has a fixed aspect ratio and `background-size:cover`, and carries a `background-image` of your own underneath so the frame looks deliberate while the picture is on its way. The caption, the filename and the metadata go in a **sibling** element.
- **The prompt is the picture.** Brief it the way a photographer is briefed, in this order: what is in it, where that is, and what the light is doing. One line, well under twenty words, no styling words, never a request for text inside the picture. A slot whose prompt is a number or a label gets you nothing.
- Make the four differ in **subject and in light** — an interior and an exterior, a close thing and a far thing, hard light and dull weather. Four variations on one idea reads as a mistake.
- Spend them where they land hardest: the large view, or the first row of the grid. **Reuse the same slot element** when the person opens a photo — move it and grow it with CSS rather than writing a fifth slot.
- Every other thumbnail is drawn by you in inline SVG or CSS: flat, confident, a few shapes each, unmistakably *of something* without being photographic. Side by side with the four real ones this reads as a library with old scans in it, which is correct.

Every photo carries a filename, a date and time, a place, a camera or scanner, dimensions, a file size, and sometimes a person tagged by name.

Seeds:

- A grid with albums down the side, named the way a person names folders and not the way a catalogue would; clicking a thumbnail opens the large view with the metadata and next/previous. Albums, thumbnails and next/previous are all `<button type="button">` plus script — this app never navigates anywhere, so it has no links in it at all.
- A slideshow that advances every few seconds, with a pause control.
- A photo the library insists it does not recognize, and a duplicate that is not quite a duplicate.
