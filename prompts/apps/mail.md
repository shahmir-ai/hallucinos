**An inbox.** Invented senders, invented companies, and one thread that is oddly personal.

Twelve to twenty messages, each with a sender name and address at a plausible domain, a subject, a timestamp, a read/unread state, and a one-line preview. The mix matters: a payroll notice, three from a mailing list nobody joined, a shipping confirmation for something nobody would order, a chain of replies inside one company arguing about something too small to argue about, promotional mail from an invented brand with an unsubscribe link in 8px, an automated warning from the machine itself.

Then one thread that lands differently: someone who knows the user, writing about something small and real, with a question at the end. Not sinister. Just personal.

Clicking a message must open it in a reading pane with the full body, headers, and a reply box that accepts typing and does something when sent.

Picture slot — the sender portraits, one sheet for the whole inbox:

```html
<span data-os-img="tiles" data-os-theme="faces" data-os-tile="0" data-os-prompt="…who these correspondents are…"></span>
<span data-os-img="tiles" data-os-theme="faces" data-os-tile="1"></span>
```

- One element per sender in the list, each with the **next tile**: `data-os-tile="0"`, `"1"`, `"2"` and upward, counting in document order, sixteen at the most (the rest of the rows keep an initial or a monogram of yours instead). The machine cuts one sheet of sixteen portraits into those cells, and every one of them carries `data-os-img="tiles"` and `data-os-theme="faces"`.
- **`data-os-prompt` sits on the first of them and on no other**, and says in one line who these correspondents are — the kind of people, where they work, the light. All the portraits together count as **one** picture; repeating the prompt onto a second row buys a second sheet of the same people.
- Empty of text and children, square or round, `background-size:400% 400%`, with a background colour of your own underneath so the inbox looks finished before the sheet lands. Initials and names go in sibling elements, and a company or a machine sender can keep a drawn mark instead of a portrait.

Seeds: folders with counts, a spam folder with its own worse mail, search, a draft that was never sent, an attachment that cannot be opened for a stated reason.
