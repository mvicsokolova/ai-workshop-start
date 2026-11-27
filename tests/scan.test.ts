// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for a small GitHub repository answered in tests/helpers.ts. The edge cases of
// where skills live are yours to add.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub, type Fetch } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { atlas, CLI, EXAMPLE, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 5 skills',
      'code-review — Review a change to Skill Atlas against its spec, tests and architecture.',
      `  ${root}/.agents/skills/code-review/SKILL.md`,
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      '  also in .github/skills/commits/SKILL.md',
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
      'triage — Triage a new issue.',
      `  ${root}/agent/skills/triage/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

test("each skill keeps its body and the other files in its directory", async () => {
  const { scan } = await import('../src/core/scan.ts');
  const { openDirectory } = await import('../src/local.ts');
  const result = await scan(await openDirectory(FIXTURE));
  const triage = result.skills.find((skill) => skill.name === 'triage');
  assert.deepEqual(triage?.files, ['OWNERSHIP', 'references/labels.md']);
  assert.match(triage?.body ?? '', /^# Triage\n\nLabel the issue first;/);
  const commits = result.skills.find((skill) => skill.name === 'commits');
  assert.deepEqual(commits?.files, ['examples/SKILL.md']);
});

test('a private repository: GITHUB_TOKEN goes with every request, the file reads too, and never in a URL', async () => {
  const { scan } = await import('../src/core/scan.ts');
  const token = 'ghp_private-token';
  const requests: { url: string; authorization?: string }[] = [];
  const recorded = replay(EXAMPLE);
  // Like GitHub for a private repository: without the token, every answer is 404.
  const github: Fetch = async (url, init) => {
    const authorization = init?.headers?.Authorization;
    requests.push({ url, authorization });
    if (authorization !== `Bearer ${token}`) return new Response('404: Not Found', { status: 404 });
    return recorded(url, init);
  };
  for (const everyFile of [false, true]) {
    requests.length = 0;
    const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch: github, token, everyFile }));
    assert.deepEqual(result.skills.map((skill) => skill.name), ['commits']);
    assert.deepEqual(result.warnings, []);
    const raw = requests.filter(({ url }) => url.startsWith('https://raw.githubusercontent.com/'));
    assert.ok(raw.length > 0);
    assert.ok(requests.every(({ authorization }) => authorization === `Bearer ${token}`));
    assert.ok(requests.every(({ url }) => !url.includes(token)));
  }
  // Without a token, the file reads send no headers: the browser reads them without a preflight.
  const plain: (Parameters<Fetch>[1] | undefined)[] = [];
  const open = replay(EXAMPLE);
  await scan(
    await openGitHub('https://github.com/JetBrains/example', {
      fetch: (url, init) => (url.startsWith('https://raw.githubusercontent.com/') && plain.push(init), open(url, init)),
    }),
  );
  assert.ok(plain.length > 0);
  assert.ok(plain.every((init) => init === undefined));
});
