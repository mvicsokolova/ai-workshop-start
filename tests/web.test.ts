// The decisions in spec/web.md, checked on the real server for ./fixture and for the small GitHub
// repository answered in tests/helpers.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createBrowserBackend } from '../src/browser.ts';
import { AtlasError } from '../src/core/errors.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';
import { parseOwners, renderMarkdown, type Catalog, type CatalogSkill } from '../src/web/catalog.ts';
import { startServer } from '../src/web/server.ts';
import { atlas, CLI, EXAMPLE, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const ROOT = pathToFileURL(FIXTURE).href;

async function serveFixture(t: { after(fn: () => Promise<void>): void }) {
  const server = await startServer({ input: FIXTURE, open: openDirectory, port: 0 });
  t.after(() => server.close());
  const catalog = (await (await fetch(`${server.url}api/catalog`)).json()) as Catalog;
  const skill = (name: string) => catalog.skills.find((s) => s.name === name) as CatalogSkill;
  return { server, catalog, skill };
}

test('serve: the catalog of ./fixture, sorted by name, with owner facets from OWNERSHIP', async (t) => {
  const { catalog, skill } = await serveFixture(t);
  assert.equal(catalog.repository.id, 'fixture');
  assert.deepEqual(
    catalog.skills.map((s) => s.name),
    ['code-style', 'commits', 'release-checklist', 'triage'],
  );
  assert.deepEqual(skill('triage').owners, ['Issue Wranglers', 'Release Team']);
  assert.deepEqual(catalog.owners, [
    { name: 'Issue Wranglers', count: 1 },
    { name: 'Release Team', count: 1 },
  ]);
  assert.deepEqual(skill('commits').topics, ['Git & VCS']);
  // "committing Kotlin or Java changes"
  assert.deepEqual(skill('code-style').topics, ['Code quality', 'Git & VCS', 'Kotlin']);
  assert.deepEqual(skill('triage').topics, []);
  assert.ok(catalog.topics.some((topic) => topic.name === 'Git & VCS' && topic.count === 2));
  assert.match(catalog.warnings[0], /^\.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
  assert.ok(!Number.isNaN(Date.parse(catalog.scannedAt)));
});

test('serve: each skill has its link, directory, copies and files with links, headings and word count', async (t) => {
  const { skill } = await serveFixture(t);
  const commits = skill('commits');
  assert.equal(commits.link, `${ROOT}/.claude/skills/commits/SKILL.md`);
  assert.equal(commits.directory, '.claude/skills/commits');
  // examples/SKILL.md is not a skill, but it is a file of this one.
  assert.deepEqual(commits.files, [{ path: 'examples/SKILL.md', link: `${ROOT}/.claude/skills/commits/examples/SKILL.md` }]);
  assert.deepEqual(commits.copies, [{ path: '.github/skills/commits/SKILL.md', link: `${ROOT}/.github/skills/commits/SKILL.md` }]);
  assert.deepEqual(commits.headings, [{ depth: 1, text: 'Commits', id: 'h-commits' }]);
  assert.match(commits.html, /<h1 id="h-commits">Commits<\/h1>/);
  assert.equal(commits.text, 'Commits Start with the area, then say what changed: editor: keep the caret after undo .');
  assert.equal(commits.words, 16);

  const triage = skill('triage');
  assert.deepEqual(
    triage.files.map((f) => f.path),
    ['OWNERSHIP', 'references/labels.md'],
  );
  assert.equal(triage.files[1].link, `${ROOT}/agent/skills/triage/references/labels.md`);
});

test('serve: raw HTML is shown as text and a javascript: link as plain text', async (t) => {
  const { skill } = await serveFixture(t);
  const { html } = skill('triage');
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;alert\(&#39;raw HTML in a SKILL\.md&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /A link that would run code is shown as plain text\./);
});

test('serve: a link to another skill opens it in the page, both ways; a link to a file goes to the file', async (t) => {
  const { skill } = await serveFixture(t);
  const triage = skill('triage');
  assert.match(triage.html, /<a href="#\/\?skill=commits" data-skill="commits" class="skill-link">commits skill<\/a>/);
  assert.deepEqual(triage.links, ['commits']);
  assert.deepEqual(skill('commits').linkedFrom, ['triage']);
  assert.deepEqual(skill('commits').links, []);
  assert.match(
    triage.html,
    new RegExp(`<a href="${ROOT}/agent/skills/triage/references/labels\\.md" target="_blank" rel="noopener noreferrer">labels guide</a>`),
  );
});

test('serve: on GitHub, links pin the scanned commit; relative links stay in the repository', async (t) => {
  const server = await startServer({
    input: 'github.com/JetBrains/example',
    open: (input) => openGitHub(input, { fetch: replay(EXAMPLE), token: 'test' }),
    port: 0,
  });
  t.after(() => server.close());
  const catalog = (await (await fetch(`${server.url}api/catalog`)).json()) as Catalog;
  assert.equal(catalog.repository.id, 'JetBrains/example');
  assert.equal(
    catalog.skills[0].link,
    `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
  );

  const base = {
    page: `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/`,
    raw: `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/`,
    directory: '.claude/skills/commits',
  };
  const { html } = renderMarkdown(
    [
      '[guide](references/guide.md#usage)',
      '[up too far](../../../../docs/a%20b.md)',
      '[root](/README.md)',
      '[site](https://example.com/x)',
      '[mail](mailto:team@example.com)',
      '[section](#usage)',
      '![diagram](img/flow.svg)',
      '![tracker](javascript:alert(1))',
    ].join('\n\n'),
    base,
  );
  const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/references/guide.md#usage`,
    `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/docs/a%20b.md`,
    `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/README.md`,
    'https://example.com/x',
    'mailto:team@example.com',
    '#usage',
    `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/img/flow.svg`,
  ]);
  assert.match(html, /<p>tracker<\/p>/);
});

test('serve: headings get unique ids for the table of contents', () => {
  const { headings } = renderMarkdown('# Use it\n## Steps\n## Steps\n### `code` and *more*', {
    page: 'https://example.com/',
    raw: 'https://example.com/',
    directory: '',
  });
  assert.deepEqual(headings, [
    { depth: 1, text: 'Use it', id: 'h-use-it' },
    { depth: 2, text: 'Steps', id: 'h-steps' },
    { depth: 2, text: 'Steps', id: 'h-steps-1' },
    { depth: 3, text: 'code and more', id: 'h-code-and-more' },
  ]);
});

test('OWNERSHIP: owner lines with single, double or no quotes; anything else is ignored', () => {
  assert.deepEqual(parseOwners("owner 'IJPL Editor'\n# a comment\nowner \"Monorepo\"\n  owner Rust Team  \nowner 'IJPL Editor'\nreviewer 'x'\n"), [
    'IJPL Editor',
    'Monorepo',
    'Rust Team',
  ]);
});

test('serve: the page and its code, a strict Content-Security-Policy, 404 for anything else', async (t) => {
  const { server } = await serveFixture(t);
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  const html = await page.text();
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(html, /<input id="query" type="search"/);
  for (const [path, type] of [
    ['app.js', 'text/javascript; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'],
  ]) {
    const asset = await fetch(`${server.url}${path}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), type);
    assert.ok((await asset.text()).length > 1000);
  }
  for (const path of ['nope', 'index.html', '../package.json', 'api/rescan']) {
    const missing = await fetch(`${server.url}${path}`);
    assert.equal(missing.status, 404, path);
    assert.match(((await missing.json()) as { error: string }).error, /^Not found: /);
  }
});

test('serve: rescan answers the new catalog; a failed rescan is a 502 and keeps the old one', async (t) => {
  let scans = 0;
  const server = await startServer({
    input: FIXTURE,
    open: async (input) => {
      scans++;
      if (scans === 3) throw new AtlasError('Cannot reach GitHub: offline');
      return openDirectory(input);
    },
    port: 0,
  });
  t.after(() => server.close());
  const first = server.catalog().scannedAt;
  const rescanned = await fetch(`${server.url}api/rescan`, { method: 'POST' });
  assert.equal(rescanned.status, 200);
  assert.equal(((await rescanned.json()) as Catalog).skills.length, 4);
  assert.equal(scans, 2);
  const kept = server.catalog().scannedAt;
  assert.ok(kept >= first);

  const failed = await fetch(`${server.url}api/rescan`, { method: 'POST' });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Cannot reach GitHub: offline' });
  assert.equal(server.catalog().scannedAt, kept);
});

test('serve: the server listens on 127.0.0.1 only', async (t) => {
  const { server } = await serveFixture(t);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
});

test('the CLI serves ./fixture, prints where, and stores nothing', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  const child = spawn(process.execPath, [CLI, 'serve', FIXTURE, '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    child.kill();
    rmSync(cwd, { recursive: true, force: true });
  });
  const line = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('\n')) resolve(out.split('\n')[0]);
    });
    child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
  });
  const match = /^fixture · 4 skills at (http:\/\/127\.0\.0\.1:\d+\/)$/.exec(line);
  assert.ok(match, line);
  const catalog = (await (await fetch(`${match[1]}api/catalog`)).json()) as Catalog;
  assert.equal(catalog.skills.length, 4);
  assert.deepEqual(readdirSync(cwd), []);
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? signal)));
  child.kill('SIGINT');
  assert.equal(await exited, 0);
});

test('serve: an unreadable repository, a bad port or a port in use → a clear message, exit code 1', async (t) => {
  const missing = spawnSync(process.execPath, [CLI, 'serve', join(FIXTURE, 'no-such-directory'), '--port', '0'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  for (const args of [['--port', 'http'], ['--port', '70000'], ['--port'], ['--verbose'], []]) {
    const bad = await atlas(['serve', ...(args.length ? [FIXTURE, ...args] : [])]);
    assert.equal(bad.code, 1, args.join(' '));
    assert.match(bad.stderr, /Usage: skill-atlas serve <GitHub URL \| directory> \[--port <n>\]$/);
  }

  const busy = createServer();
  await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
  t.after(() => busy.close());
  const { port } = busy.address() as { port: number };
  const taken = spawnSync(process.execPath, [CLI, 'serve', FIXTURE, '--port', String(port)], { encoding: 'utf8' });
  assert.equal(taken.status, 1);
  assert.match(taken.stderr, new RegExp(`Port ${port} is already in use; try --port <another>\\n$`));
});

test('serve exists only in the Node CLI; the browser entry says so', async () => {
  const browser = createBrowserBackend({ fetch: replay({}) });
  assert.equal(
    await browser.run('$ skill-atlas serve github.com/JetBrains/example'),
    'serve runs only in the command line: ./skill-atlas serve <GitHub URL | directory>',
  );
  assert.match(await browser.run('help'), /serve <GitHub URL \| directory>  browse them in a local website/);
});
