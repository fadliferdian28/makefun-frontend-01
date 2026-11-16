// Development server for the PotScope frontend: serves app/ on the loopback
// address so the static build can be opened in a browser without a bundler.
//
//   node serve.ts             -> http://127.0.0.1:8080
//   node serve.ts --port 9000 -> http://127.0.0.1:9000
//
// Node 22, standard library only. Requests are confined to app/: any resolved
// path that escapes the directory is refused, and unknown files answer 404.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCUMENT_ROOT = resolve(fileURLToPath(new URL('./app', import.meta.url)));
const LOOPBACK_ADDRESS = '127.0.0.1';
const DEFAULT_PORT = 8080;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
]);

function readPort(argv: string[]): number {
  const flagIndex = argv.indexOf('--port');
  if (flagIndex === -1) return DEFAULT_PORT;
  const candidate = Number(argv[flagIndex + 1]);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65_535) return DEFAULT_PORT;
  return candidate;
}

function resolveRequestPath(rawPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const withIndex = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const candidate = resolve(join(DOCUMENT_ROOT, normalize(withIndex)));
  if (candidate !== DOCUMENT_ROOT && !candidate.startsWith(DOCUMENT_ROOT + sep)) return null;
  return candidate;
}

// Exported so the request routing can be exercised in-process by tests and
// sandboxes that forbid opening a listening socket.
export function createRequestHandler() {
  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end('method not allowed');
      return;
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const filePath = resolveRequestPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(400).end('bad request');
      return;
    }

    let size: number;
    try {
      const stats = statSync(filePath);
      if (!stats.isFile()) throw new Error('not a file');
      size = stats.size;
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }

    const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
    const headers = {
      'content-type': contentType,
      'content-length': String(size),
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    };

    if (request.method === 'HEAD') {
      response.writeHead(200, headers).end();
      return;
    }
    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
  };
}

const direct = resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (direct) {
  const port = readPort(process.argv.slice(2));
  const server = createServer(createRequestHandler());
  server.listen(port, LOOPBACK_ADDRESS, () => {
    console.log(`PotScope is serving app/ at http://${LOOPBACK_ADDRESS}:${port}`);
  });
}
