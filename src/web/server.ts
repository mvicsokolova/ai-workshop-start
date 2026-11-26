// `skill-atlas serve`: the catalog of one repository as a website on this machine. The page can then
// scan another GitHub repository, which becomes the current one. The scan is kept in memory while the
// server runs; nothing is written to disk.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AtlasError } from '../core/errors.ts';
import { parseGitHubUrl } from '../core/github.ts';
import type { Source } from '../core/scan.ts';
import { buildCatalog, type Catalog } from './catalog.ts';

export type ServeOptions = {
  /** What to scan: a GitHub URL or a directory. */
  input: string;
  open(input: string): Promise<Source>;
  /** 0 picks a free port. */
  port: number;
  host?: string;
};

export type RunningServer = { url: string; catalog(): Catalog; close(): Promise<void> };

/** The page and its code. */
export const PUBLIC = new URL('./public/', import.meta.url);
const ASSETS: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

/** Scans first, so a repository that cannot be read fails before the server starts. */
export async function startServer(options: ServeOptions): Promise<RunningServer> {
  let catalog = await buildCatalog(await options.open(options.input));
  /** The repository /api/rescan scans: the last one scanned successfully. */
  let current = options.input;
  /** One scan at a time: a second request while one runs is a 409. */
  let scanning = false;
  /** The origins of this server's own page, known once it listens; any other Origin may not POST. */
  const ownOrigins = new Set<string>();

  /** Scans the input; on success its catalog and the input become the current ones. */
  async function scan(input: string): Promise<Catalog> {
    scanning = true;
    try {
      const next = await buildCatalog(await options.open(input));
      catalog = next;
      current = input;
      return next;
    } finally {
      scanning = false;
    }
  }

  async function answerScan(response: ServerResponse, input: string) {
    if (scanning) return json(response, 409, { error: 'A scan is already running; try again when it ends' });
    try {
      return json(response, 200, await scan(input));
    } catch (error) {
      if (!(error instanceof AtlasError)) throw error;
      return json(response, 502, { error: error.message });
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/api/catalog' && request.method === 'GET') return json(response, 200, catalog);
    if ((pathname === '/api/rescan' || pathname === '/api/scan') && request.method === 'POST') {
      // Another site's page may POST here too: browsers send its Origin, so refuse it.
      const origin = request.headers.origin;
      if (origin !== undefined && !ownOrigins.has(origin)) {
        return json(response, 403, { error: `Only this page can scan; not ${origin}` });
      }
    }
    if (pathname === '/api/rescan' && request.method === 'POST') return answerScan(response, current);
    if (pathname === '/api/scan' && request.method === 'POST') {
      // Another site can send a "simple" text/plain POST without asking first; application/json it cannot.
      if (!isJson(request.headers['content-type'])) {
        return json(response, 415, { error: `The request must be Content-Type: application/json. ${USAGE}` });
      }
      const url = await readRepository(request);
      if ('error' in url) return json(response, 400, url);
      return answerScan(response, url.input);
    }
    const asset = ASSETS[pathname];
    if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
      const body = await readFile(new URL(asset.file, PUBLIC));
      response.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
      return response.end(request.method === 'HEAD' ? undefined : body);
    }
    json(response, 404, { error: `Not found: ${pathname}` });
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      else response.destroy();
    });
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'EADDRINUSE' ? new AtlasError(`Port ${options.port} is already in use; try --port <another>`) : error),
    );
    server.listen(options.port, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`;
  ownOrigins.add(new URL(url).origin).add(`http://localhost:${port}`).add(`http://127.0.0.1:${port}`);
  return {
    url,
    catalog: () => catalog,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const USAGE = 'Send { "url": "owner/repo" } or { "url": "https://github.com/owner/repo" }';
/** A request body larger than this many bytes is not a repository URL. */
const MAX_BODY = 4096;

/** `application/json`, with or without parameters such as `charset`. */
const isJson = (type: string | undefined) => type?.split(';')[0].trim().toLowerCase() === 'application/json';

/** The `url` of a POST /api/scan body, as the GitHub URL to open, or the 400 error. */
async function readRepository(request: IncomingMessage): Promise<{ input: string } | { error: string }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) return { error: `The request is too large. ${USAGE}` };
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    // Decoded once, so a character split across two chunks stays whole.
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { error: `The request is not JSON. ${USAGE}` };
  }
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return { error: `No repository URL. ${USAGE}` };
  const name = parseRepository(url);
  if (!name) return { error: `Not a GitHub repository: ${url}. ${USAGE}` };
  return { input: `https://github.com/${name.owner}/${name.repo}` };
}

/**
 * A GitHub repository in the page's field: `owner/repo`, or a URL as `parseGitHubUrl` reads it.
 * Never a local path: the page scans GitHub only.
 */
export function parseRepository(input: string): { owner: string; repo: string } | undefined {
  const bare = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(input.trim());
  const name = bare ? { owner: bare[1], repo: bare[2] } : parseGitHubUrl(input);
  if (!name) return undefined;
  // GitHub owners are letters, digits and inner hyphens; `.` and `..` are directories, not repositories.
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(name.owner) || /^\.+$/.test(name.repo)) return undefined;
  return name;
}

/** The page loads only its own scripts and styles; skill images may come from anywhere. */
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
