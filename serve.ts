// serve.ts — tiny static server for local dev. Node 22 stdlib only.
// Usage: node serve.ts [--port 8080]

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "app");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function safePath(urlPath: string): string | null {
  const pathname = decodeURIComponent((urlPath.split("?")[0] || "/"));
  const rel = normalize(pathname).replace(/^([/\\])+/, "");
  const full = join(root, rel || "index.html");
  if (!full.startsWith(root)) return null;
  return full;
}

export async function handle(req, res) {
  const url = req.url || "/";
  let file = safePath(url);
  if (!file) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file);
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset=utf-8><title>404</title><p>Not found. <a href=\"/\">Home</a>");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let port = 8080;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) port = Number(args[++i]);
  }
  const server = createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    console.log("PotScope dev server: http://127.0.0.1:" + port);
  });
}
