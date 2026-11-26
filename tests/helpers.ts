// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
export const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
  // The whole tree, for the website: code search finds only the SKILL.md files.
  [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: {
    status: 200,
    body: {
      truncated: false,
      tree: [
        { path: '.claude/skills/commits/SKILL.md', mode: '100644', type: 'blob', sha: 'a' },
        { path: '.claude/skills/commits/OWNERSHIP', mode: '100644', type: 'blob', sha: 'b' },
        { path: 'README.md', mode: '100644', type: 'blob', sha: 'c' },
      ],
    },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/OWNERSHIP`]: {
    status: 200,
    body: "owner 'VCS Team'\n",
  },
};

/** The commit GitHub answers for JetBrains/empty. */
export const EMPTY_COMMIT = '0e3f5c1d2b4a69788796a5b4c3d2e1f0a9b8c7d6';

/** What GitHub answers for JetBrains/empty, a repository without skills, through the tree. */
export const EMPTY: Recording = {
  'https://api.github.com/repos/JetBrains/empty': { status: 200, body: { full_name: 'JetBrains/empty', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/empty/commits/main': { status: 200, body: { sha: EMPTY_COMMIT } },
  [`https://api.github.com/repos/JetBrains/empty/git/trees/${EMPTY_COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'd' }] },
  },
};

/** JetBrains/missing does not exist: GitHub answers 404. */
export const MISSING: Recording = {
  'https://api.github.com/repos/JetBrains/missing': { status: 404, body: { message: 'Not Found' } },
};

const github = replay(EXAMPLE);

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    // With a token, through code search, as EXAMPLE answers it.
    open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input)),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
