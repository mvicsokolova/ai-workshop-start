# fixture

A small repository for the tests.

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.agents/skills/release-checklist` | malformed front matter |
| `.agents/skills/code-review` | a skill with a quoted description, sorted first |
| `agent/skills/triage` | a skill in the fourth root |
| `.github/skills/commits` | the same name in two roots: a copy of `.claude/skills/commits` |
| `.claude/skills/commits/examples/SKILL.md` | not a skill: deeper than `<root>/<name>/SKILL.md` |
| `.claude/skills/SKILL.md` | not a skill: directly in a root |
| `SKILL.md` | not a skill: at the repository root |
| `docs/.claude/skills/nested-root` | not a skill: a root below the repository root |
| `.cursor/skills/other-agent` | not a skill: not one of the four roots |
| `.claude/skills/lowercase/skill.md` | not a skill: not named exactly `SKILL.md` |
| `.claude/skills-old/stale` | not a skill: a directory that only starts like a root |
