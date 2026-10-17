You are writing the **shell** of this operating system: the whole screen a person lands on after it boots. Wallpaper, launchers, taskbar or dock, menus, clock, and the chrome every window will wear.

This is the most important screen you will ever write. It is the one people screenshot.

---

## Nothing about the look is prescribed

We give you a structure and a list of parts. We tell you nothing about what any of it looks like, and there is no house style to match.

Yours: the era, the colours, the wallpaper, the type, the window chrome, the name and icon of every app, the density, the sounds you describe but never play, and the little inventions nobody asked for — a readout, a duty name, a notice in small type, whatever this machine's job would have put on its own screen. Use the identity you were given: its name belongs on screen somewhere legible, its palette words are the palette, its personality is audible in every label you write.

---

## The archetype — build the one this machine chose

The identity carries an `archetype` field. Its value is `taskbar` or `dock`, and it is also stated in the request below. Build **that one**, following its structure exactly. Everything inside the structure is still yours.

### `taskbar`

- A bar along the **bottom edge**, full width: a launcher or start control at one end, the open windows in the middle, a ticking clock with the date at the other end.
- Launchers are **icons in a grid on the wallpaper**, aligned to the **top left**, label under the icon. Every one of them, in the grid — see "The launcher grid" below.
- Windows: a title bar with a readable title and three clearly visible controls at its **right** end.

```html
<body data-os-archetype="taskbar">
  <div data-os-img="wallpaper"></div>
  <div data-os-desktop="">
    <button data-os-app="browser"><span data-os-icon="browser">…one glyph…</span><span>…your name for it…</span></button>
    <!-- one of these for every id in the list below, laid out as a grid -->
  </div>
  <div data-os-windows=""></div>
  <div data-os-taskbar="">
    <button>…start control, order:-1…</button>
    <div data-os-clock="" style="…order:99…"><span>…the time…</span><span>…the date…</span></div>
  </div>
</body>
```

`[data-os-taskbar]` is a flex row, and the machine appends one entry per open window as a plain child of it. Give your start control `order:-1` and your clock `order:99` in CSS, so the entries land between them where they belong.

### `dock`

- A **menu bar along the top**, full width: the machine's name or its menu at the left, a ticking clock with the date at the right.
- A **dock** along the bottom (or one side) holding launchers as icons. **A dock holds at most eight of them, in a single row** (a single column when it is on a side) — a dock of {{app_count}} icons is a smear along the edge, and on a narrow screen it runs off the end. A second row in a dock on the bottom edge puts its own icons below the bottom of the screen, where nobody can click them.
- **The launchers that do not fit in the dock sit on the wallpaper as desktop icons, in a grid**, aligned **top right**. Split them deliberately: the everyday ones in the dock, the rest on the desk. Every id is still present, and still an icon with a label.
- Windows: a title bar with a readable title and three clearly visible controls at its **left** end.

```html
<body data-os-archetype="dock">
  <div data-os-img="wallpaper"></div>
  <div>…menu bar: machine name / menus … <span data-os-clock=""><span>…the time…</span><span>…the date…</span></span></div>
  <div data-os-windows=""></div>
  <div>…the dock…
    <div data-os-desktop="">
      <button data-os-app="browser"><span data-os-icon="browser">…one glyph…</span><span>…your name for it…</span></button>
      <!-- up to eight of them here; the rest as desktop icons in a grid -->
    </div>
    <div>…your divider…</div>
    <div data-os-taskbar=""></div>
  </div>
</body>
```

In this archetype `[data-os-desktop]` is the launcher end of the dock and `[data-os-taskbar]` is the running end of it, past the divider, where the machine appends one entry per open window.

### Both archetypes

- **The clock ticks, and the time and the date are two elements.** `[data-os-clock]` holds **two child elements: one for the time, one for the date** — never one element with both strings in it, and never the date written into the same text node as the time. The time updates every second (your own tiny script, `setInterval`, no network); the date is visible from the first paint. Format both in this machine's own convention, as long as a person can read the time and the date off the screen.
- **The time and the date have a visible gap between them.** This is the rule this machine breaks most often: the clock renders as `02:20:5018/09/2026` and a person reads one number of eighteen digits. The two child elements get `display:flex;gap:8px` on the clock, or `margin-left:8px` on the date, or a separator character in its own element between them — any of the three, as long as there is a measurable space on the screen between the last digit of the time and the first character of the date. Padding on the clock as a whole does not do it: the gap has to be *between* the two.
- **Icons stay icons.** A launcher is a picture with a label under or beside it. Never a plain list row, never only a line in a menu. A menu may exist as well, and may repeat launchers, but every app is reachable as an icon.
- **The bar is laid out with space between its parts.** Whichever bar your archetype puts on the screen — the taskbar along the bottom, the menu bar along the top — is a flex row whose ends are pushed apart: `display:flex;align-items:center` plus `justify-content:space-between`, or `margin-left:auto` on the part that belongs at the far end. The machine's name or the start control sits at one end, the clock and the date at the other, and the open middle is where the machine appends the window entries.
- **Nothing in a bar touches its neighbour.** Give the bar a `gap`, and every element in it padding of its own, so any two runs of text in it have a space between them — a name and a time that meet with nothing between them are read as one word. The pair this goes wrong on is the **time and the date inside the clock** (above), measured jammed on real boots; the clock as a whole also keeps its own padding away from whatever sits beside it.

### The launcher grid — the rule that is broken most often

All {{app_count}} launchers are visible at {{viewport}} **without the page scrolling and without the launcher area scrolling**, and they are arranged as a **grid**:

- **A grid, never a single line.** One row of {{app_count}} icons, or one tall column of them, is wrong in both archetypes: the far end is always off the edge of the screen.
- **At most eight icons in a row. At most five icons in a column.** Inside those two limits the shape is yours — square, wide, two blocks with a gap.
- Lay it out with `display:grid` and a fixed number of columns (`grid-template-columns: repeat(<n>, <size>)`), or `flex-wrap:wrap` on a container with a width that forces the wrap. Do the arithmetic once: icon size plus gap, times columns, fits inside {{viewport}} with room to spare, and the last row ends well above the bottom bar.
- Icons clipped off the bottom or the right edge is the single most common way this desktop is wrong, and the machine measures it.
- **Each launcher keeps its own patch of screen.** The grid gives every launcher a cell, and the icon and the label live inside that cell, stacked or side by side, both of them inside its edges. Gaps between the cells are wide enough that a long label stays inside its own — a label wider than its cell is what writes one launcher across its neighbour. Launchers are laid out by the grid, never placed one by one with `position:absolute`, and the machine measures whether any two of them cover each other.

### Labels stay readable over any wallpaper

The wallpaper that lands behind your launchers is a photograph you have never seen, and it can be any brightness anywhere. So **every launcher label sits on a small plate of its own**: a background colour from your palette behind the words, a couple of pixels of padding, a radius if it suits the era — dark plate with light text or light plate with dark text, whichever your palette wants. One rule does all of them:

```css
[data-os-app] span + span{background:…;color:…;padding:1px 4px;border-radius:…}
```

A bare label in your palette's mid-tone, straight onto the picture, is illegible half the time.

### Every launcher keeps its label, from the first paint onward

The label is how a person knows what a launcher opens, so it is a permanent part of the launcher and nothing that happens to the icon reaches it.

- **The icon box is a fixed 48 px by 48 px**, and the label is a **sibling element outside that box** — under the icon, or beside it, inside the launcher's own box. The only thing inside `[data-os-icon]` is its single glyph.
- **The launcher's box is the icon, plus the gap, plus one line of label.** Let the launcher size itself to its contents, or give it a height with room for both, and leave its overflow visible: the label needs its own strip of the cell, and a launcher fixed to the icon's 48 px cuts its own label off.
- **The label reads off the screen at all times** — on the first paint, a second later, and for as long as the machine runs — with nothing hovered, nothing focused and nothing clicked. A name that appears under the pointer is not a label, and neither is a `title` attribute.
- **No rule keyed to the icon touches the label.** A second or two after you write it, the machine puts a plate into the icon box: it sets a background on `[data-os-icon]` and marks that one element, and it changes nothing else in the launcher. So the label's own rule stands on its own — nothing in your stylesheet and nothing in your script hides, empties, fades or moves a label when the icon gains a background, an attribute or a class. The picture lands inside the icon box and the rest of the launcher looks exactly as it did before.

---

## Required hooks — exact spelling, one element each

These are how the machine finds your parts. All of them must be in the document you return.

```
1  <body data-os-archetype="taskbar">  or  "dock"   the archetype from the identity
2  <div data-os-desktop="">   …launchers…          the launcher area
3  <div data-os-windows=""></div>                  the window layer, left EMPTY
4  <div data-os-taskbar=""></div>                  where window entries land, no entries drawn in it
5  <div data-os-clock=""><span>time</span><span>date</span></div>   the clock: two elements, a gap between them
6  <template data-os-window="">  containing  data-os-title  data-os-content  data-os-close  data-os-drag
7  <template data-os-task="">    containing  data-os-title
8  one launcher element per app id:                {{app_launchers}}
```

Write every hook as `name=""` like that, so all of them look the same as the `data-os-app="…"` launchers and the quotes always come in pairs.

A styling rule is not an element: a document whose only mention of `data-os-windows` is a line in the stylesheet has no window layer at all.

Any element may carry a hook — `<div>`, `<section>`, `<nav>`, `<ul>`, `<button>`, `<aside>`. The tag is yours; the attribute name is not.

Both `<template>` elements are real `<template>` tags. They are the two things that go missing most often, and a desktop without them has no windows and no taskbar entries at all — the machine has nothing to clone.

### Two habits to break

`data-os-…` is an **attribute name**. It goes inside the tag, bare, with no square brackets:

```html
<div data-os-desktop="">         <button data-os-close="">X</button>
```

Square brackets are selector syntax and belong only inside your `<style>`.

And the machine reads the document you return — it never runs your script first. Every hook has to be markup you typed: both `<template>` blocks and all {{app_count}} launcher elements, written out one by one.

The ids are a closed list: exactly the {{app_count}} below, spelled exactly, no invented ones, none left out. Count your launchers against the list before you move on — the ones at the end of the list are the ones that get dropped. The *label* on the launcher is where this machine's own name for the app goes; the id never changes.

**Order what you write so that running out of room costs you decoration, not structure.** Source order only — CSS puts anything anywhere on the screen:

```
<head> with your <style>
<body data-os-archetype="…">
  the two <template> blocks        ← invisible, cheap, and the first thing forgotten
  the wallpaper slot
  data-os-desktop with every launcher in it
  data-os-windows   (empty)
  data-os-taskbar   with the clock
  the rest: furniture, menus, your <script>
</body>
```

---

## The picture slots

Two of your elements get a real picture from the machine a second or two after you write them. Style both so they look deliberate before the picture lands and after it does, and keep them empty of text and child elements.

### `[data-os-img="wallpaper"]` — one element, the whole screen behind everything

```css
[data-os-img="wallpaper"]{position:fixed;inset:0;z-index:0;background-size:cover;background-position:center;
  background-image:linear-gradient(…your own wallpaper…)}
```

Your gradient or `data:` SVG shows first and is replaced by the picture when it arrives. Everything else on the desktop sits above it.

### `[data-os-icon="<appId>"]` — one per launcher, inside the launcher element

The icons arrive as one sheet cut into cells, so every icon element needs the same square shape:

```css
[data-os-icon]{width:48px;height:48px;background-size:400% 400%;background-repeat:no-repeat;
  display:flex;align-items:center;justify-content:center;
  border-radius:…;background-image:linear-gradient(…your own icon art…)}
```

- The value is the app id, spelled exactly as in the list: `data-os-icon="browser"`, `data-os-icon="taskmgr"`.
- Your own art is the `background-image`. A different gradient or `data:` SVG per app is worth the tokens — this is what people see while the sheet is on its way, and what they see forever on a machine with no pictures.
- **Put exactly one character inside it** — a glyph or an emoji of your own choosing for that app, centred, and nothing else: no words, no second character, no nested element. **That character is what tells a person which app this is, permanently.** What arrives from the sheet is a blank plate, and it lands *behind* your character, never over it: the plate is the material the icon is made of and your glyph is its meaning.
- **So size and colour the glyph to read on a plate you have not seen.** Give `[data-os-icon]` a `font-size` around two thirds of the icon's box (about `32px` in a 48 px icon), `line-height:1`, a colour of your own from the palette, and one `text-shadow` — or a `paint-order`-style outline — so the character holds whether the plate turns out light or dark. One rule on `[data-os-icon]` does all {{app_count}} of them; this is the cheapest four declarations on the whole desktop.
- The label goes in a **sibling** element next to the icon, never inside it.
- **One `data-os-icon="<id>"` element per app, and only inside that app's launcher.** The sheet has exactly {{app_count}} cells, so an app that also appears in a menu gets a glyph or a plain label there, never a second icon slot — more slots than cells and the surplus stay empty for good.
- The one exception: inside `template[data-os-task]` the optional icon slot is written bare, `data-os-icon=""`, with no id — the machine drops a short glyph in that one.

---

## The parts, in one line each

- **`[data-os-desktop]`** — the launcher area. The machine may append one more launcher here when the user installs something from the app store, so style launchers by attribute (`[data-os-app] { … }`) rather than by class alone, and use a layout (grid, flex-wrap) that tolerates one more child.
- **`[data-os-windows]`** — the layer windows live in. Windows are positioned absolutely inside it: give it `position:absolute` or `fixed` covering the working area, above the wallpaper, and leave it empty.
- **`[data-os-taskbar]`** — receives one entry per open window. Leave it empty of entries; other furniture beside them is fine.
- **`template[data-os-window]`** — cloned once per window, inserted into `[data-os-windows]`. Its title bar has its own section below ("The window chrome"), and every requirement in it applies. Exactly **one root element**, and the machine writes `data-os-focused="true|false"` onto that root. The machine writes `position:absolute; left/top/width/height; z-index` onto that root inline, so never set those in your CSS with `!important`. Inside it, required: `[data-os-title]` (the machine writes the window's title in), `[data-os-content]` (an **empty** container that the frame fills completely — `flex:1 1 auto` or `height:100%`, `overflow:hidden`, no padding you would regret), `[data-os-close]`, `[data-os-drag]` (dragging moves the window — normally the title bar; `cursor:move; user-select:none`). Optional and wired if present: `[data-os-minimize]`, `[data-os-maximize]`, `[data-os-resize]`. Window chrome is a place to invent, as long as the title stays readable and the three controls stay obvious: a marking in the title bar, a fastening drawn at the corners, controls labelled with words instead of glyphs, a small lamp that shows the window is attended.
- **`template[data-os-task]`** — cloned once per open window and appended into `[data-os-taskbar]`; the machine fills `[data-os-title]`, makes the whole clone clickable, and puts `data-os-active` on the one entry whose window is focused. Exactly one root element, sized to sit in your bar, styled so several in a row look right, visibly clickable without hover.

## Launchers — one per app, non-negotiable

For **every** app in the manifest below there must be at least one element carrying `data-os-app="<that exact id>"`:

{{manifest_json}}

Spelled out, so there is nothing to derive — one element carrying each of these:

```
{{app_launchers}}
```

- Copy the `id` strings character for character. A launcher for an id that is not in this list opens nothing.
- The label and icon are yours — rename every app into this machine's own language, and keep it guessable. The plain word the shape is described with is the one label that belongs to no machine in particular: every label should carry this machine's era, its job and its personality, and still be guessable at a glance.
- All {{app_count}} may sit in the launcher area, or some there and the rest behind a menu you build. Either way every id is in the document you return, and every one of them is an icon.

---

## The window chrome — the requirements of a usable window

The window template is cloned for every app anyone opens, so whatever you write here is worn by every window on the screen for the rest of this machine's life. The look is entirely yours. What follows is not a look: it is the list of things that have to be true before a person can use a window at all, and the machine measures most of them.

A window is being read against a photograph it will be sitting on top of, next to two or three other windows, by somebody who has never seen this computer before.

### The title bar

- **At least 28 pixels tall** — `min-height:28px` on the `[data-os-drag]` bar, and enough padding that the title inside it is not touching the edges. A bar thinner than that cannot be grabbed with a mouse and cannot hold a legible title.
- **It contrasts with the window body, and it contrasts with the wallpaper.** Two different jobs: against the body so the chrome reads as chrome and not as part of the app's own document, and against the wallpaper so the top edge of the window is a hard edge and not a colour that dissolves into whatever photograph is behind it. Take both colours from your palette; a bar one shade off the body is invisible on a screenshot.
- **The title is readable at a glance**: solid colour against the bar it sits on, at a size a person reads without leaning in, one line, and `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` so a long title is cut short instead of wrapping and pushing the controls off the bar. `[data-os-title]` is filled by the machine and can be longer than you expect.

### The three controls

- Three of them, at the end the archetype puts them, **each with a visible glyph or word of its own** — a mark that says what it does, drawn in a colour that stands out from the bar. Three coloured lamps are a fine era-correct answer as long as the marks are on them, or on them when the pointer is over the bar; three shapes with nothing in them leave a person guessing which one closes the window.
- **Each control is at least 20 pixels by 20 pixels of hit area** — `min-width:20px;min-height:20px`, padding counting toward it. Below that the close control is a coin toss.
- Visible **without hovering over anything**. A control that only appears on hover does not exist for anybody who has not found it yet.
- They sit in the bar with a gap between them, and the title never overlaps them.

### The window has an edge

A border, an outline, a shadow, a bevel, a plate it sits on — one of those, so the window is separated from the wallpaper, from a generated document whose own background may be any colour, and from the next window overlapping it. A window with no edge at all reads as a rectangle of unrelated content dropped on the picture.

### Focused and unfocused — the machine tells you which

The machine keeps one window focused and writes it onto the window's root element as you look at it:

```
[data-os-focused="true"]     the window the person is working in, one at a time
[data-os-focused="false"]    every other open window
```

Both values are always present on every window, so write rules for both and **make them obviously different**. **The one difference that is required is the title bar's own `background` colour**: the focused window's title bar is one colour, every unfocused window's title bar is a different colour, and the two are far enough apart to name from across the room. Everything else your era did goes on top of that — the sharper edge and the full-strength title on the focused one, a flatter bar and a dimmer title and a softer shadow on the rest.

```css
[data-os-focused="true"]  [data-os-drag]{background:…}   /* one colour */
[data-os-focused="false"] [data-os-drag]{background:…}   /* a different colour */
```

Someone with four windows open tells which one is listening by the colour of its bar, without moving anything.

### The running window's entry in the bar

The machine marks the entry belonging to the focused window the same way, on the clone of `template[data-os-task]`:

```css
[data-os-active]{…}
```

That attribute is on the entry for the window that is focused now, and on no other entry. Give it the treatment your era gives a pressed key or a current tab — and remember the unmarked entries are the normal state, so the marked one is the one that changes.

## The two templates, as structure (structure only — do not copy the look)

This is the nesting and the attribute spelling, and **nothing else**. There is deliberately not one line of styling in it, no class and no colour, and every `…` is a placeholder for a word or a glyph of yours: supplying those is the whole job. Wrap them in more elements, split the title bar into six parts, put the close control where the archetype puts it, label it `DISMISS` — all fine, as long as every attribute below survives somewhere inside the same template.

```html
<template data-os-window="">
  <div>                                <!-- exactly ONE root element; the machine writes
                                            data-os-focused="true|false" onto THIS element -->
    <div data-os-drag="">              <!-- the grab handle, normally the title bar: >= 28px tall,
                                            its background a different colour from the body -->
      <span data-os-title=""></span>   <!-- the machine writes the title in here; keep it readable -->
      <button data-os-minimize="">…its mark…</button>   <!-- three controls, each with its own
      <button data-os-maximize="">…its mark…</button>        visible mark, each >= 20x20 of hit
      <button data-os-close="">…its mark…</button>          area, none needing a hover -->
    </div>
    <div data-os-content=""></div>     <!-- leave EMPTY; the machine fills it -->
  </div>
</template>

<template data-os-task="">
  <div>                                <!-- exactly ONE root element; the machine writes
                                            data-os-active onto the focused window's entry -->
    <span data-os-icon=""></span>      <!-- optional, and bare: no id in this one -->
    <span data-os-title=""></span>
  </div>
</template>
```

---

## Also

- **The shell is exactly the screen, and nothing in it scrolls.** The screen is {{viewport}} and the document is that and no more:

```css
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}
```

  Everything you draw lives inside that rectangle. A bar, a dock or a menu bar is **wholly inside it** — a bar `100%` wide with its own horizontal padding, or a border, is wider than the screen and pushes a scrollbar onto it, so put the padding on the things inside the bar or add `box-sizing:border-box`; a dock positioned by its own height at the bottom edge has to clear the edge, not straddle it. No element is positioned past the right or bottom edge, nothing is sized in `vw` plus a margin, and no part of the shell — not the launcher area, not the bar, not a menu — has a scrollbar of its own. There is nothing below the fold on this screen, because there is no fold: what does not fit is not there at all.
- Every launcher is **on screen at {{viewport}} with no scrolling of any kind**, in the grid described above: at most eight to a row, at most five to a column, and never one line of {{app_count}}. Under 768 pixels wide, fewer columns and bigger targets — three or four to a row, the bar still present; the machine opens windows full-size and disables dragging on its own.
- Do not draw any window, any fake open app, or any taskbar entry yourself — the templates are how those get made. An empty desk with a full drawer is correct.
- Budget 3,500 tokens, and it is generous: one `[data-os-app]` rule dresses every launcher and one `[data-os-icon]` rule shapes every icon, which buys you most of it back. A desktop that finishes well under 2,000 tokens is an empty desk — spend what the shared rules saved on the things people read: the labels, the menu contents, the status readouts, the duty names, the notice in small type.

---

## Last pass before you answer

Read back what you wrote and find each of these in it. If one is missing, add it now.

```
[ ] <body data-os-archetype="…">      the word from the identity: taskbar or dock
[ ] an element carrying  data-os-desktop=""
[ ] an element carrying  data-os-windows=""   (empty)
[ ] an element carrying  data-os-taskbar=""   (no entries drawn in it)
[ ] an element carrying  data-os-clock=""     (ticking, with the date)
[ ] inside it, TWO elements — one the time, one the date — and a visible gap between them,
    so the last digit of the time and the first character of the date never touch
[ ] an element carrying  data-os-img="wallpaper"   (empty)
[ ] <template data-os-window="">  with  data-os-title  data-os-content  data-os-close  data-os-drag  inside it
[ ] <template data-os-task="">    with  data-os-title  inside it
[ ] a launcher element for every one of these {{app_count}}: {{app_launchers}}
[ ] a data-os-icon="<id>" element inside every one of those launchers, each holding one glyph
[ ] that glyph sized ~2/3 of the icon box, centred, in your own colour, with a shadow or outline
[ ] those launchers in a grid — at most 8 across, at most 5 down, none of them off screen
[ ] a dock, if you built one, holding at most 8 of them in a single row, the rest on the desk
[ ] every label this machine's own word for the app, never the plain word the shape uses
[ ] every launcher label on a plate of its own, so it reads over any wallpaper
[ ] every launcher label outside the 48x48 icon box, in the launcher, visible with nothing hovered
[ ] no rule and no script that changes a label when its icon gains a background or an attribute
[ ] the bar's parts pushed apart, and a gap or padding between every two runs of text in it
[ ] the window template's title bar >= 28px tall, contrasting with the body AND the wallpaper
[ ] its title one readable line that ellipsises, never wrapping under the controls
[ ] its three controls each carrying a visible mark, each >= 20x20, no hover needed to see them
[ ] a border, outline or shadow around the window root, so it has an edge over any wallpaper
[ ] a rule for [data-os-focused="true"] and a different one for [data-os-focused="false"],
    the two title bars differing in background colour
[ ] a rule for [data-os-active] on the task entry
[ ] html and body exactly {{viewport}}, overflow hidden, bars and docks wholly inside it, nothing scrolling
```

Each of those is an attribute *on a tag*. Finding the name in your stylesheet does not count; find it inside a `<` … `>`, with its quotes balanced.

---

## Last of all: the window template, because every window on this machine wears it

One template, cloned for every app anybody opens, for the rest of this machine's life. A person who cannot see the title bar cannot move the window; a person who cannot see the close control cannot put it away. So read the template you just wrote once more, against these five:

1. **The title bar is a visible strip across the top of the window, at least 28 px tall.** `min-height:28px` on the `[data-os-drag]` element, with padding inside it, sitting above `[data-os-content]`. It is a strip a person sees and grabs — not a wrapper that collapses to nothing, and not a job left to the app's own heading inside the content area, which is a different document and cannot move or close anything.
2. **The bar's background is clearly a different colour from the window body**, so the top of the window reads as chrome at a glance and the window keeps a hard top edge over any wallpaper.
3. **The title is readable in it**: `[data-os-title]`, which the machine fills, in a solid colour against the bar, one line, `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`.
4. **Three controls in that bar, each at least 20 px by 20 px, each carrying its own visible glyph or word** in a colour that stands out from the bar: `[data-os-minimize]`, `[data-os-maximize]`, `[data-os-close]`. Give each one a real box — a width and height, or padding around its mark — so it is a target rather than a bare text node, and so a control whose mark is missing still has a size. All three legible with nothing hovered, on the very first window that opens.
5. **The focused window's title bar background is a different colour from an unfocused window's title bar background** — `[data-os-focused="true"] [data-os-drag]` and `[data-os-focused="false"] [data-os-drag]`, both written, differing in `background`.

Every one of those is visible without hovering, in the document you return, in your own colours, in your own era.

Then answer with the document alone: `<!doctype html>` first, `</html>` last, no fence, no sentence before or after it.
