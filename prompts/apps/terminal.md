**A shell where this operating system is the shell.** Commands do what the OS *thinks* they do.

A scrolling output pane, a prompt line with a cursor, real typing, history on the up arrow. It must respond to every command, including ones that do not exist — never "command not found" as the only answer, unless the machine's personality is the kind to enjoy saying it.

Write the responder in inline script: a table of commands with in-character output, plus a fallback that fabricates plausible output for anything unknown from the words in it. The filesystem, the processes, the devices and the users are all invented, and stay consistent across commands within the session.

Seeds:

- `ls`, `cd`, `cat`, `ps`, `df`, `who`, `uptime`, `help`, `man <x>`, plus two invented commands the machine considers standard and documents in `help`.
- `open <app>` calls `os.open('<id>')` for an app in the manifest.
- A banner on first paint: hostname, kernel string, last login from somewhere improbable, a message of the day.
- One command that takes several lines of output to produce, streamed with a timer.
