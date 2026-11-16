// Development-only static file server (Node standard library only).
// Start with: node serve.ts [--port 8080]

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(import.meta.dirname, "app");

const MIME_BY_SUFFIX = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

const NOT_FOUND_BODY =
  '<!doctype html><meta charset=utf-8><title>404</title><p>Not found. <a href="/">Home</a>';

function toDiskPath(requestUrl) {
  const pathname = decodeURIComponent((requestUrl.split("?")[0] || "/"));
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  const full = join(WEB_ROOT, relative || "index.html");
  return full.startsWith(WEB_ROOT) ? full : null;
}

function contentTypeOf(file) {
  return MIME_BY_SUFFIX.get(extname(file).toLowerCase()) || "application/octet-stream";
}

export async function handle(req, res) {
  let file = toDiskPath(req.url || "/");
  if (file === null) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) {
      file = join(file, "index.html");
      await stat(file);
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": contentTypeOf(file),
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(NOT_FOUND_BODY);
  }
}

function readPort(argv) {
  let port = 8080;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if ((flag === "--port" || flag === "-p") && argv[index + 1]) {
      port = Number(argv[index + 1]);
      index += 1;
    }
  }
  return port;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = readPort(process.argv.slice(2));
  createServer(handle).listen(port, "127.0.0.1", () => {
    console.log("PotScope dev server: http://127.0.0.1:" + port);
  });
}
