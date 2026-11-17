/**
 * A tiny static server for local development: serves the app/ folder on the
 * loopback address, so a browser can open it without a build step.
 *
 * `node serve.ts` listens on http://127.0.0.1:8080 and `--port <n>` picks
 * another port. It never leaves app/, never lists a directory, and sends the
 * content types a browser needs. Node 22 standard library only.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(fileURLToPath(new URL('./app', import.meta.url)));
const LOOPBACK = '127.0.0.1';
const DEFAULT_PORT = 8080;
const MAX_PORT = 65_535;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Read `--port <n>` from the command line, falling back to the default.
 * @param {string[]} argv Arguments after the script name.
 * @returns {number}
 */
function readPort(argv: string[]): number {
  const flag = argv.indexOf('--port');
  if (flag === -1) return DEFAULT_PORT;
  const requested = Number(argv[flag + 1]);
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_PORT) return DEFAULT_PORT;
  return requested;
}

/**
 * Resolve a request path inside app/, or null when it escapes the folder.
 * @param {string} pathname Decoded request path.
 * @returns {string|null}
 */
function resolveInsideApp(pathname: string): string | null {
  const trailingSlash = pathname.endsWith('/');
  const candidate = resolve(join(APP_ROOT, normalize(trailingSlash ? `${pathname}index.html` : pathname)));
  if (candidate !== APP_ROOT && !candidate.startsWith(APP_ROOT + sep)) return null;
  return candidate;
}

/** @param {string} pathname */
function contentTypeFor(pathname: string): string {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] ?? 'application/octet-stream';
}

const port = readPort(process.argv.slice(2));

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${LOOPBACK}`);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad request');
    return;
  }

  const file = resolveInsideApp(pathname);
  if (!file) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
    return;
  }

  const stats = statSync(file, { throwIfNoEntry: false });
  if (!stats || !stats.isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypeFor(file),
    'content-length': stats.size,
    'cache-control': 'no-store',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}).listen(port, LOOPBACK, () => {
  console.log(`PotScope is on http://${LOOPBACK}:${port}`);
});
