# Command line
`./skill-atlas scan <GitHub URL | directory>`
`./skill-atlas serve <GitHub URL | directory> [--port <n>]`: see [web.md](web.md)
`./skill-atlas export <GitHub URL | directory> <out directory>`: the same website as static files
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
