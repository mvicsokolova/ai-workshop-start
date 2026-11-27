# Repository analysis
## Input
A **GitHub repository** URL, a **GitHub organization** URL, or a local directory
- Repository: `https://github.com/<owner>/<repo>` (scheme, `www.`, `.git`, trailing slash optional)
- Organization: `https://github.com/<org>`, `github.com/<org>` (same options) or a bare `<org>`;
  a bare `<org>` is a local path if one of that name exists. A *user account* works the same way

## Output
Every `SKILL.md`: **name**, **description**, **link**

## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `owner/repo:path`, name, description, commit, body, files
- *body*: the Markdown after the front matter
- *files*: the other files in the skill's directory, relative to it

## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1

## Organization
- Its repositories through the GitHub API, *all pages*; public ones, and the private ones
  `GITHUB_TOKEN` can see. **Skipped:** archived, forks, empty (size 0)
- A user account: its public repositories; the token's own user (`GET /user`) also its private
  ones. A token that cannot tell its user → the public ones
- Each repository: the rules below, through the tree (not code search: its rate limit is too low);
  each skill keeps its repository, and its link pins *that repository's* commit
- The same name in two repositories → *two skills*
- *At most 8* repositories at once; nothing stored, no caching, no retries
- Unknown organization → `Organization not found: https://github.com/<org>`, exit code 1
- A repository that fails → a *warning* `<owner/repo>: <reason>`; the scan goes on. Skill
  warnings get the same prefix
- No repository can be read → a clear message, exit code 1
- Repositories without skills: left out of the output and the counts, silently
- Rate limit, at any point → *stop*: the rate-limit message (`set GITHUB_TOKEN` without a token),
  exit code 1
- Target, checked by hand: *under 60 s* for JetBrains with `GITHUB_TOKEN`

## What is a project skill?
`<root>/<name>/SKILL.md`, `<root>` is one of:
`.agents/skills`, `.claude/skills`,
`.github/skills`, `agent/skills`, `skills` (as in anthropics/skills)
- The same `<name>` in two roots → one skill; the first root in this order holds it, the others are copies
- Anything else → not a skill
