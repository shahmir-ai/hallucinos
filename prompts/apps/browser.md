**A web browser.** An address bar, some way to navigate, and a large area where the page lives. Home is a search-shaped page.

Required hooks, exact spelling:

- `[data-os-url]` — a single `<input type="text">`. The machine writes the current address into it after every navigation, and pressing Enter in it navigates. Do not wrap it in a `<form>`, do not add your own Enter handler, do not set a `value` beyond a plausible starting address.
- `[data-os-page]` — an **empty** container where the page is mounted. It gets a frame that fills it completely, so give it the great majority of the window: `flex: 1 1 auto` or `height: 100%`, `overflow: hidden`, no padding. Leave it empty; do not draw a placeholder or a loading state inside it — the machine loads the home page as soon as the window opens.

Optional, wired if present: `[data-os-nav="back"]`, `[data-os-nav="forward"]`, `[data-os-nav="reload"]`, `[data-os-nav="home"]`.

Seeds — pick one or invent better:

- A tab strip with three other tabs already open, titled with things the previous user was reading. Decorative unless you wire it: clicking a tab can `os.navigate(url)` to that tab's address.
- Bookmarks, a downloads shelf, a security padlock that reports something unusual, a zoom control, a "reader mode" toggle that restyles nothing.
- A status line at the bottom that reports the host, how long the connection has been up, and one number this machine thinks a person should be watching.

Chrome stays thin. The page is the point.
