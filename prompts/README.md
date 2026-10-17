# prompts/ — the prompt library

Everything the model is ever told lives here. No prompt text belongs in the server or the kernel; if a wording change is needed, it is a change to a file in this folder.

Current against **SPEC §12** (the v0.1 amendments) and the pinned v0.1 interfaces I1–I8.

## How a request is assembled

```
system message = prompts/system/voice.md + "\n\n" + prompts/system/{kind}.md     (both rendered)
user message   = prompts/user/{kind}.md  (rendered)  or the single line "Begin." if that file is absent
                 + prompts/user/page-videos.md       when data/videos.json is non-empty (kind=page)
                 + prompts/user/identity-lineage.md  when this is a reboot (kind=identity)
```

- `kind` ∈ `identity | boot | desktop | app | page | repair`.
- `voice.md` is prepended for **every HTML kind** (`boot`, `desktop`, `app`, `page`, `repair`). It is **not** prepended for `identity`, which returns JSON and whose system file is self-sufficient.
- For `kind=app`, `prompts/apps/{app_id}.md` is read and injected as the `app_shape` variable. For a custom app installed at runtime (`custom:<slug>`), there is no file: pass the `shape` string from the install spec as `app_shape` instead.
- `prompts/images/{wallpaper,icons,map,tiles}.md` are not part of that assembly at all. They are the **image** prompts, and the server builds them itself (seam S3): it renders the one fenced block in each file, `{{variable}}` substitution only, and sends the rendered line to the image model. Everything outside the fenced block is commentary and is never sent. `tiles.md` is the one with two authors — the server's geometry and theme clause plus the document's own `data-os-prompt` as `{{set}}` (T2).

## Where the identity comes from (SPEC §12.1, interface I1)

`kind=boot` now produces **both** the identity and the boot screen, in one stream. Its first line is

```
<!--os-identity:{"name":…,"tagline":…,"version":…,"era":…,"personality":…,"palette_words":[…],"font_words":[…],"mascot":…,"boot_message":…,"archetype":"taskbar"|"dock"}-->
```

and `<!doctype html>` follows on the next line. `prompts/system/boot.md` owns that contract: the field list, the one-line JSON rules, the dice constraints and the archetype choice.

`kind=identity` still exists and still returns the same object as bare JSON (no comment wrapper) — it is what the server calls when the boot stream's own comment fails to parse, and what the reboot path uses. `system/identity.md` and `system/boot.md` therefore carry the **same field list, including `archetype`**, and must be changed together.

## Rendering

Plain text with `{{variable}}` placeholders. No logic, no conditionals, no loops, no filters. An unknown or empty variable renders as the empty string, so every file is written to read correctly when a variable is blank.

## Variables

| variable | type | where it is used | notes |
|---|---|---|---|
| `dice_json` | JSON string | user/boot, user/identity | SPEC §12.4 + seam S2. `{era_decade, setting, temperament, material_a, material_b, naming_register, strange_detail, wallpaper_motif}`, one value drawn by the server from each list in `data/dice.json`. Hard constraints: the first seven must be visible in the identity — `naming_register` decides the *shape* of the name and `strange_detail` goes in the `personality` sentence. `wallpaper_motif` is rolled for the **server's** wallpaper prompt and the model is not asked to do anything with it |
| `never_names` | string | user/boot, user/identity | **new (SPEC §12.4)**. Comma-separated, the last 200 OS names the server has seen. The prompt tells the model those names are used up |
| `archetype` | `"taskbar"` / `"dock"` | user/desktop | **new (SPEC §12.3)**. The value the model already chose in the identity, handed back literally so the desktop does not have to re-read it out of the JSON. The system prompt also points at the identity's own `archetype` field, so a blank render degrades rather than breaks — but the validator compares the desktop's `data-os-archetype` against the identity, so pass it |
| `identity_json` | JSON string | user/desktop, user/app, user/repair | the parsed identity object. **Never passed to `page`.** Not passed to `boot` any more — boot writes it |
| `manifest_json` | JSON string | system/desktop, user/app, user/repair | the app list, including any custom apps installed this session; the desktop prompt requires a launcher for every id in it |
| `app_launchers` | string | system/desktop, user/desktop | every launcher attribute spelled out literally — `data-os-app="browser" data-os-app="photos" …` — derived from the manifest. Cheap models copy a list far more reliably than they re-derive one from JSON; this is what took `openai-small` from 2/10 to 10/10 on SPEC §10.3's gate |
| `app_count` | string | system/desktop, user/desktop | how many launchers that is, so the prompt can say "count them" without hard-coding sixteen |
| `seed` | string | user/identity, user/boot, user/desktop, user/app, user/page | the session's die roll; used to push the model off its first idea |
| `app_id` | string | system/app, user/app, user/repair | e.g. `notes`, `custom:dowsing-kit` |
| `app_shape` | string | system/app | contents of `prompts/apps/{app_id}.md`, or the install spec's `shape` for a custom app |
| `params_json` | JSON string | system/app, user/app, user/repair | params the window was opened with; `{}` when none |
| `url` | string | user/page, user/repair | the full address being loaded |
| `domain` `path` `query` | string | user/page | parsed from `url` |
| `referer_url` `referer_title` | string | user/page | the previous URL in this browser window and its `<title>` |
| `history` | string | user/page | the last three URLs, newline separated |
| `rerouted` | `"true"` / `"false"` | user/page | set when moderation fired; triggers the silent wholesome-site rule in system/page.md |
| `missing_hooks` | string | system/repair, user/repair | comma-separated selectors the validator could not find |
| `videos_json` | JSON string | user/page-videos.md | contents of `data/videos.json`; the fragment is appended **only when the list has entries** (SPEC §5) |
| `lineage_name` `lineage_version` `lineage_next_version` | string | user/identity-lineage.md | only on a reboot; the fragment is appended only when `lineage_name` is set |
| `viewport` | string | voice.md, user/boot, user/desktop, user/app, user/page | e.g. `1440x900` |
| `kind` | string | voice.md, system/repair, user/repair | the kind being generated |

All of them are safe to pass to every kind; each file only reads the ones it needs. The one rule that must be enforced in code: **`identity_json` is never rendered into a `page` request** (SPEC §3.1) — `user/page.md` does not reference it, and it must not be added.

## `data/dice.json`

Written by this library, read by the server (interface I2, `server/dice.ts`). Eight lists whose keys are the singular roll keys, all short common-noun strings, no names of any kind:

| key | count today | minimum | what it decides |
|---|---|---|---|
| `era_decade` | 12 | 12 | the era, and the decade in both image prompts |
| `setting` | 72 | 60 | the job the whole machine is bent around |
| `temperament` | 38 | 30 | the personality |
| `material_a` | 44 | 40 | `palette_words`, and every colour after it |
| `material_b` | 44 | 40 | the same, and never equal to `material_a` |
| `naming_register` | 22 | 12 | the **shape** of the machine's name (seam S2) |
| `strange_detail` | 74 | 60 | the session's one quietly-wrong idea (seam S2) |
| `wallpaper_motif` | 52 | 40 | the wallpaper's subject, in the **server's** prompt (seam S2/S3) |

The server draws one value from each per boot and renders the whole roll as `dice_json`. Adding entries is a data change and needs no prompt edit. `_notes` in the file states the same contract.

Why the last three exist, in one line each (BAKEOFF-2): seven of nine names were two nouns welded together because nothing rolled the register; the three worked examples of the "quietly wrong detail" that used to sit in `voice.md` came back almost verbatim on every engine and every boot; and the wallpaper was a photographed animal or a hero object because its subject came from the mascot.

## Picture slots (SPEC §12.5, interface I3)

The prompts promise three attribute shapes, and the kernel fills them by setting `background-image` on the element:

| hook | kind of picture | where | how many |
|---|---|---|---|
| `data-os-img="wallpaper"` | wallpaper, 1024×576; **prompt built by the server** from the dice and the palette (`prompts/images/wallpaper.md`) | desktop | 1 |
| `data-os-icon="<appId>"` | one cell of the 4×4 icon sheet, 768×768, cell index = manifest order; **prompt built by the server** (`prompts/images/icons.md`) — sixteen identical blank plates, and the model's glyph stays visible in front of its plate | desktop, inside each launcher | one per app |
| `data-os-img="photo"` + `data-os-prompt="…"` | a photograph, 640×640; **`data-os-prompt` is the image prompt** | apps whose shape asks for pictures, and pages | ≤ 4 per app document, ≤ 2 per page document, first in document order |
| `data-os-img="tiles"` + `data-os-theme="faces\|posters\|products\|thumbnails\|covers"` + `data-os-tile="0…15"` + `data-os-prompt` **on the group's first element only** | one cell of a 4×4 tile sheet, 768×768, cell index = the element's own `data-os-tile`; **prompt built by the server from the theme + that one `data-os-prompt` + the palette** (`prompts/images/tiles.md`) | catalogue / feed / shop / social pages, the store's listings, mail and messages | one sheet per document, up to 16 elements, counting as **one** picture |
| `data-os-img="faces"` + `data-os-face="0…15"` | the older spelling of a `faces`-themed tile sheet, kept as an alias | anywhere the tile sheet is | as above |
| `data-os-img="map"` + `data-os-prompt="…"` | a top-down street plan, 768×576; **prompt built by the server** (`prompts/images/map.md`); the attribute is only the collection marker and its text is discarded | maps app, location pages | 1 |

Rules the prompts state to the model, and which the kernel must not contradict:

- A slot element is **empty**: no text, no children. Anything inside would sit on top of the picture.
- The model styles the slot with its **own `background-image`** (a gradient, or a `data:` SVG) so it looks deliberate before the picture arrives; the kernel's `background-image` replaces it. Labels and captions live in a sibling element.
- Sheet slots (`data-os-icon`, `data-os-img="tiles"`) are styled `background-size:400% 400%` by the model, and the kernel sets `background-position` per cell. For a tile sheet the cell is the element's own `data-os-tile` index (0–15), which the model writes counting up in document order; for `data-os-icon` it is the app's position in the manifest.
- **`data-os-prompt` is the model's one input to a picture** (seam S1). `photo` carries it, and a tile group carries exactly one — on its first element, describing the whole set of sixteen, because a second one inside the group buys a second sheet of the same set. The shell's own slots never carry it. The kernel forwards it as written, clamped at 700 characters and moderated, so the prompts ask for one line well under twenty words, briefed like a photographer, and never a request for text inside a picture.
- **A launcher's `data-os-icon` is the one slot that is not empty**: it holds a single glyph or emoji of the model's choosing, which is what tells a person which app it is — while the sheet is in flight, on a machine with no `FAL_KEY`, and permanently. Every other slot stays empty of text and children. Per the ICON RULING the kernel applies the cell as a background **behind** that glyph and never hides or covers it, and it changes nothing else inside the launcher: the label stays visible before the sheet lands and after it.
- `template[data-os-task]`'s optional icon slot is the one `data-os-icon` written **bare** (`data-os-icon=""`, no app id). It is a glyph slot, not a picture slot.
- Without `FAL_KEY` the route 404s and nothing is filled; every screen must still look finished, which is what the "own background first" rule buys.

## Hooks the runtime must provide

The prompts promise these to the model, so the kernel has to honour them:

- Intercepted markup: `<a href>`, `<form action>` + named fields, `[data-os-app="<id>"]`, `[data-os-close]`, `[data-os-nav="back|forward|reload|home"]`, `[data-os-url]` (kernel writes the current URL in; Enter navigates).
- Desktop structure: `[data-os-desktop]`, `[data-os-windows]`, `[data-os-taskbar]`, `template[data-os-window]`, `template[data-os-task]`, plus **new in v0.1**: `[data-os-archetype="taskbar|dock"]` on `<body>` and `[data-os-clock]` on the clock element (interface I5). The model writes its own ticking script for the clock.
- In the `taskbar` archetype the prompt tells the model to give its start control `order:-1` and its clock `order:99` inside `[data-os-taskbar]`, because the kernel appends window entries as plain children and they have to land between the two. In the `dock` archetype `[data-os-desktop]` is the launcher end of the dock and `[data-os-taskbar]` is the running end past the divider.
- `window.os`: `open`, `close`, `navigate`, `reload`, `back`, `forward`, `home`, `setTitle`, `install`, `state`.
- `os.install({ id: 'custom:<slug>', name, shape })` adds the app to the session manifest **and a launcher appears on the desktop**. The kernel appends the launcher into `[data-os-desktop]`; the desktop prompt asks the model to style launchers by the `[data-os-app]` attribute so an appended one inherits the look.
- **Reboot:** the updater's confirm button carries `data-os-reboot` *and* calls `os.reboot()` behind a feature check.

## Adding an app

1. Add the id to `manifest.json` with its one-line shape.
2. Write `prompts/apps/<id>.md`: the shape in a sentence or two, any **required hooks** the kernel needs in that app, then two or three *seeds*. Never a design — no colours, no layout, no copy to reproduce. If the app should get real pictures, name the slot explicitly; `system/app.md` gives a slot only to apps whose shape text asks for one.
3. Nothing else changes. `system/app.md` renders the new file as `app_shape`, and the desktop prompt will demand a launcher for the new id because it reads `manifest_json`.

House style for an app file: bold one-line shape; required hooks with exactly what the kernel does with each; a short paragraph on what makes the app land; a `Seeds:` list of two or three concrete possibilities the model is free to discard.

## Token budgets (SPEC §12.1, interface I7)

boot 800 (**including** the identity line, and including the engine's reasoning tokens — see Known frictions) · desktop 3,500 · app 2,500 · page 2,500 · repair 3,500. They are restated to the model in `voice.md` §12 together with the compactness rules that make them survivable: shared classes, short class names, no HTML comments, cheap SVG, and detail spent on words rather than on markup. Temperature 1.0–1.2, and ≥ 1.2 for the identity where the engine allows (SPEC §12.4).

## Known frictions (measured — `reviews/PROMPTS-1.md`)

- **`boot`'s 800-token cap is shared with reasoning tokens.** On `gpt-oss-120b` at
  `reasoning_effort: "low"` the model spends 180–250 of them thinking; on
  `gpt-oss-20b` it spends more and never closes the document. The identity line
  plus a full boot screen fits in ~550. The first draft of this rewrite kept the
  old identity prompt's word counts (`3-9 words`, `12-30 words`) and the model
  burned **797 of 800 tokens counting words in its reasoning** and returned an
  empty document on two boots in three. Every count is now a phrase. If a boot
  still truncates, the lever is the per-kind `max_tokens` for the reasoning
  engines (≈ 1,100), not more wording.
- **`voice.md` is prepended to `boot` too**, and its picture-slot section and its
  whole interactivity/`window.os` contract are dead weight on a screen with no
  hooks and no scripts — about two thirds of a 4,300-token boot prompt. Skipping
  `voice.md` for `kind=boot` and letting `system/boot.md` carry the four rules it
  needs (one document, no network, never break character, size) is the obvious
  saving; it is a code change and has not been made.
- **A free choice is not a sample.** Asked to pick the archetype "whichever fits",
  the model picked `taskbar` five times out of five. It is now derived from the die
  roll's last character, which is 50/50 over the kernel's `[a-z0-9]` seed alphabet.

## House rules learned the hard way

- **Positive form only.** No WRONG/RIGHT tables, no counter-examples: a small model copies the thing you showed it. SMOKE-1 §"What broke" #3 is a whole regression caused by one negative example.
- **Examples are attractors, and the rule is now absolute.** There is no concrete content example anywhere in this library: no example names, no example strange details, no example listings, no example domains, no example credits. BAKEOFF-2 proved it twice over — `voice.md`'s three worked oddities came back nearly verbatim on every engine and every boot, and one app name inside `store.md`'s `os.install` snippet was sold in 10 of 10 stores. What is left is the rule, the shape, and a die roll where the content used to be. Format examples stay (the identity line, a hook's spelling, a CSS declaration, a call signature with `<placeholders>`); content examples do not.
- **Spell lists out literally.** `{{app_launchers}}` beats "one per app in the manifest" by six points out of ten.
- **Write hooks as `name=""`.** The valueless and valued forms disagreeing is what produced `<div data-os-taskbar">`.
- **A placeholder that renders empty is a silent prompt weakening.** `test/launchers.test.ts` exists because `{{app_launchers}}` rendered blank for three sweeps.

## Deviations

These are the prompt-library deviations from SPEC. They are repeated, with everything else, in the product README's "Deviations" section — that list is the complete one.

- **`prompts/user/*.md` exist for all six kinds** (SPEC §5 lists only `system/` files). Reason: the per-request payload belongs in the user turn so the system message stays constant per kind, which keeps the delimited untrusted-input block clearly separated from the rules.
- **Reboot hook invented as `data-os-reboot` + `os.reboot()`** (SPEC §4 requires the updater to reboot into version+1; SPEC §2.2's runtime list has no reboot call). Reason: something had to be named for the updater to call.
- **`os.install` spec field is `{id, name, shape}`** (SPEC §2.2 says `{id, shape, affordances}`; `affordances` is still accepted and still optional). Reason: a display name is needed for the launcher and the taskbar entry.
- **`voice.md` states the token budget table to the model.** Reason: engines truncate mid-document otherwise; telling them the budget makes them finish and close the document.
- **A forbidden-vocabulary list is spelled out in `voice.md`.** Reason: cheap fast engines break character with "generated"/"simulated" unless the exact strings are banned.
- **The model describes a picture in `data-os-prompt`, not in the slot's own value** (SPEC §12.5 names the slots but not how the model says what the picture is; v0.1 used `data-os-photo="<description>"`). Reason: seam S1 gave all three model-described slots one spelling — `data-os-img="photo|faces|map"` plus `data-os-prompt` — so the runtime collects them with one selector, and `map` and `faces` gained a description they did not have.
- **The wallpaper and icon prompts live in `prompts/images/*.md` and are built by the server** (SPEC §12.5 leaves the wording to the implementation; v0.1 built them in `kernel/img.ts`). Reason: seam S3 — the two prompts the model does not write are prompt-library text like everything else, they need the dice the server already rolled, and the kernel should not be able to change what a picture costs.
- **A launcher's `data-os-icon` holds one glyph** (SPEC §12.5 has the slot but not its empty state). Reason: the first seconds of every boot, and every keyless deploy, show the sheet unfilled, and a row of empty plates is unreadable.
- **The desktop prompt states hard launcher-grid numbers** — a grid never a line, at most 8 to a row, at most 5 to a column, and a dock of at most 8 with the remainder as desktop icons (SPEC §12.3 says "icons in a grid" and no more). Reason: BAKEOFF-2 measured three of ten desktops laying all sixteen in one line and 5, 1 and 16 launchers clipped off screen; "a grid" alone did not land.
- **A tile sheet's attributes go on every tile element rather than on one sheet element** (SPEC §12.5 says "one faces sheet per page, sliced"). Reason: CSS cannot share one element's background across its siblings; giving every tile the attribute and letting the kernel hand out cells by the element's own index is the only way to slice one sheet across a list, and it is exactly how the icon sheet already works. The **description** is the exception and sits on the first element alone — the sheet is one picture, so it takes one prompt, and a prompt on the second tile is a second sheet bought for the same grid.
- **The five tile themes are a closed list of words the prompts spell out** (`faces`, `posters`, `products`, `thumbnails`, `covers`; SPEC §12.5 names only a faces sheet). Reason: T2 — the small pictures a catalogue, a feed, a shop, a thread and a shelf are made of are the same mechanism as the avatars, and the theme is what lets the server write the subject clause instead of asking the model to write sixteen of them.
- **`prompts/system/desktop.md` states a minimum title bar height, a minimum control size and a required focused/unfocused background difference** (SPEC §12.3 says only "a title bar carrying minimize, maximize and close"). Reason: the architect's live test found a window whose `[data-os-close]` existed, passed the validator, and was invisible and zero-sized — a window a visitor cannot close or move. Those numbers are the usability floor, not a look, and the window requirements are restated as the last section of both the system file and the user turn because a small model obeys the end of the prompt.
- **The desktop prompt requires every launcher label to stay visible at all times, outside a fixed 48×48 icon box** (SPEC §12.3 says "label under icon"). Reason: the same live test saw labels visible before the plate sheet landed and gone after it — a launcher grid of sixteen unlabelled plates.
- **The desktop prompt requires the bar to lay its children out with space between them** (SPEC §12.3 describes the bar's parts and their ends, not their spacing). Reason: the same test printed the clock hard against the OS name, which reads as one word.
- **`prompts/system/desktop.md` requires the launchers to be reachable without the page scrolling** — a legibility requirement (SPEC §2.2 and `voice.md` §10 already ask for no page scrolling), added because a real boot put all sixteen in one column and the last three ran off the bottom of the screen.
