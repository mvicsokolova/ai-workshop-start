// `skill-atlas export`: the website as static files, for a host without a server such as GitHub
// Pages. The page is the one `serve` sends; the catalog is a file next to it, and there is no rescan.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AtlasError } from '../core/errors.ts';
import type { Target } from '../core/scan.ts';
import { buildCatalog, type Catalog } from './catalog.ts';
import { PUBLIC } from './server.ts';

/** No server sends headers here: the policy goes into the page. */
const CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'";

/** Scans the input and writes index.html, app.js, style.css and catalog.json into the directory. */
export async function exportSite(source: Target, directory: string): Promise<{ catalog: Catalog; files: string[] }> {
  const catalog = await buildCatalog(source);
  const out = resolve(directory);
  try {
    await mkdir(out, { recursive: true });
  } catch (error) {
    throw new AtlasError(`Cannot write to ${directory}: ${(error as Error).message}`);
  }
  const page = (await readFile(new URL('index.html', PUBLIC), 'utf8')).replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="skill-atlas-catalog" content="catalog.json">`,
  );
  const files: [string, string | Buffer][] = [
    ['index.html', page],
    ['app.js', await readFile(new URL('app.js', PUBLIC))],
    ['style.css', await readFile(new URL('style.css', PUBLIC))],
    ['catalog.json', JSON.stringify(catalog)],
    // GitHub Pages: serve the files as they are, without Jekyll.
    ['.nojekyll', ''],
  ];
  for (const [name, content] of files) await writeFile(join(out, name), content);
  return { catalog, files: files.map(([name]) => name) };
}
