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

Search, filter and read every skill in your browser:

```console
$ npm run site                      # JetBrains/intellij-community
$ ./skill-atlas serve <GitHub URL | directory> [--port 4173]
JetBrains/intellij-community · 41 skills at http://127.0.0.1:4173/
```

- **Search** as you type, across names, descriptions and the full text of every SKILL.md
- **Filter** by topic, owning team (from `OWNERSHIP` files) and contents: scripts, references, …
- **Read** a skill rendered, with its table of contents, the skills it links to and from, and its files
- Every view is a shareable URL; press `?` for the keyboard shortcuts

Set `GITHUB_TOKEN` for a higher GitHub rate limit; without it GitHub allows 60 API calls an hour,
a few scans of a large repository (`GITHUB_TOKEN=$(gh auth token) npm run site`). `npm test` runs the tests.

- [spec/](spec/): what it does; [spec/web.md](spec/web.md): the website. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
