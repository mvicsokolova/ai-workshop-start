# Command line
`./skill-atlas scan <GitHub URL | directory>`
`./skill-atlas serve [<GitHub URL | directory>] [--port <n>]`: see [web.md](web.md)
`./skill-atlas export <GitHub URL | directory> <out directory>`: the same website as static files
A GitHub URL: a repository or an organization, see [analysis.md](analysis.md#input)
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

### Organization
```
JetBrains · 9 skills in 2 repositories
kotlin/build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- `<org> · N skills in M repositories`; M counts repositories *with skills*; `1 skill`, `1 repository`
- Lines `<repo>/<name>`, sorted by **name**, then repository
- No skills at all → `<org> · 0 skills in 0 repositories`, exit code 0
