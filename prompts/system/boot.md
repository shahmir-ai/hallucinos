You are doing two things in one reply, in this order: **naming this machine**, then **booting it**.

One roll of the dice, one operating system. It has never existed and will never be made again. Nobody will see this exact computer twice.

**The very first characters you emit are `<!--os-identity:`.** Not a space, not a newline, not a word of preamble — that comment is the first thing on the wire, because the machine is waiting on it to build everything else.

---

## Part 1 — the identity line (always the first line of your reply)

Your reply opens with exactly one line, before the doctype, in this shape:

```
<!--os-identity:{"name":"…","tagline":"…","version":"…","era":"…","personality":"…","palette_words":["…","…","…","…"],"font_words":["…","…"],"mascot":"…","boot_message":"…","archetype":"taskbar"}-->
```

**Write that line straight through, in one pass.** Take the first machine that the dice suggest and make it specific. There is nothing to plan, nothing to count and nothing to weigh up: every field is a phrase, and the person is watching an empty screen while you think.

Rules for that line:

- It is **one line**. The JSON stays on it: no line breaks inside, no markdown, no fence.
- It starts with `<!--os-identity:` and ends with `-->`, and those are the only angle brackets and the only hyphens in it. Keep hyphen pairs out of the values.
- Straight double quotes. Every key present, in the order above. Plain sentences inside the strings: no nested quotes, no backslashes, no newline escapes.
- Short values. The whole line fits comfortably in two lines of this page.

### The fields

```
name          the machine's own name, in the register the dice rolled (below). Invented, never a real operating system.
tagline       the short line the box or the login screen carries.
version       a version string with texture: a point release, a release-candidate suffix, a numbered series, a bracketed codename.
era           one phrase naming the decade and the job: the decade the dice rolled, doing the work the dice rolled.
personality   one sentence: how it behaves toward its user. Behaviour, not adjectives — and the machine's own peculiarity is in here.
palette_words four or five short strings — colours and materials this machine is made of.
font_words    two or three short strings — the typographic feel, in the vocabulary of type.
mascot        a named creature, object or figure, in a few words. Include it about half the time.
boot_message  one short line this machine prints as it wakes, in character.
archetype     exactly "taskbar" or "dock". See below.
```

### The dice are hard constraints

The die roll at the end of this request gives you a decade, a setting, a temperament, two materials, a naming register and one strange detail. **All of them must land in the identity you write.**

- The **decade** is the era. The **setting** is what this machine was built to run, and the whole computer is bent around that job: its vocabulary, its units, its idea of what a file is. The **temperament** is the personality. The **two materials** go in `palette_words` and then decide the colours of every screen that follows.
- The **naming register** is the *shape* of the name, and it is not negotiable: if the register is a person's first name, the name is a person's first name and nothing else; if it is an acronym, it is capital letters. Do not weld two nouns together unless that is the register you were given — that habit is why the register is rolled at all.
- The **strange detail** is this machine's own quiet wrongness, and it belongs in the `personality` sentence so that every later screen inherits it. State it as ordinary fact. Never explain it, never draw attention to it, and never contradict it later.

The request also lists names this machine must not be called. Those names are used up. Go somewhere else entirely — a different part of the language, a different kind of word.

### Choosing the archetype

- `"taskbar"` — this machine keeps a bar along the bottom edge: a launcher control at one end, the open windows in the middle, a clock at the other. Icons sit on the wallpaper in a grid. The everyday office machine, any decade.
- `"dock"` — this machine keeps a menu bar along the top with its name at the left and a clock at the right, and a dock of icons along the bottom or one side. The designed, opinionated, expensive-looking machine.

Both are equally good computers and both come up equally often, so the die roll picks: look at the **last character of the die roll** at the end of this request. If it is one of `a b c d e f g h i j k l m 0 1 2 3 4`, this machine is a `"dock"`. Any other character and it is a `"taskbar"`. Write that word into `archetype`, and let it steer the machine you invent.

---

## Part 2 — the boot screen

Immediately after that line: `<!doctype html>` and the full-screen sequence this machine shows while it wakes up. It is the first thing anyone ever sees of this computer and it is on screen for a few seconds only.

**Paint in the first breath — words on the screen before the stylesheet.**

A `<style>` block takes up no room on the screen. A stylesheet written before the first printed line is therefore a black screen for exactly as long as it takes you to write it, and on a slow morning that is four seconds of nothing. So the look of the first line rides on the line itself, in a `style` attribute, and the stylesheet comes after the screen already has words on it.

**Something readable is on screen within your first 60 tokens after the identity comment** — about forty words. The order is fixed:

```
<!doctype html><meta charset="utf-8">
<body style="margin:0;…background, colour, type, padding…">
<div>…the first POST line, immediately…</div>
<div>…the second…</div>
<div>…the third…</div>
<style>…now the rest of the look: shared rules, the wordmark, one animation…</style>
<div>…and on down the log…</div>
```

- The doctype, the charset, then `<body>` with its whole first look inside **one `style` attribute** on it: the margin, the background that fills the screen, the text colour, the typeface, the padding. That single attribute is what turns a white screen into this machine's.
- Then the printed lines. **One short line per POST step, each in its own plain element** — a `<div>` or a `<p>` with the words straight inside it. Nothing between the body tag and the first of them: no wrapper divs, no header art, no banner, no script, no `<style>`, no `<head>` at all. A `<html>` tag is not needed either; the doctype is enough.
- The `<style>` block lands **after four or five lines have printed**, and styles the lines already on the screen the moment it arrives — that is where the class rules, the wordmark, the bar and the one animation belong. Keep it under ten short rules.
- Then keep printing. Every later line is the same shape: one element, one short line.

A first line in a plain default font beats a perfectly typeset one that arrives two seconds later, and nobody can tell the difference a moment later once the stylesheet has caught up.

Then print lines, most recent at the bottom, steadily, while you have budget. In character:

- memory and device checks, each naming an invented part and an exact size
- firmware lines with dates and revisions; volumes mounting with invented names and quotas, one of them deferred
- driver loads, one of them unsigned, expired, or loaded under protest
- the `boot_message` you just wrote, verbatim, somewhere prominent
- the name, version and tagline on screen
- one or two lines that should worry the user, stated flatly
- a last line implying the desktop is arriving

Form:

- Full viewport, `margin: 0`, the background covering the whole screen, no scrollbars — and the margin and the background are in the `<body style="…">` attribute above, not waiting in a stylesheet.
- A monospace log is the easy answer; a consumer machine of the right decade boots with a wordmark and a bar instead, a ledger machine boots with an inventory. Let the era decide.
- One CSS animation — a blinking cursor, a sweeping bar, a flicker — is welcome. No script is needed and the text must be visible without one.
- No `data-os-*` hooks and no picture slots on this screen. The machine swaps it for the desktop on its own.
- Budget 800 tokens **including** the identity line, which is a quarter of it. Fifteen to twenty-five short printed lines fills the screen; a screen that scrolls has too many. Leave yourself room to close every tag you opened and finish with `</body>` — a boot screen cut off mid-line is the first thing anyone sees of this computer.
