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
import { openGitHub } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { atlas, atlasWith, CLI, EXAMPLE_COMMIT, FIXTURE, repositoryRecording } from './helpers.ts';

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

test('skills/<name>/SKILL.md at the repository root is a skill, as in anthropics/skills', async () => {
  const commit = '6666666666666666666666666666666666666666';
  const skill = (name: string) => `---\nname: ${name}\ndescription: Work with ${name} files. Use it.\n---\n# ${name}\n`;
  const blob = (path: string) => `  https://github.com/anthropics/skills/blob/${commit}/${path}`;
  const scanned = await atlasWith(
    {
      'https://api.github.com/repos/anthropics/skills': { status: 200, body: { full_name: 'anthropics/skills', default_branch: 'main' } },
      ...repositoryRecording('anthropics/skills', commit, {
        'skills/pdf/SKILL.md': skill('pdf'),
        'skills/pdf/reference.md': '# reference\n',
        'skills/docx/SKILL.md': skill('docx'),
        '.claude/skills/docx/SKILL.md': skill('docx'),
        'template/SKILL.md': skill('template'), // not a skill: not in a root
        'skills/SKILL.md': skill('root'), // not a skill: directly in the root
        'skills/pdf/forms/SKILL.md': skill('forms'), // not a skill: deeper
        'docs/skills/nested/SKILL.md': skill('nested'), // not a skill: a root below the repository root
      }),
    },
    ['scan', 'https://github.com/anthropics/skills'],
  );
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(
    scanned.stdout,
    [
      'anthropics/skills · 2 skills',
      'docx — Work with docx files.',
      blob('.claude/skills/docx/SKILL.md'),
      '  also in skills/docx/SKILL.md',
      'pdf — Work with pdf files.',
      blob('skills/pdf/SKILL.md'),
    ].join('\n'),
  );
});
