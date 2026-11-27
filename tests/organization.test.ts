// Organization input (spec/analysis.md, spec/cli.md, spec/web.md): every repository of a GitHub
// organization or user in one result, with GitHub answering from the recordings in tests/helpers.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openOrganization, parseGitHubOrganization, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { CONCURRENCY, scan, scanOrganization } from '../src/core/scan.ts';
import { openInput } from '../src/local.ts';
import type { Catalog } from '../src/web/catalog.ts';
import { startServer } from '../src/web/server.ts';
import {
  ACME,
  atlasWith,
  CLI,
  EXAMPLE,
  FIXTURE,
  KOTLIN_COMMIT,
  LATE_COMMIT,
  NOBODY,
  ownerRecording,
  repositoryRecording,
  SECRET_COMMIT,
  TOOLS_COMMIT,
} from './helpers.ts';

const blob = (repo: string, commit: string, path: string) => `https://github.com/Acme/${repo}/blob/${commit}/${path}`;
const RATE_LIMITED = { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } };

test('input: an organization URL is told apart from a repository URL; a bare <org> too', () => {
  for (const input of ['https://github.com/JetBrains', 'http://www.github.com/JetBrains/', 'github.com/JetBrains', ' github.com/JetBrains ']) {
    assert.deepEqual(parseGitHubOrganization(input), { login: 'JetBrains', bare: false }, input);
    assert.equal(parseGitHubUrl(input), undefined, input);
  }
  assert.deepEqual(parseGitHubOrganization('JetBrains'), { login: 'JetBrains', bare: true });
  assert.deepEqual(parseGitHubOrganization('a-b1'), { login: 'a-b1', bare: true });
  // A repository stays a repository.
  for (const input of ['https://github.com/JetBrains/kotlin', 'github.com/JetBrains/kotlin/', 'JetBrains/kotlin']) {
    assert.equal(parseGitHubOrganization(input), undefined, input);
  }
  assert.deepEqual(parseGitHubUrl('https://github.com/JetBrains/kotlin'), { owner: 'JetBrains', repo: 'kotlin' });
  for (const input of ['./fixture', '-a', 'a-', 'https://gitlab.com/JetBrains', '', 'a_b']) {
    assert.equal(parseGitHubOrganization(input), undefined, input);
  }
});

test('input: a bare <org> is an organization unless a local path of that name exists', async (t) => {
  const bare = await atlasWith(ACME, ['scan', 'Acme']);
  assert.equal(bare.code, 0, bare.stderr);
  assert.match(bare.stdout, /^Acme · 6 skills in 4 repositories\n/);

  // `fixture` is a directory here: the path wins, GitHub is not asked.
  const local = spawnSync(process.execPath, [CLI, 'scan', 'fixture'], { cwd: join(FIXTURE, '..'), encoding: 'utf8' });
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /^fixture · 7 skills\n/);

  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const organization = cli(ACME, ['scan', 'Acme'], { cwd });
  assert.equal(organization.status, 0, organization.stderr);
  assert.match(organization.stdout, /^Acme · 6 skills in 4 repositories\n/);
});

test('scan <org>: a header, then every skill as <repo>/<name>, by name then repository, with its pinned link', async () => {
  for (const input of ['https://github.com/Acme', 'github.com/Acme/']) {
    const result = await atlasWith(ACME, ['scan', input]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        'Acme · 6 skills in 4 repositories',
        'kotlin/bump',
        `  ${blob('kotlin', KOTLIN_COMMIT, '.agents/skills/bump/SKILL.md')}`,
        // The same name in two repositories: two skills, each with its repository and its commit.
        'kotlin/commits — Write commit messages for Kotlin.',
        `  ${blob('kotlin', KOTLIN_COMMIT, '.agents/skills/commits/SKILL.md')}`,
        '  also in .github/skills/commits/SKILL.md',
        'tools/commits — Write commit messages for tools.',
        `  ${blob('tools', TOOLS_COMMIT, '.claude/skills/commits/SKILL.md')}`,
        'tools/release — Release the tools.',
        `  ${blob('tools', TOOLS_COMMIT, '.claude/skills/release/SKILL.md')}`,
        // Private, but the API listed it.
        'secret/vault — Open the vault.',
        `  ${blob('secret', SECRET_COMMIT, 'agent/skills/vault/SKILL.md')}`,
        // On the second page of the list.
        'late/zebra — Last by name.',
        `  ${blob('late', LATE_COMMIT, '.claude/skills/zebra/SKILL.md')}`,
      ].join('\n'),
      input,
    );
    // A failing repository is a warning; the skill warnings name their repository; plain, without skills, says nothing.
    assert.equal(
      result.stderr,
      [
        'warning: Acme/kotlin: .agents/skills/bump/SKILL.md: malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
        'warning: Acme/broken: GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error',
      ].join('\n'),
    );
  }
});

test('listing: all pages; archived repositories, forks and empty ones are skipped; private ones the API lists are kept', async () => {
  const requested: string[] = [];
  const fetch: Fetch = (url, init) => (requested.push(url), replay(ACME)(url, init));
  const organization = await openOrganization('https://github.com/Acme', { fetch });
  assert.equal(organization.id, 'Acme');
  assert.equal(organization.url, 'https://github.com/Acme');
  assert.deepEqual(organization.repositories, ['Acme/tools', 'Acme/kotlin', 'Acme/broken', 'Acme/plain', 'Acme/secret', 'Acme/late']);
  assert.deepEqual(requested, [
    'https://api.github.com/users/Acme',
    'https://api.github.com/orgs/Acme/repos?per_page=100&page=1',
    'https://api.github.com/orgs/Acme/repos?per_page=100&page=2',
  ]);
});

test('listing: a user account is listed the same way as an organization', async () => {
  const someone = {
    ...ownerRecording('someone', 'User', [{ name: 'dotfiles' }, { name: 'forked', fork: true }]),
    ...repositoryRecording('someone/dotfiles', TOOLS_COMMIT, { '.claude/skills/setup/SKILL.md': '---\ndescription: Set it up.\n---\n' }),
  };
  const result = await atlasWith(someone, ['scan', 'https://github.com/someone']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'someone · 1 skill in 1 repository',
      'dotfiles/setup — Set it up.',
      `  https://github.com/someone/dotfiles/blob/${TOOLS_COMMIT}/.claude/skills/setup/SKILL.md`,
    ].join('\n'),
  );
});

test("listing: with a token, the token's own user gets its private repositories too; another user, or a token without a user, the public ones", async () => {
  const pub = ownerRecording('someone', 'User', [{ name: 'dotfiles' }]);
  const own: Recording = {
    'https://api.github.com/user/repos?affiliation=owner&per_page=100&page=1': {
      status: 200,
      body: ['dotfiles', 'diary'].map((name) => ({
        full_name: `someone/${name}`,
        default_branch: 'main',
        archived: false,
        fork: false,
        private: name === 'diary',
        size: 10,
      })),
    },
  };
  const cases: [string, Recording, string | undefined, string[]][] = [
    ['no token', { ...pub, ...own }, undefined, ['someone/dotfiles']],
    ['own user, other case', { ...pub, ...own, 'https://api.github.com/user': { status: 200, body: { login: 'SomeOne' } } }, 't', ['someone/dotfiles', 'someone/diary']],
    ['another user', { ...pub, ...own, 'https://api.github.com/user': { status: 200, body: { login: 'other' } } }, 't', ['someone/dotfiles']],
    ['app token', { ...pub, ...own, 'https://api.github.com/user': { status: 403, body: { message: 'Resource not accessible by integration' } } }, 't', ['someone/dotfiles']],
  ];
  for (const [name, recording, token, repositories] of cases) {
    const organization = await openOrganization('someone', { fetch: replay(recording), token });
    assert.deepEqual(organization.repositories, repositories, name);
  }
  const limited = { ...pub, 'https://api.github.com/user': RATE_LIMITED };
  await assert.rejects(openOrganization('someone', { fetch: replay(limited), token: 't' }), /rate limit/);
});

test('unknown organization → a clear message, exit code 1', async () => {
  for (const input of ['https://github.com/nobody', 'nobody']) {
    const result = await atlasWith(NOBODY, ['scan', input]);
    assert.equal(result.code, 1, input);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Organization not found: https://github.com/nobody');
  }
});

test('no repository can be read → a clear message, exit code 1', async () => {
  const unreadable = {
    ...ownerRecording('Down', 'Organization', [{ name: 'a' }, { name: 'b' }]),
    'https://api.github.com/repos/Down/a/commits/main': { status: 500, body: { message: 'Server Error' } },
    'https://api.github.com/repos/Down/b/commits/main': { status: 502, body: {} },
  };
  const result = await atlasWith(unreadable, ['scan', 'github.com/Down']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'No repository of https://github.com/Down could be read; the first: Down/a: GitHub answered 500 for https://api.github.com/repos/Down/a/commits/main: Server Error',
  );
});

test('an organization without skills: 0 skills in 0 repositories, exit code 0, no warning', async () => {
  const quiet = {
    ...ownerRecording('Quiet', 'Organization', [{ name: 'plain' }]),
    ...repositoryRecording('Quiet/plain', TOOLS_COMMIT, { 'README.md': '#\n' }),
  };
  const none = ownerRecording('Nothing', 'Organization', []);
  for (const [recording, login] of [[quiet, 'Quiet'], [none, 'Nothing']] as const) {
    const result = await atlasWith(recording, ['scan', `github.com/${login}`]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, `${login} · 0 skills in 0 repositories`);
    assert.equal(result.stderr, '');
  }
});

test('rate limit, while listing or while scanning a repository → the rate-limit message, exit code 1, no retry', async () => {
  const cases: [string, Recording][] = [
    ['listing', { ...ACME, 'https://api.github.com/orgs/Acme/repos?per_page=100&page=2': RATE_LIMITED }],
    ['a repository', { ...ACME, [`https://api.github.com/repos/Acme/kotlin/git/trees/${KOTLIN_COMMIT}?recursive=1`]: RATE_LIMITED }],
  ];
  for (const [when, recording] of cases) {
    let limited = 0;
    const fetch: Fetch = (url, init) => {
      if (recording[url] === RATE_LIMITED) limited++;
      return replay(recording)(url, init);
    };
    for (const [token, message] of [
      [undefined, 'GitHub rate limit reached; set GITHUB_TOKEN'],
      ['test', 'GitHub rate limit reached; try again in a minute'],
    ] as const) {
      const { run } = await import('../src/commands.ts');
      const out: string[] = [];
      const err: string[] = [];
      const code = await run(['scan', 'Acme'], {
        open: (input) => openInput(input, { fetch, token }),
        print: (text) => out.push(text),
        error: (text) => err.push(text),
      });
      assert.equal(code, 1, when);
      assert.deepEqual(out, [], when);
      assert.deepEqual(err, [message], when);
    }
    assert.equal(limited, 2, `${when}: asked once per run`);
  }
});

test(`at most ${CONCURRENCY} repositories are scanned at once`, async () => {
  const names = Array.from({ length: 20 }, (_, index) => ({ name: `r${index}` }));
  let recording: Recording = ownerRecording('Many', 'Organization', names);
  for (const { name } of names) recording = { ...recording, ...repositoryRecording(`Many/${name}`, TOOLS_COMMIT, { 'README.md': '#\n' }) };
  const answer = replay(recording);
  let inFlight = 0;
  let most = 0;
  let repositoryRequests = 0;
  // A repository's requests come one after another: requests in flight are repositories in flight.
  const fetch: Fetch = async (url, init) => {
    const repository = url.startsWith('https://api.github.com/repos/');
    if (repository) (inFlight++, repositoryRequests++, (most = Math.max(most, inFlight)));
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await answer(url, init);
    } finally {
      if (repository) inFlight--;
    }
  };
  const { results } = await scanOrganization(await openOrganization('Many', { fetch }), scan);
  assert.deepEqual(results, []);
  assert.equal(repositoryRequests, 40);
  assert.equal(most, CONCURRENCY);
});

/** The server for Acme, with GitHub answering from the recording. */
async function serveAcme(t: { after(fn: () => Promise<void>): void }) {
  const opened: string[] = [];
  const fetch = replay({ ...ACME, ...EXAMPLE });
  const server = await startServer({
    input: 'https://github.com/Acme',
    open: (input) => (opened.push(input), openInput(input, { fetch, everyFile: true })),
    port: 0,
  });
  t.after(() => server.close());
  const catalog = (await (await globalThis.fetch(`${server.url}api/catalog`)).json()) as Catalog;
  return { server, opened, catalog };
}

test('catalog of an organization: every skill has its repository and a unique key; a repository facet with counts', async (t) => {
  const { catalog } = await serveAcme(t);
  assert.equal(catalog.kind, 'organization');
  assert.deepEqual(catalog.repository, { id: 'Acme', organization: 'Acme', name: 'Acme', url: 'https://github.com/Acme', commit: '' });
  assert.deepEqual(
    catalog.skills.map((s) => [s.key, s.repository, s.name]),
    [
      ['kotlin/bump', 'Acme/kotlin', 'bump'],
      ['kotlin/commits', 'Acme/kotlin', 'commits'],
      ['tools/commits', 'Acme/tools', 'commits'],
      ['tools/release', 'Acme/tools', 'release'],
      ['secret/vault', 'Acme/secret', 'vault'],
      ['late/zebra', 'Acme/late', 'zebra'],
    ],
  );
  // Sorted like owners and topics: by count, then by name.
  assert.deepEqual(catalog.repositories, [
    { name: 'Acme/kotlin', count: 2 },
    { name: 'Acme/tools', count: 2 },
    { name: 'Acme/late', count: 1 },
    { name: 'Acme/secret', count: 1 },
  ]);
  const tools = catalog.skills.find((s) => s.key === 'tools/commits')!;
  assert.equal(tools.id, 'Acme/tools:.claude/skills/commits/SKILL.md');
  assert.equal(tools.link, blob('tools', TOOLS_COMMIT, '.claude/skills/commits/SKILL.md'));
  assert.deepEqual(tools.owners, ['Tools Team']);
  assert.deepEqual(catalog.owners, [{ name: 'Tools Team', count: 1 }]);
  // A link to another skill stays in its repository, by key.
  assert.deepEqual(tools.links, ['tools/release']);
  assert.match(tools.html, /<a href="#\/\?skill=tools%2Frelease" data-skill="tools\/release" class="skill-link">release<\/a>/);
  assert.deepEqual(catalog.skills.find((s) => s.key === 'tools/release')!.linkedFrom, ['tools/commits']);
  assert.equal(catalog.skills.find((s) => s.key === 'kotlin/commits')!.link, blob('kotlin', KOTLIN_COMMIT, '.agents/skills/commits/SKILL.md'));
  assert.deepEqual(catalog.warnings, [
    'Acme/kotlin: .agents/skills/bump/SKILL.md: malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
    'Acme/broken: GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error',
  ]);
});

test('catalog of an organization: two skills with the same name in one repository → <repo>/<name>@<directory name>', async (t) => {
  const commit = '6666666666666666666666666666666666666666';
  const fetch = replay({
    ...ownerRecording('Twins', 'Organization', [{ name: 'docs' }, { name: 'app' }]),
    ...repositoryRecording('Twins/docs', commit, {
      '.claude/skills/a/SKILL.md': '---\nname: same\ndescription: First.\n---\nA\n',
      '.claude/skills/b/SKILL.md': '---\nname: same\ndescription: Second.\n---\nSee [a](../a/SKILL.md)\n',
    }),
    ...repositoryRecording('Twins/app', commit, { '.claude/skills/same/SKILL.md': '---\nname: same\ndescription: Third.\n---\n' }),
  });
  const server = await startServer({ input: 'https://github.com/Twins', open: (input) => openInput(input, { fetch, everyFile: true }), port: 0 });
  t.after(() => server.close());
  const catalog = (await (await globalThis.fetch(`${server.url}api/catalog`)).json()) as Catalog;
  // The same name in another repository is no clash: its key is `<repo>/<name>`.
  assert.deepEqual(
    catalog.skills.map((s) => [s.key, s.description, s.links, s.linkedFrom]),
    [
      ['app/same', 'Third.', [], []],
      ['docs/same@a', 'First.', [], ['docs/same@b']],
      ['docs/same@b', 'Second.', ['docs/same@a'], []],
    ],
  );
});

test('catalog of one repository: kind repository, keys are names, one repository in the facet', async (t) => {
  const server = await startServer({ input: 'github.com/JetBrains/example', open: (input) => openInput(input, { fetch: replay(EXAMPLE), everyFile: true }), port: 0 });
  t.after(() => server.close());
  const catalog = server.catalog();
  assert.equal(catalog.kind, 'repository');
  assert.deepEqual(catalog.skills.map((s) => [s.key, s.repository]), [['commits', 'JetBrains/example']]);
  assert.deepEqual(catalog.repositories, [{ name: 'JetBrains/example', count: 1 }]);
});

test('server with an organization: rescan scans the organization again; api/scan takes repositories only', async (t) => {
  const { server, opened, catalog } = await serveAcme(t);
  const post = async (path: string, body?: unknown) => {
    const response = await globalThis.fetch(`${server.url}api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Catalog & { error?: string } };
  };
  const rescanned = await post('rescan');
  assert.equal(rescanned.status, 200);
  assert.equal(rescanned.body.kind, 'organization');
  assert.deepEqual(rescanned.body.skills.map((s) => s.key), catalog.skills.map((s) => s.key));
  for (const url of ['https://github.com/Acme', 'github.com/Acme', 'Acme']) {
    const refused = await post('scan', { url });
    assert.equal(refused.status, 400, url);
    assert.match(refused.body.error ?? '', new RegExp(`^Not a GitHub repository: ${url.replaceAll('.', '\\.')}\\. `));
  }
  assert.deepEqual(opened, ['https://github.com/Acme', 'https://github.com/Acme']);
  assert.equal(server.catalog().kind, 'organization');
});

test('the page: a Repository filter group, hidden unless the catalog has more than one repository, in the URL', async (t) => {
  const { server } = await serveAcme(t);
  const html = await (await globalThis.fetch(server.url)).text();
  assert.match(
    html,
    /<section class="filter-group" id="repository-group" hidden>\s*<h3>Repository<\/h3>\s*<div class="checklist" id="repository-filters"><\/div>/,
  );
  const app = await (await globalThis.fetch(`${server.url}app.js`)).text();
  assert.match(app, /^const manyRepositories = \(\) => \(catalog\?\.repositories\?\.length \?\? 0\) > 1;$/m);
  assert.match(app, /^ {2}els\.repositoryGroup\.hidden = !manyRepositories\(\);$/m);
  // OR within the group, AND with the others.
  assert.match(app, /if \(except !== 'repository' && state\.repository\.length && !state\.repository\.includes\(skill\.repository\)\) return false;/);
  assert.match(app, /repository: list\('repository'\)/);
  assert.match(app, /for \(const key of \['topic', 'owner', 'repository', 'has'\]\)/);
  // An organization is never written into ?repo=: api/scan does not take it.
  assert.match(app, /catalog\?\.kind !== 'organization' && catalog\?\.repository\.url\.startsWith\('https:\/\/github\.com\/'\)/);
});

const RECORDINGS = mkdtempSync(join(tmpdir(), 'skill-atlas-recordings-'));
let recordings = 0;

/** How to start the real CLI with GitHub answering from the recording, without a token. */
function withRecording(recording: Recording) {
  const file = join(RECORDINGS, `${recordings++}.json`);
  writeFileSync(file, JSON.stringify(recording));
  const preload = new URL('./fetch-replay.ts', import.meta.url).href;
  return { args: ['--import', preload, CLI], env: { ...process.env, SKILL_ATLAS_RECORDING: file, GITHUB_TOKEN: '' } };
}

/** The real CLI, with GitHub answering from the recording. */
function cli(recording: Recording, args: string[], options: { cwd?: string } = {}) {
  const { args: node, env } = withRecording(recording);
  return spawnSync(process.execPath, [...node, ...args], { encoding: 'utf8', env, ...options });
}

test.after(() => rmSync(RECORDINGS, { recursive: true, force: true }));

test('export <org>: the same header → <dir>; the catalog has the repository facet', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'skill-atlas-site-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const exported = cli(ACME, ['export', 'https://github.com/Acme', out]);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(exported.stdout, `Acme · 6 skills in 4 repositories → ${out}\n  index.html, app.js, style.css, catalog.json, .nojekyll\n`);
  assert.match(exported.stderr, /^warning: Acme\/kotlin: \.agents\/skills\/bump\/SKILL\.md: malformed front matter: .*\nwarning: Acme\/broken: /);
  const catalog = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')) as Catalog;
  assert.equal(catalog.repositories.length, 4);
});

test('serve <org>: prints <org> · N skills in M repositories at <URL>', async (t) => {
  const { args, env } = withRecording(ACME);
  const child = spawn(process.execPath, [...args, 'serve', 'github.com/Acme', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const line = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('\n')) resolve(out.split('\n')[0]);
    });
    child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
  });
  const match = /^Acme · 6 skills in 4 repositories at (http:\/\/127\.0\.0\.1:\d+\/)$/.exec(line);
  assert.ok(match, line);
  const catalog = (await (await globalThis.fetch(`${match[1]}api/catalog`)).json()) as Catalog;
  assert.equal(catalog.kind, 'organization');
});

test('serve or export an unknown organization, or one with no readable repository → message, exit code 1, nothing served or written', (t) => {
  const down = {
    ...ownerRecording('Down', 'Organization', [{ name: 'a' }]),
    'https://api.github.com/repos/Down/a/commits/main': { status: 500, body: {} },
  };
  const out = join(mkdtempSync(join(tmpdir(), 'skill-atlas-')), 'site');
  t.after(() => rmSync(join(out, '..'), { recursive: true, force: true }));
  for (const [recording, input, message] of [
    [NOBODY, 'nobody', 'Organization not found: https://github.com/nobody'],
    [down, 'github.com/Down', 'No repository of https://github.com/Down could be read; the first: Down/a: GitHub answered 500 for https://api.github.com/repos/Down/a/commits/main'],
  ] as const) {
    const served = cli(recording, ['serve', input, '--port', '0']);
    assert.equal(served.status, 1, input);
    assert.equal(served.stdout, '');
    assert.equal(served.stderr, `Scanning ${input}…\n${message}\n`);
    const exported = cli(recording, ['export', input, out]);
    assert.equal(exported.status, 1, input);
    assert.equal(exported.stderr, `${message}\n`);
    assert.equal(existsSync(out), false);
  }
});
