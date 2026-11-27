# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

## The website

**Hosted:** https://mvicsokolova.github.io/ai-workshop-start/ (JetBrains/intellij-community,
rebuilt daily by [.github/workflows/pages.yml](.github/workflows/pages.yml)).

Search, filter and read every skill in your browser:

```console
$ npm run site                      # no repository: enter one on the page
$ ./skill-atlas serve [<GitHub URL | directory>] [--port 4173]
$ ./skill-atlas export <GitHub URL | directory> site/   # static files, for any host
Skill Atlas at http://127.0.0.1:4173/: scan a GitHub repository from the page
```

- **Search** as you type, across names, descriptions and the full text of every SKILL.md
- **Filter** by topic, owning team (from `OWNERSHIP` files) and contents: scripts, references, …
- **Read** a skill rendered, with its table of contents, the skills it links to and from, and its files
- **Scan another** GitHub repository from the page (`owner/repo`), without restarting the server
- Every view is a shareable URL; press `?` for the keyboard shortcuts

Set `GITHUB_TOKEN` for a higher GitHub rate limit; without it GitHub allows 60 API calls an hour,
a few scans of a large repository (`GITHUB_TOKEN=$(gh auth token) npm run site`). `npm test` runs the tests.

- [spec/](spec/): what it does; [spec/web.md](spec/web.md): the website. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
