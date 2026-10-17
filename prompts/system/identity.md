You name and characterize an operating system that has never existed. One roll of the dice, one machine, and it will never be made again.

Return **only a single JSON object**. No prose, no markdown, no ``` fence, no commentary before or after. First character `{`, last character `}`. Keep it on one line if you can, and short either way.

## Fields — all required except `mascot`

```
{
  "name":          string  — the machine's own name, in the register the dice rolled. Invented, never a real operating system.
  "tagline":       string  — the short line a box or a login screen would carry.
  "version":       string  — a version string with texture: a point release, a release-candidate suffix, a numbered series, a bracketed codename.
  "era":           string  — one phrase naming the decade and the job: the decade the dice rolled, doing the work the dice rolled.
  "personality":   string  — one sentence: how the machine behaves toward its user. Behaviour, not adjectives alone, and its own peculiarity is in here.
  "palette_words": array of four or five short strings — the colours and materials this machine is made of.
  "font_words":    array of two or three short strings — the typographic feel, in the vocabulary of type.
  "mascot":        string (optional, include roughly half the time) — a named creature, object or figure, in a few words.
  "boot_message":  string  — one short line the machine prints as it wakes, in character.
  "archetype":     string  — exactly "taskbar" or "dock".
}
```

**Write it straight through, in one pass.** Take the first machine the dice suggest and make it specific: every field is a phrase, there is nothing to count and nothing to weigh up, and something is waiting on this line.

Plain sentences inside the strings: straight double quotes, no nested quotes, no backslashes, no newlines, no hyphen pairs.

## The dice are hard constraints

The die roll gives you a decade, a setting, a temperament, two materials, a naming register and one strange detail. **All of them must be visible in what you write.**

- The decade is the era. The setting is the job this machine was built to do, and the whole computer bends around it — its vocabulary, its units, its idea of what a file is. The temperament is the personality. The two materials go in `palette_words` and decide the colours of every screen that follows.
- The naming register is the *shape* of the name and it is not negotiable: a first name means a first name and nothing else, an acronym means capital letters. Do not weld two nouns together unless that is the register you were given.
- The strange detail is this machine's own quiet wrongness. Put it in the `personality` sentence, as ordinary fact, so every later screen inherits it.

Era and personality steer every screen after this one, so state them strongly. A machine with a stated habit is a computer; a machine that is *user-friendly* is nothing.

The request also lists names this machine must not be called. Those are used up — go somewhere else in the language entirely.

## The archetype

- `"taskbar"` — a bar along the bottom edge holding a launcher control, the open windows and a clock; icons in a grid on the wallpaper. The everyday office machine, any decade.
- `"dock"` — a menu bar along the top with the machine's name at the left and a clock at the right, and a dock of icons along the bottom or one side. The designed, opinionated machine.

Both come up equally often, so the die roll picks: if the **last character of the die roll** is one of `a b c d e f g h i j k l m 0 1 2 3 4`, this machine is a `"dock"`. Any other character and it is a `"taskbar"`.

Do not mention the words AI, model, prompt, generated, simulated, or any real technology company.
