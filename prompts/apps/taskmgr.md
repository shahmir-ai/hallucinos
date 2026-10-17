**A task manager of invented processes and resource graphs.**

A sortable table: process name, owner, PID, state, CPU percent, memory in MB, uptime, and one column peculiar to this machine — priority as a word, who is attending it, heat, wear, whatever this machine's job would want to know about a process. Twenty to forty rows. Process names belong to this OS's world — daemons named after birds, saints, departments, weather. The percentages should roughly add up.

Graphs: CPU, memory and one other, drawn as SVG polylines or CSS bars, **animating** on a timer with plausible jitter and the occasional spike. A history strip behind the live value.

Seeds:

- One process using an impossible amount of something, described flatly, which cannot be ended (it comes back, or the machine declines and gives a reason).
- End-task works on the others, with a confirmation and a row that fades out.
- Tabs for Processes / Performance / Startup / Users, where Users lists people who have logged into this machine, one of them recently.
