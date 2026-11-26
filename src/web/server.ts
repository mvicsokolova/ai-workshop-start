// `skill-atlas serve`: the catalog of one repository as a website on this machine. The scan is kept
// in memory while the server runs; nothing is written to disk.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AtlasError } from '../core/errors.ts';
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

const PUBLIC = new URL('./public/', import.meta.url);
const ASSETS: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

/** Scans first, so a repository that cannot be read fails before the server starts. */
export async function startServer(options: ServeOptions): Promise<RunningServer> {
  let catalog = await buildCatalog(await options.open(options.input));
  let rescanning: Promise<Catalog> | undefined;

  async function rescan(): Promise<Catalog> {
    rescanning ??= (async () => buildCatalog(await options.open(options.input)))().finally(() => {
      rescanning = undefined;
    });
    catalog = await rescanning;
    return catalog;
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/api/catalog' && request.method === 'GET') return json(response, 200, catalog);
    if (pathname === '/api/rescan' && request.method === 'POST') {
      try {
        return json(response, 200, await rescan());
      } catch (error) {
        if (!(error instanceof AtlasError)) throw error;
        return json(response, 502, { error: error.message });
      }
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
  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`,
    catalog: () => catalog,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
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
