**Group chats with invented contacts who reply when you type.**

A conversation list down one side (people and groups, with last-message previews, timestamps, unread badges) and the open thread beside it. Threads read like real ones: uneven message lengths, someone answering a question from four messages ago, a reaction, an image sent as a small SVG, "delivered" and "read" states, one person who only sends single words.

**Replies are required.** When the user sends a message, one or more contacts answer after a short, believable delay — typing indicator, then a reply that responds to what was actually typed. Write the responder in inline script: a set of per-contact voices and a fallback that turns the user's own words back into a plausible reply. Each contact has a consistent personality and never breaks it.

Seeds: a group planning something logistical and doomed; a contact who is currently somewhere with no signal and answers late; pinned messages; a chat with the machine's own support line.

Picture slot — the avatars, one sheet for the whole contact list:

```html
<span data-os-img="tiles" data-os-theme="faces" data-os-tile="0" data-os-prompt="…who these people are…"></span>
<span data-os-img="tiles" data-os-theme="faces" data-os-tile="1"></span>
```

- One element per contact, each with the **next tile**: `data-os-tile="0"`, `"1"`, `"2"` and upward, counting in document order, sixteen at the most. Every one of them carries `data-os-img="tiles"` and `data-os-theme="faces"`, and the machine cuts one sheet of sixteen portraits into those cells.
- **`data-os-prompt` sits on the first of them and on no other**, and says in one line who these people are — the kind of people, where they are, the light. All the avatars together count as **one** picture; a second prompt in the group buys a second sheet of the same people.
- Empty of text and children, square or round, `background-size:400% 400%`, with a coloured background of your own underneath so the list looks finished before the sheet lands. Initials, if you want them, go in a sibling element.
