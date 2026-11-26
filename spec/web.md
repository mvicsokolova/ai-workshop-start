# Website
`./skill-atlas serve <GitHub URL | directory> [--port <n>]`
`npm run site`: the same for https://github.com/JetBrains/intellij-community
- Scans **once at start**; an unreadable repository fails before serving: message, exit code 1
- Prints `<repo> · N skills at <URL>`; port **4173** by default, `0` picks a free one
- A port in use, a bad `--port` → a clear message, exit code 1
- Listens on *127.0.0.1* only; the scan stays *in memory*, nothing is stored
- `serve` exists only in the Node CLI; the browser entry says so

## HTTP
- `GET /`: the page; `/app.js`, `/style.css`: its code; no other files
- `GET /api/catalog`: the catalog as JSON
- `POST /api/rescan`: scans again, answers the new catalog; a failure → *502* `{ error }`, the old catalog stays
- Anything else → *404* `{ error }`

## Catalog
Repository, skills (sorted by name), warnings, owner and topic *facets* with counts, scan time.
Per skill, besides the scan: link, directory, copies and files *with links*, owners, topics, html,
headings, links, linkedFrom, text, words.
- **Owners**: the `owner '<team>'` lines of the skill's `OWNERSHIP` file; `"…"` or no quotes too
- **Topics**: keywords in the *name and description*; none, one or several
- **html**: the body as Markdown; *raw HTML is shown as text*, `javascript:` and other
  non-web links become plain text
- Relative links and images: files *in the repository at the scanned commit*, from the skill's
  directory, or from the root with `/`; they never climb above the root
- A link to another skill's SKILL.md, copy or directory → *opens that skill in the page*;
  it is in `links`, and the other skill's `linkedFrom`
- Headings get unique ids, for the table of contents

## Page
- **Search** as you type: name, description, owners, topics and the whole body; every word must
  match; best match first: name, then description, then tags, then body; matches are marked,
  a match only in the body shows a *snippet*
- **Filters**: topic, owning team, contents (supporting files, scripts, references, shared with
  other agents, has an owner); OR within a group, AND across groups; each option counts what
  choosing it would show
- **Sort**: best match, name, longest, quickest read, most files; cards or a compact list
- **Reader**: the rendered SKILL.md, a table of contents, owners and topics (click to filter),
  related skills, copies and files; open on GitHub, copy link or path, share; previous / next
- The whole state is in the URL: shareable, Back works
- Keyboard: `/` or ⌘K search, ↑↓ or j k move, Enter opens, Esc closes, c copies the link,
  g opens GitHub, t switches light/dark, ? shows them all
- Light and dark, the system's by default; works on a phone
- Loads only its own scripts and styles (Content-Security-Policy)
