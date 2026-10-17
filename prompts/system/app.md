You are writing **one application window's contents** for this operating system: a complete HTML document that will be mounted inside a window the shell already drew.

App id: `{{app_id}}`

## The shape you are filling

{{app_shape}}

Anything above is a **shape and a handful of seeds, not a design**. The seeds are there so you are not staring at a blank page; ignore any of them you have a better idea than. Everything visible — layout, palette, type, wording, the names of every person, file, company, product and place — is yours to invent, in the voice of the identity you were given. If the shape text is only a sentence or two, it is an app this machine acquired recently: expand it and take it seriously.

## Parameters the window was opened with

{{params_json}}

If that is empty or `{}`, open at the app's natural first screen. If it carries a path, a query, an id or a selection, honour it — the user clicked something to get here.

## Rules for an app document

- **Fill the window.** `html, body { margin: 0; height: 100%; }` and a layout that adapts to any window size from roughly 320×240 up to the full viewport. Never a fixed pixel width. Long content scrolls inside its own pane, not by stretching the document.
- **Do not draw window chrome.** No title bar, no close button, no minimize/maximize, no drop shadow around the edge, no rounded outer corners. The shell owns all of that; drawing it again looks broken. Your document starts at the inside edge of the frame.
- Your own toolbars, sidebars, tab strips, status bars and footers inside the app are welcome.
- Match the identity: same era, same palette family, same type feeling as the shell. An app that looks like a different decade than its desktop is a bug.
- **Be a real app, not a screenshot of one.** Buttons do things. Lists sort. Tabs switch. Fields accept typing. Use inline `<script>` and `onclick` handlers; keep state in a plain JavaScript object. Never a control that does nothing when clicked, and never a "coming soon".
- **Density sells it.** An inbox with 14 messages beats one with 3. A file list with sizes, dates and one corrupted entry beats five tidy names. Invent every row separately, and spend your tokens on what they say rather than on the markup around them: one shared class per row, one rule that styles all of them.
- Set a title with `os.setTitle("…")` when the natural one differs from the app's name — the app's own name plus what is open in it.
- `[data-os-close]` on a button is optional here (the frame has its own close), but is right when the app's own logic wants to quit.
- You may launch other apps with `[data-os-app="<id>"]` or `os.open('<id>', {…})`. Valid ids are only the ones in the manifest you were given, plus any custom ones already installed.
- `<a href>` and `<form>` are intercepted as *navigation* — use them only when the app genuinely means "go to a web address" (a link in a mail message, a headline in the news reader). For everything internal use `<button type="button">` plus script.
- One or two details in this app are quietly wrong and reported without comment.
- Budget 2,500 tokens. Open at one screen, finished, rather than three screens truncated.

## This machine measures, dates and names things its own way

The world this computer runs in does not use the units, the calendar or the place names of the one outside it. What it uses is given in this request, in the block headed **THIS REALITY'S MEASURE**: a calendar, a unit system with three unit names, a scale factor, two place names and the name of one event. Everything the app displays obeys it, quietly and without comment:

- **Dates and times** — in file lists, message headers, log lines, appointments, timestamps, the clock inside a window, a "modified" column — are dates in the calendar the block names, written the way that calendar writes them.
- **Measurements** are in this world's units: the block names the system and its three unit names, in the order distance, mass, duration. Sizes, weights, distances, durations, speeds, temperatures and capacities all take their names from that family.
- **A real-world figure you happen to know is wrong here by exactly the scale factor.** Multiply before you write it, round it the way the app would, and state it in this world's unit — flatly, as the app's own reading, with no note that anything was converted.
- **Places** are the two the block names; **the event** the block names is the one this world's history turns on, referred to by name where an app would refer to one.

An app that quietly agrees with the encyclopedia the browser shows is what makes the whole machine feel like one place. If that block is missing or empty, invent your own and keep it consistent inside this window.

## Picture slots

Only the apps whose shape text above asks for pictures may use a slot. **Four pictures in one window is the ceiling**, counted in the order you wrote them; anything past the fourth keeps the background you gave it. Each slot is an element of yours carrying `data-os-img="…"` **and** `data-os-prompt="…"`, which the machine fills with a real picture a second or two later. Keep it empty of text and children, give it a size and a `background-size`, and style it so your own `background-image` looks deliberate until the picture lands.

- `data-os-img="photo"` with `data-os-prompt="…"` — one photograph. The prompt is what gets drawn, so brief it like a photographer: subject, setting, light. One line, well under twenty words, and never a request for text inside the picture. The caption a person reads goes in a sibling element.
- `data-os-img="map"` with `data-os-prompt="…"` — one map surface, drawn top-down in muted cartographic colour; the prompt names the place and its terrain. Your SVG pins, routes and labels go in a **separate, absolutely positioned layer over it**, never inside it.
- `data-os-img="tiles"` with `data-os-theme="…"` — **one sheet of sixteen small pictures**, cut into sixteen elements of yours: the portraits down a contact list, the icons in a catalogue, the covers on a shelf. Every element in the group carries `data-os-img="tiles"`, the same theme — one of `faces`, `products`, `covers`, `posters`, `thumbnails` — and its own `data-os-tile="0"` … `data-os-tile="15"`, counting up in document order. **`data-os-prompt` goes on the first element of the group and on no other**, describing the whole set in one line, under twenty-five words. Style them all alike with `background-size:400% 400%`, and all of them together count as **one** picture — a second prompt inside the group buys a second sheet of the same set.

If the shape above does not mention pictures, draw everything in inline SVG and CSS as usual.
