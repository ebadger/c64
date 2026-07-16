// Dependency-light static file server for local development and E2E of the c64 web client.
// Serves the repository root so /web/client/, /src/, /web/emulator/, /examples/, and /build/wasm/
// are same-origin. It sets correct MIME types (application/wasm, text/javascript) and echoes the
// same restrictive CSP the app declares. No runtime dependency, no write endpoints, no secrets.
//
//   node scripts/dev/serve.mjs [--port 8080] [--root <dir>]
//   PORT=8080 node scripts/dev/serve.mjs
//
// It exports startServer() so E2E can launch it in-process on an ephemeral port.

import http from "node:http";
import { createReadStream, existsSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve, sep, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; " +
  "style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".asm": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".prg": "application/octet-stream",
  ".d64": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".rom": "application/octet-stream",
  ".gz": "application/gzip",
};

function contentType(path) {
  return MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

/**
 * Resolve a URL path to a safe absolute file path within `root`, or null if it escapes.
 */
function safePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  // Normalize and re-root; reject anything that climbs above root.
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

function handler(root) {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end("Method Not Allowed");
      return;
    }
    let abs = safePath(root, req.url || "/");
    if (!abs) {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      abs = join(abs, "index.html");
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    // Canonicalize to defeat symlink/junction escapes: statSync/createReadStream follow links, so
    // re-check containment on the real (resolved) paths, not just the lexical ones.
    let realAbs;
    let realRoot;
    try {
      realAbs = realpathSync(abs);
      realRoot = realpathSync(root);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(realAbs),
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(realAbs).pipe(res);
  };
}

/**
 * Start the static server. Returns { server, port, url } once listening.
 * @param {{ port?: number, root?: string, host?: string }} [opts]
 */
export function startServer({ port = 0, root = repoRoot, host = "127.0.0.1" } = {}) {
  const server = http.createServer(handler(resolve(root)));
  return new Promise((resolvePromise) => {
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolvePromise({ server, port: actual, url: `http://${host}:${actual}` });
    });
  });
}

// CLI entry.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let port = Number(process.env.PORT || 8080);
  let root = repoRoot;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") port = Number(args[++i]);
    else if (args[i] === "--root") root = resolve(args[++i]);
  }
  startServer({ port, root }).then(({ url }) => {
    console.log(`c64 dev server: ${url}/web/client/  (root: ${root})`);
    console.log("Press Ctrl+C to stop.");
  });
}
