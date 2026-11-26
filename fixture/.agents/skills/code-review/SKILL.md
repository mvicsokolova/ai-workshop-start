---
name: code-review
description: "Review a change to Skill Atlas against its spec, tests and architecture. Use for every pull request or diff before it is merged."
---

# Code review

Review the diff (`git diff main...HEAD`, or the pull request), not the whole repository.
Report findings ranked by severity: **blocking** (wrong behaviour, broken spec, missing test),
**should fix** (architecture, error handling, performance), **nit** (naming, comments).
Each finding: file and line, what is wrong, a concrete input that shows it, a suggested fix.
Say plainly when there is nothing to report.

## 1. Spec first

The spec in `spec/` is the source of truth; `AGENTS.md` says to update it with the code.

- Behaviour changed → `spec/analysis.md` or `spec/cli.md` changed in the same diff. If not: blocking.
- Spec changed → the code and the tests follow it.
- Check the change against the decisions there, among them:
  - a skill is exactly `<root>/<name>/SKILL.md`, `<root>` one of `.agents/skills`, `.claude/skills`,
    `.github/skills`, `agent/skills` (`SKILL_ROOTS` in `src/core/find.ts`); anything else is not a skill;
  - the same `<name>` in two roots is one skill, printed with `also in <paths>`;
  - the name comes from the front matter, else the directory;
  - malformed front matter is a warning on stderr, and the scan goes on;
  - an unreachable repository is a clear message and exit code 1;
  - output is sorted by name (locale-independent, `sortSkills`), with the description's first sentence;
  - the link pins the scanned commit;
  - results print at once and nothing is stored: no cache files, no writes to the working directory.

## 2. Tests

- Every case in the spec has an integration test in `tests/` that runs the real command
  (`atlas([...])` from `tests/helpers.ts`, or the CLI through `spawnSync`). A unit test alone is not enough.
- GitHub is never called live in tests: new requests go through `replay` with a recorded answer.
- A new edge case of where skills live → a file under `fixture/` **and** a row in `fixture/README.md`,
  and the expected output in `tests/scan.test.ts` updated.
- Tests assert exact output (stdout, stderr, exit code), not just "contains".

## 3. Architecture

- Core is `fetch → find → parse` (`src/core/`); the CLI is a thin client. Logic in `src/cli.ts`
  or `src/browser.ts` that is not wiring: should fix, move it to `src/commands.ts` or `src/core/`.
- `src/core/` and `src/commands.ts` run in the browser too: no `node:` imports, no `process`,
  no `console`. Node-only code goes in `src/cli.ts` or `src/local.ts`.
- Output goes through `Context.print` / `Context.error`, never `console.*`.
- Failures meant for the user are `AtlasError` (exit code 1); anything else is a bug and should crash.
- The `Skill` id is `repo:path`; links come from `skillLink`, not built by hand.

## 4. GitHub and performance

- GitHub API only, never a clone. The budget is under 5 s for intellij-community.
- Count the requests: no request per file when a tree or a search answers for all of them;
  independent requests run together (`Promise.all`); repeated URLs are served by the client's cache.
- Mind the limits: code search returns at most 1000 results; a truncated tree falls back to the skill roots.
- Errors map to messages: 404 → not found, 403/429 with "rate limit" → ask for `GITHUB_TOKEN`,
  401 → bad token, network failure → `Cannot reach GitHub: …`.
- `GITHUB_TOKEN` is optional; it is never logged, printed or put in a URL.
- Paths in URLs are encoded segment by segment (`encodePath`); symbolic links are not skills.

## 5. TypeScript

- Node runs the `.ts` files directly: erasable syntax only (no `enum`, `namespace`,
  parameter properties), `import type` for types, `.ts` extensions in imports.
- `strict` holds: no `any`, no non-null `!` without a reason, unknown JSON narrowed before use.
- The style of the code around it: small functions, a one-line doc comment saying *why*, plain English
  messages without trailing periods.

## 6. Run it

```sh
npm ci
npm run typecheck
npm test
./skill-atlas help
./skill-atlas scan ./fixture
```

This is what CI runs (`.github/workflows/ci.yml`). The change is ready only when all of it passes.
