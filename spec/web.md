# Website
`./skill-atlas serve <GitHub URL | directory> [--port <n>]`
`npm run site`: the same for https://github.com/JetBrains/intellij-community
- Scans the repository given **at start** (still required); an unreadable repository fails before
  serving: message, exit code 1. The page can then scan *other GitHub repositories*, see
  [Repository field](#repository-field)
- Prints `<repo> · N skills at <URL>`; port **4173** by default, `0` picks a free one
- A port in use, a bad `--port` → a clear message, exit code 1
- Listens on *127.0.0.1* only; the scan stays *in memory*, nothing is stored
- `serve` exists only in the Node CLI; the browser entry says so
- On GitHub, *every file* through the tree, with a token too: code search finds only SKILL.md files,
  and the page needs OWNERSHIP and the other files

## Static export
`./skill-atlas export <GitHub URL | directory> <out directory>`
- Writes `index.html`, `app.js`, `style.css`, `catalog.json`, `.nojekyll`; prints the repository,
  the count, the directory and the files; warnings go to *stderr*
- The same page: the catalog from `catalog.json`, *no rescan*, *the repository field is hidden*;
  relative paths, so it works below a path; the Content-Security-Policy is in the page
- Wrong arguments, an unreadable repository → a clear message, exit code 1; only in the Node CLI

## Hosting
`.github/workflows/pages.yml` exports JetBrains/intellij-community on every push to main, *daily*,
and on demand, and publishes it as the `gh-pages` branch, which GitHub Pages serves:
https://mvicsokolova.github.io/ai-workshop-start/

## HTTP
- `GET /`: the page; `/app.js`, `/style.css`: its code; no other files
- `GET /api/catalog`: the catalog as JSON
- `POST /api/scan` with `{ "url": "<GitHub URL>" }`: scans that repository, answers the new catalog,
  which becomes the *current* one
  - `url`: `owner/repo` or `https://github.com/owner/repo` (as `scan` reads it: with or without the
    scheme, `.git`, a trailing slash); opened as `https://github.com/owner/repo`
  - A local path, any other string, no `url`, a body that is not JSON or over *4 KB* → *400*
    `{ error }`; nothing is scanned, the catalog stays. The body is read as UTF-8
  - An unknown or unreachable repository → *502* `{ error }`; the old catalog stays
  - A repository with *0 skills* is a valid, empty catalog: `skills: []`, empty facets
- `POST /api/rescan`: scans the *current* repository again (the last one scanned successfully: the
  one from the command line until a scan succeeds), answers the new catalog; a failure → *502*
  `{ error }`, the old catalog stays
- *Only the page itself* may scan: a `POST` with an `Origin` other than the server's own
  (`http://127.0.0.1:<port>` or `http://localhost:<port>`) → *403* `{ error }`; a request without
  `Origin` (not from a browser) is allowed. `POST /api/scan` without `Content-Type: application/json`
  → *415* `{ error }`, so another site cannot send it without a CORS preflight, which the server never
  approves. In both cases nothing is scanned and the catalog stays
- *One scan at a time*: a scan or rescan while one runs → *409* `{ error }`; the running one still
  finishes and becomes the current catalog. No queue
- Nothing is cached: only the current catalog is kept, in memory
- Anything else → *404* `{ error }`

## Catalog
Repository, skills (sorted by name), warnings, owner and topic *facets* with counts, scan time
(shown on the page).
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
- **Repository field**: another GitHub repository, see [Repository field](#repository-field)
- A repository with *no skills* says so ("No skills in this repository"), not "Try fewer words"
- Keyboard: `/` or ⌘K search, ↑↓ or j k move, Enter opens, Esc closes, c copies the link,
  g opens GitHub, t switches light/dark, ? shows them all
- Light and dark, the system's by default; works on a phone
- Loads only its own scripts and styles (Content-Security-Policy)

## Repository field
On the server only: *hidden* in the static export.
- Its own form, separate from the skill search: `owner/repo` or `https://github.com/owner/repo`;
  `POST /api/scan`; GitHub only, never a local path
- While it scans: the field and the buttons are *disabled*, it shows *Scanning owner/repo…*; on a
  failure it shows the server's `error`, and the repository shown stays
- The repository is in the URL: `#/?repo=owner/repo`, next to `q`, `skill`, …
  - A scan from the field opens a new history entry with only `repo`: search and filters start over
  - Opening a link with `repo` scans that repository on load, unless it is the one shown; the rest
    of the link stays. A failed scan puts the repository shown back into the URL
  - Back and forward switch between the GitHub repositories scanned
  - A URL without `repo` keeps the repository shown; a GitHub one is added to the URL
- The rescan button rescans *the repository shown*, by `POST /api/scan` for a GitHub one (the
  server's current one may be another, scanned in another tab), by `POST /api/rescan` for the local
  directory from the command line; then the URL names the repository shown. A success clears the
  error of an earlier failed scan
