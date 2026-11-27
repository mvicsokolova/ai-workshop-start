// The Look in spec/web.md, checked on the stylesheet the real server serves and the export writes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDirectory } from '../src/local.ts';
import { startServer } from '../src/web/server.ts';
import { CLI, FIXTURE } from './helpers.ts';

const SERVE_CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'";
const EXPORT_CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'";

type Rule = { selectors: string[]; decls: [string, string][]; media?: string };

/** Enough of a CSS parser for style.css: rules, @media blocks, declarations in order. */
function parseCss(source: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (text: string, media?: string) => {
    let i = 0;
    while (true) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else if (!prelude.startsWith('@')) {
        const decls = body
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string]);
        rules.push({ selectors: prelude.split(',').map((s) => s.trim()), decls, media });
      }
      i = j;
    }
  };
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''));
  return rules;
}

async function served(t: { after(fn: () => Promise<void>): void }) {
  const server = await startServer({ input: FIXTURE, open: openDirectory, port: 0 });
  t.after(() => server.close());
  const page = await fetch(server.url);
  const css = await (await fetch(`${server.url}style.css`)).text();
  return { server, page, html: await page.text(), css, rules: parseCss(css) };
}

const declsOf = (rules: Rule[], selector: string, media?: string) =>
  rules.filter((r) => r.selectors.includes(selector) && r.media === media).flatMap((r) => r.decls);
const value = (rules: Rule[], selector: string, property: string, media?: string) =>
  declsOf(rules, selector, media).findLast(([p]) => p === property)?.[1];

function palette(rules: Rule[], theme: 'light' | 'dark') {
  return Object.fromEntries(declsOf(rules, `[data-theme="${theme}"]`).filter(([p]) => p.startsWith('--')));
}

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('look: the page links only style.css, which loads nothing from anywhere', async (t) => {
  const { html, css } = await served(t);
  assert.deepEqual([...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((l) => /rel="stylesheet"/.test(l)), [
    '<link rel="stylesheet" href="style.css">',
  ]);
  assert.doesNotMatch(html, /<style\b|\sstyle="/);
  assert.doesNotMatch(css, /@import|@font-face|url\(/i);
});

test('look: the Content-Security-Policy is unchanged, in serve and in the export', async (t) => {
  const { page } = await served(t);
  assert.equal(page.headers.get('content-security-policy'), SERVE_CSP);
  const out = mkdtempSync(join(tmpdir(), 'skill-atlas-look-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(spawnSync(process.execPath, [CLI, 'export', FIXTURE, out], { encoding: 'utf8' }).status, 0);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), new RegExp(`<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
});

test('look: no new files; the export writes the same style.css that serve answers', async (t) => {
  const { server, css } = await served(t);
  for (const path of ['', 'app.js', 'style.css']) assert.equal((await fetch(`${server.url}${path}`)).status, 200, path);
  for (const path of ['fonts/pixel.woff2', 'grass.png', 'theme.css']) assert.equal((await fetch(`${server.url}${path}`)).status, 404, path);
  const out = mkdtempSync(join(tmpdir(), 'skill-atlas-look-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(spawnSync(process.execPath, [CLI, 'export', FIXTURE, out], { encoding: 'utf8' }).status, 0);
  assert.deepEqual(readdirSync(out).sort(), ['.nojekyll', 'app.js', 'catalog.json', 'index.html', 'style.css']);
  assert.equal(readFileSync(join(out, 'style.css'), 'utf8'), css);
});

test('look: light and dark define the same earthy palette', async (t) => {
  const { rules } = await served(t);
  const light = palette(rules, 'light');
  const dark = palette(rules, 'dark');
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  for (const name of ['--bg', '--surface', '--text', '--text-soft', '--muted', '--accent', '--mark', '--grass', '--dirt', '--bevel-light', '--bevel-dark']) {
    assert.match(light[name] ?? '', /^#[0-9a-f]{6}$/, `light ${name}`);
    assert.match(dark[name] ?? '', /^#[0-9a-f]{6}$/, `dark ${name}`);
  }
  assert.equal(value(rules, '[data-theme="light"]', 'color-scheme'), 'light');
  assert.equal(value(rules, '[data-theme="dark"]', 'color-scheme'), 'dark');
});

test('look: text, marks, buttons and the header reach WCAG AA (4.5:1) in both themes', async (t) => {
  const { rules } = await served(t);
  const pairs: [string, string][] = [
    ...['--text', '--text-soft', '--muted', '--accent'].flatMap((fg) =>
      ['--bg', '--bg-elevated', '--surface', '--surface-hover', '--surface-strong', '--code-bg'].map((bg) => [fg, bg] as [string, string]),
    ),
    ['--mark-text', '--mark'],
    ['--button-text', '--button-bg'],
    ['--button-text', '--surface-hover'],
    ['--on-accent', '--accent'],
    ['--header-text', '--dirt'],
    ['--error', '--bg'],
    ['--error', '--surface'],
  ];
  for (const theme of ['light', 'dark'] as const) {
    const colours = palette(rules, theme);
    for (const [fg, bg] of pairs) {
      const ratio = contrast(colours[fg], colours[bg]);
      assert.ok(ratio >= 4.5, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    // Focus rings are not text: 3:1 against the page and the cards.
    for (const bg of ['--bg', '--surface', '--bg-elevated']) assert.ok(contrast(colours['--focus'], colours[bg]) >= 3, `${theme}: --focus on ${bg}`);
  }
  // The rules use these pairs.
  assert.equal(value(rules, 'mark', 'color'), 'var(--mark-text)');
  assert.equal(value(rules, 'mark', 'background'), 'var(--mark)');
  assert.equal(value(rules, '.button', 'color'), 'var(--button-text)');
  assert.equal(value(rules, '.button', 'background'), 'var(--button-bg)');
  assert.equal(value(rules, '.topbar', 'color'), 'var(--header-text)');
});

test('look: cards, the reader, filters, buttons and inputs are square blocks with a 2–4 px bevel', async (t) => {
  const { rules } = await served(t);
  for (const rule of rules) for (const [p, v] of rule.decls) if (p === 'border-radius') assert.equal(v, '0', rule.selectors.join(', '));
  assert.ok(!rules.some((r) => r.decls.some(([p]) => p.startsWith('--radius'))));
  assert.equal(value(rules, '*', 'border-radius'), '0');
  const px = Number(value(rules, ':root', '--px')?.replace(/px$/, ''));
  assert.ok(px >= 2 && px <= 4, `--px is ${px}`);
  assert.match(value(rules, ':root', '--bevel') ?? '', /^inset var\(--px\) var\(--px\) 0 var\(--bevel-light\), inset calc\(-1 \* var\(--px\)\) calc\(-1 \* var\(--px\)\) 0 var\(--bevel-dark\)$/);
  assert.match(value(rules, ':root', '--bevel-pressed') ?? '', /^inset var\(--px\) var\(--px\) 0 var\(--bevel-dark\), inset .* var\(--bevel-light\)$/);
  for (const selector of ['.card', '.detail', '.filters', '.button', '.icon-button', '.chip', '.select select', '.repo-form input', '.mini-search', '.search']) {
    assert.match(value(rules, selector, 'box-shadow') ?? '', /var\(--bevel(-pressed)?\)/, selector);
  }
  for (const selector of ['.button:active', '.icon-button:active:not(:disabled)', '.chip:active:not(:disabled)']) {
    assert.equal(value(rules, selector, 'box-shadow'), 'var(--bevel-pressed)', selector);
  }
});

test('look: the header is a grass-on-dirt strip drawn with CSS gradients', async (t) => {
  const { rules } = await served(t);
  const background = value(rules, '.topbar', 'background') ?? '';
  assert.match(background, /^linear-gradient\(var\(--grass-light\)[^)]*var\(--grass\)/);
  assert.match(background, /var\(--dirt-dark\)/);
  assert.match(background, /var\(--dirt\)$/);
  assert.doesNotMatch(background, /url\(/);
});

test('look: headings and labels in a monospace stack; the SKILL.md body stays easy to read', async (t) => {
  const { rules } = await served(t);
  assert.match(value(rules, ':root', '--pixel') ?? '', /, monospace$/);
  const labels = rules.find((r) => ['h1', 'h2', 'h3', 'h4', 'label', '.button', '.chip', '.tag'].every((s) => r.selectors.includes(s)));
  assert.equal(labels?.decls.find(([p]) => p === 'font-family')?.[1], 'var(--pixel)');
  assert.match(value(rules, ':root', '--font') ?? '', /sans-serif$/);
  assert.equal(value(rules, '.markdown', 'font-family'), 'var(--font)');
  assert.ok(Number(value(rules, '.markdown', 'font-size')?.replace(/px$/, '')) >= 15);
  assert.ok(Number(value(rules, '.markdown', 'line-height')) >= 1.5);
});

test('look: focus is never hidden; marks and the selected card stay distinct', async (t) => {
  const { rules } = await served(t);
  assert.match(value(rules, ':focus-visible', 'outline') ?? '', /^3px solid var\(--focus\)$/);
  // The only outline removed is the search input's, and its box shows the ring instead.
  const hidden = rules.filter((r) => r.decls.some(([p, v]) => p === 'outline' && /^(none|0)$/.test(v))).flatMap((r) => r.selectors);
  assert.deepEqual(hidden, ['.search input:focus-visible']);
  assert.match(value(rules, '.search:focus-within', 'outline') ?? '', /var\(--focus\)/);
  assert.equal(value(rules, 'mark', 'background'), 'var(--mark)');
  assert.match(value(rules, '.card.selected', 'outline') ?? '', /var\(--accent\)/);
  assert.equal(value(rules, '.card.selected', 'border-color'), 'var(--accent)');
});

test('look: prefers-reduced-motion turns every animation and transition off', async (t) => {
  const { rules, css } = await served(t);
  const media = '@media (prefers-reduced-motion: reduce)';
  assert.ok(css.includes(media));
  const everything = rules.find((r) => r.media === media && r.selectors.includes('*'));
  assert.deepEqual(everything?.selectors, ['*', '*::before', '*::after']);
  assert.equal(value(rules, '*', 'animation', media), 'none !important');
  assert.equal(value(rules, '*', 'transition', media), 'none !important');
  // There is motion to turn off.
  assert.ok(rules.some((r) => r.media === undefined && r.decls.some(([p]) => p === 'animation')));
});
