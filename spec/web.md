# Website
`./skill-atlas serve [<GitHub URL | directory>] [--port <n>]`
`npm run site`: the same, *without a repository*
- Scans the repository given **at start**, if any; an unreadable repository fails before
  serving: message, exit code 1. The page can then scan *other GitHub repositories*, see
  [Repository field](#repository-field); two repositories → the usage, exit code 1
- **Without a repository**: *nothing is scanned* until the page asks; `GET /api/catalog` answers
  `null`, the page shows only the repository field ("Enter a GitHub repository to see its skills."),
  a link with `repo` scans that one at once
- Prints `<repo> · N skills at <URL>`; for an organization `<org> · N skills in M repositories at <URL>`;
  without a repository `Skill Atlas at <URL>: scan a GitHub repository from the page`;
  port **4173** by default, `0` picks a free one
- An organization ([analysis.md](analysis.md#organization)): unknown, or no repository readable → message,
  exit code 1, before serving or writing
- A port in use, a bad `--port` → a clear message, exit code 1
- Listens on *127.0.0.1* only; the scan stays *in memory*, nothing is stored
- `serve` exists only in the Node CLI; the browser entry says so
- On GitHub, *every file* through the tree, with a token too: code search finds only SKILL.md files,
  and the page needs OWNERSHIP and the other files

## Static export
`./skill-atlas export <GitHub URL | directory> <out directory>`
- Writes `index.html`, `app.js`, `style.css`, `catalog.json`, `.nojekyll`; prints the repository,
  the count, the directory and the files (`<org> · N skills in M repositories → <dir>` for an
  organization); warnings go to *stderr*
- The same page: the catalog from `catalog.json`, *no rescan*, *the repository field is hidden*;
  relative paths, so it works below a path; the Content-Security-Policy is in the page
- Wrong arguments, an unreadable repository → a clear message, exit code 1; only in the Node CLI

## Hosting
`.github/workflows/pages.yml` exports JetBrains/intellij-community on every push to main, *daily*,
and on demand, and publishes it as the `gh-pages` branch, which GitHub Pages serves:
https://mvicsokolova.github.io/ai-workshop-start/

## HTTP
- `GET /`: the page; `/app.js`, `/style.css`: its code; no other files
- `GET /api/catalog`: the catalog as JSON; `null` before the first scan of a server started without
  a repository
- `POST /api/scan` with `{ "url": "<GitHub URL>" }`: scans that repository, answers the new catalog,
  which becomes the *current* one
  - `url`: `owner/repo` or `https://github.com/owner/repo` (as `scan` reads it: with or without the
    scheme, `.git`, a trailing slash); opened as `https://github.com/owner/repo`
  - A local path, an organization, any other string, no `url`, a body that is not JSON or over *4 KB* → *400*
    `{ error }`; nothing is scanned, the catalog stays. The body is read as UTF-8
  - An unknown or unreachable repository → *502* `{ error }`; the old catalog stays
  - A repository with *0 skills* is a valid, empty catalog: `skills: []`, empty facets
- `POST /api/rescan`: scans the *current* repository again (the last one scanned successfully: the
  one from the command line until a scan succeeds; an organization from the command line too), answers the new catalog; a failure → *502*
  `{ error }`, the old catalog stays; nothing scanned yet (started without a repository) → *409* `{ error }`
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
Kind (`repository` or `organization`), repository (for an organization: the organization, no
commit), skills (sorted by name, then repository), warnings, owner, topic and **repository**
*facets* with counts (`owner/repo`, repositories with skills), scan time (shown on the page).
Per skill, besides the scan: repository (`owner/repo`), *key* (the name; `<repo>/<name>` in an
organization: unique, the page opens a skill by it), link (its own repository's commit), directory, copies and files *with links*, owners, topics, html,
headings, links, linkedFrom, text, words.
- **Owners**: the `owner '<team>'` lines of the skill's `OWNERSHIP` file; `"…"` or no quotes too
- **Topics**: keywords in the *name and description*; none, one or several
- **html**: the body as Markdown; *raw HTML is shown as text*, `javascript:` and other
  non-web links become plain text
- Relative links and images: files *in the repository at the scanned commit*, from the skill's
  directory, or from the root with `/`; they never climb above the root
- A link to another skill's SKILL.md, copy or directory *in the same repository* → *opens that
  skill in the page*; it is in `links`, and the other skill's `linkedFrom`, by key
- Headings get unique ids, for the table of contents

## Page
- **Search** as you type: name, description, owners, topics and the whole body; every word must
  match; best match first: name, then description, then tags, then body; matches are marked,
  a match only in the body shows a *snippet*
- **Filters**: topic, owning team, **repository** (only when the catalog has *more than one*),
  contents (supporting files, scripts, references, shared with other agents, has an owner); OR
  within a group, AND across groups; each option counts what choosing it would show
- With more than one repository, each card and the reader show the skill's repository; search
  works across all of them
- **Sort**: best match, name, longest, quickest read, most files; cards or a compact list
- **Reader**: the rendered SKILL.md, a table of contents, owners and topics (click to filter),
  related skills, copies and files; open on GitHub, copy link or path, share; previous / next
- **Header**: the brand, rescan, theme and help; *no repository panel*, the subtitle names the repository
- The whole state is in the URL: shareable, Back works
- **Repository field**: another GitHub repository, see [Repository field](#repository-field)
- A repository with *no skills* says so ("No skills in this repository"), not "Try fewer words"
- Keyboard: `/` or ⌘K search, ↑↓ or j k move, Enter opens, Esc closes, c copies the link,
  g opens GitHub, t switches light/dark, ? shows them all
- Light and dark, the system's by default; works on a phone
- Loads only its own scripts and styles (Content-Security-Policy)

## Look
A blocky pixel style, original and drawn *in `style.css` only*: no image or font files, nothing
external, the same files and Content-Security-Policy; `serve` and the export look the same.
- **Blocks**: cards, the reader, filters, buttons and inputs are square (`border-radius: 0`) with a
  2–4 px bevel (light top-left, dark bottom-right); buttons look pressed on `:active`
- **Header**: a grass-on-dirt strip, CSS gradients only
- **Palette**: earthy custom properties, the same set for *light* (grass and sky) and *dark*
  (stone and cave); text, marks, buttons and the header reach *WCAG AA* (4.5:1) in both
- **Font**: headings and labels in a blocky system monospace stack; the SKILL.md body in the sans
  font, ≥15px, line height ≥1.5
- Search marks, the selected card and focus rings stay distinct; keyboard focus is never hidden:
  focus rings reach 3:1 on the page, the cards and (with the header's own ring) every dirt shade
- Borders and dividers reach 3:1 on the page, the cards, code and tags in both themes
- `prefers-reduced-motion: reduce` turns every animation and transition off

## Repository field
On the server only: *hidden* in the static export.
- Its own form, separate from the skill search: `owner/repo` or `https://github.com/owner/repo`;
  `POST /api/scan`; GitHub only, never a local path
- While it scans: the field and the buttons are *disabled*, it shows *Scanning owner/repo…*; on a
  failure it shows the server's `error`, and the repository shown stays
- The repository is in the URL: `#/?repo=owner/repo`, next to `q`, `skill`, …; an organization
  is *never* written there (`POST /api/scan` does not take it), and its rescan is `POST /api/rescan`
  - A scan from the field opens a new history entry with only `repo`: search and filters start over
  - Opening a link with `repo` scans that repository on load, unless it is the one shown; the rest
    of the link stays. A failed scan puts the repository shown back into the URL
  - Back and forward switch between the GitHub repositories scanned
  - A URL without `repo` keeps the repository shown; a GitHub one is added to the URL
- The rescan button (hidden until a repository is shown) rescans *the repository shown*, by `POST /api/scan` for a GitHub one (the
  server's current one may be another, scanned in another tab), by `POST /api/rescan` for the local
  directory or the organization from the command line; then the URL names the repository shown. A success clears the
  error of an earlier failed scan
