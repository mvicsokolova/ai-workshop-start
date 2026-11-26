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

/** What GitHub answers for one repository through the tree, with its files and their contents. */
export function repositoryRecording(fullName: string, commit: string, files: Record<string, string>): Recording {
  const recording: Recording = {
    [`https://api.github.com/repos/${fullName}/commits/main`]: { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/${fullName}/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: 'x' })) },
    },
  };
  for (const [path, content] of Object.entries(files)) {
    recording[`https://raw.githubusercontent.com/${fullName}/${commit}/${path}`] = { status: 200, body: content };
  }
  return recording;
}

type Listed = { name: string; archived?: boolean; fork?: boolean; private?: boolean; size?: number };

/** What GitHub answers for an organization or a user: who it is and its repositories, 100 a page. */
export function ownerRecording(login: string, type: 'Organization' | 'User', repositories: Listed[]): Recording {
  const list = type === 'Organization' ? `https://api.github.com/orgs/${login}/repos` : `https://api.github.com/users/${login}/repos`;
  const recording: Recording = { [`https://api.github.com/users/${login}`]: { status: 200, body: { login, type } } };
  for (let page = 1; page === 1 || (page - 1) * 100 <= repositories.length; page++) {
    recording[`${list}?per_page=100&page=${page}`] = {
      status: 200,
      body: repositories.slice((page - 1) * 100, page * 100).map((repository) => ({
        full_name: `${login}/${repository.name}`,
        default_branch: 'main',
        archived: repository.archived ?? false,
        fork: repository.fork ?? false,
        private: repository.private ?? false,
        size: repository.size ?? 10,
      })),
    };
  }
  return recording;
}

const skillFile = (name: string, description: string, body = '') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n${body}`;

export const TOOLS_COMMIT = '1111111111111111111111111111111111111111';
export const KOTLIN_COMMIT = '2222222222222222222222222222222222222222';
export const SECRET_COMMIT = '3333333333333333333333333333333333333333';
export const LATE_COMMIT = '4444444444444444444444444444444444444444';

/**
 * The organization Acme: 101 repositories over two pages. tools and kotlin both have a `commits`
 * skill; kotlin's other skill has malformed front matter; broken cannot be read; plain has no skills;
 * secret is private; old is archived; the forks and the empty one are left out; late is on page 2.
 */
export const ACME: Recording = {
  ...ownerRecording('Acme', 'Organization', [
    { name: 'tools' },
    { name: 'kotlin' },
    { name: 'broken' },
    { name: 'plain' },
    { name: 'secret', private: true },
    { name: 'old', archived: true },
    { name: 'blank', size: 0 },
    ...Array.from({ length: 93 }, (_, index) => ({ name: `fork-${index}`, fork: true })),
    { name: 'late' },
  ]),
  ...repositoryRecording('Acme/tools', TOOLS_COMMIT, {
    '.claude/skills/commits/SKILL.md': skillFile('commits', 'Write commit messages for tools. Always.', 'See [release](../release/SKILL.md).\n'),
    '.claude/skills/commits/OWNERSHIP': "owner 'Tools Team'\n",
    '.claude/skills/release/SKILL.md': skillFile('release', 'Release the tools.'),
  }),
  ...repositoryRecording('Acme/kotlin', KOTLIN_COMMIT, {
    '.agents/skills/commits/SKILL.md': skillFile('commits', 'Write commit messages for Kotlin.'),
    '.github/skills/commits/SKILL.md': skillFile('commits', 'Write commit messages for Kotlin.'),
    '.agents/skills/bump/SKILL.md': '---\nname: bump\ndescription: a: b: c\n---\n',
  }),
  'https://api.github.com/repos/Acme/broken/commits/main': { status: 500, body: { message: 'Server Error' } },
  ...repositoryRecording('Acme/plain', '5555555555555555555555555555555555555555', { 'README.md': '# plain\n' }),
  ...repositoryRecording('Acme/secret', SECRET_COMMIT, { 'agent/skills/vault/SKILL.md': skillFile('vault', 'Open the vault.') }),
  ...repositoryRecording('Acme/late', LATE_COMMIT, { '.claude/skills/zebra/SKILL.md': skillFile('zebra', 'Last by name.') }),
};

/** Unknown on GitHub. */
export const NOBODY: Recording = { 'https://api.github.com/users/nobody': { status: 404, body: { message: 'Not Found' } } };

/** `skill-atlas <args>` with the Node CLI's own input rules, GitHub answering from the recording. */
export async function atlasWith(recording: Recording, args: string[], token?: string) {
  const { openInput } = await import('../src/local.ts');
  const fetch = replay(recording);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open: (input) => openInput(input, { fetch, token }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
