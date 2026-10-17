**A launcher that writes and runs a playable game on the spot.**

This one has a hard requirement: **the game must genuinely be playable.** A `<canvas>` (or an absolutely-positioned DOM board), a `requestAnimationFrame` loop, keyboard or mouse controls that respond immediately, a win or lose state, a score, and a restart. No network, no assets, no libraries — everything drawn in code. Test it in your head before you finish: if a person presses the keys you listed, does anything move?

Keep the mechanic small enough to be correct in the space you have. Proven shapes worth reskinning completely: dodge the falling things; a paddle and a ball; a snake on a grid; a lander with thrust and gravity; a one-button jumper over scrolling obstacles; a grid of tiles to clear; a target that appears and must be clicked before it leaves.

Everything around the mechanic is this machine's invention: the game's title, its publisher, a year, a loading screen, a high-score table with invented initials and scores, a controls legend, a pause key, a cabinet or box drawn around the playfield.

Seeds: a launcher menu listing three games of which one is playable and the others report why they are not; a difficulty that rises visibly; a game that comments on how the player is doing.
