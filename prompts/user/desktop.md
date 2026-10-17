Draw the shell of this machine.

IDENTITY
{{identity_json}}

ARCHETYPE — build this one, exactly as its structure says. It is the `archetype` field of the identity above; the same word.
{{archetype}}

Die roll: {{seed}}
Screen: {{viewport}}

One HTML document. Before you answer, check that all nine are in it:

```
<body data-os-archetype="…">  the archetype word
data-os-desktop=""            (an attribute on a tag, not a CSS selector)
data-os-windows=""            empty
data-os-taskbar=""            empty of entries
data-os-clock=""              ticking, with the date
data-os-img="wallpaper"       empty
<template data-os-window="">  containing  data-os-title  data-os-content  data-os-close  data-os-drag
<template data-os-task="">    containing  data-os-title
a launcher element for each of these {{app_count}} ids, each holding a data-os-icon="<that id>" element:
  {{app_launchers}}
```

LAST, and checked in the template before you answer — every window on this machine is a clone of `template[data-os-window]`, so all five of these are true in it:

```
a visible title bar across the top of the window: min-height:28px, padding inside it,
  above data-os-content — never the app's own heading standing in for it
its background clearly a different colour from the window body
data-os-title readable in it: solid colour, one line, ellipsised
three controls in that bar — data-os-minimize  data-os-maximize  data-os-close —
  each at least 20x20, each with its own visible glyph or word, none needing a hover
[data-os-focused="true"] [data-os-drag] and [data-os-focused="false"] [data-os-drag]
  differing in background colour
```

A title bar nobody can see is a window nobody can move, and a close control with no size is a window nobody can put away.
