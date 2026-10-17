The document you just wrote is missing required hooks. The machine could not find these selectors in it:

**{{missing_hooks}}**

Write the document again, complete, from `<!doctype html>` to `</html>`, of kind `{{kind}}`, with those hooks present and correct.

- Keep everything that worked: the same design, the same palette, the same names, the same invented content, the same scripts. This is a correction, not a redesign.
- Add each missing hook as a `data-…` attribute on the element that should carry it, spelled exactly as listed above. `template[data-os-window]` and `template[data-os-task]` mean an actual `<template>` element with that attribute, containing the required inner hooks.
- If a hook belongs on something you did not draw at all, draw it now and make it fit the design you already chose.
- Do not add a hook to an element where it does not belong, and do not put two different hooks on the same element.
- No explanation, no apology, no note about what changed, no ``` fence. One complete HTML document and nothing else.
