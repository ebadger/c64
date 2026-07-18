import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

import { smokePagesDeployment } from "../../scripts/dev/smoke-pages-deployment.mjs";

const CONTENT_TYPES = {
  "index.html": "text/html; charset=utf-8",
  "main.js": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "wasm/c64core.mjs": "text/javascript; charset=utf-8",
  "wasm/c64core.wasm": "application/wasm",
  "roms/manifest.json": "application/json; charset=utf-8",
  "roms/dos1541.rom": "application/octet-stream",
};
const BASE_ASSETS = {
  "index.html": Buffer.from('<!doctype html><link rel="stylesheet" href="styles.css"><script type="module" src="main.js"></script>'),
  "main.js": Buffer.from("export const ready = true;\n"),
  "styles.css": Buffer.from("body { color: #fff; }\n"),
  "wasm/c64core.mjs": Buffer.from("export default async function load() {}\n"),
  "wasm/c64core.wasm": Buffer.from([0x00, 0x61, 0x73, 0x6d]),
  "roms/manifest.json": Buffer.from('{"manifestVersion":1}\n'),
  "roms/dos1541.rom": Buffer.alloc(16_384, 0x5a),
};
const quietLogger = { log() {}, error() {} };

test("deployment smoke retries stale Pages content until the exact build is served", async (context) => {
  const current = makeDeployment();
  const stale = makeDeployment({ "main.js": Buffer.from("export const ready = false;\n") });
  const server = await startServer({
    manifestResponses: [stale.manifestBytes, current.manifestBytes],
    assets: current.assets,
    contentTypes: { ...CONTENT_TYPES, "main.js": "application/javascript" },
  });
  context.after(() => server.close());

  const result = await smokePagesDeployment({
    baseUrl: server.url,
    expectedManifestSha256: current.manifestSha256,
    attempts: 2,
    delayMs: 0,
    logger: quietLogger,
  });

  assert.equal(result.manifestSha256, current.manifestSha256);
  assert.equal(server.manifestRequestCount(), 2);
});

test("deployment smoke fails closed when only a stale healthy deployment is served", async (context) => {
  const current = makeDeployment();
  const stale = makeDeployment({ "styles.css": Buffer.from("body { color: #000; }\n") });
  const server = await startServer({
    manifestResponses: [stale.manifestBytes],
    assets: stale.assets,
  });
  context.after(() => server.close());

  await assert.rejects(
    smokePagesDeployment({
      baseUrl: server.url,
      expectedManifestSha256: current.manifestSha256,
      attempts: 2,
      delayMs: 0,
      logger: quietLogger,
    }),
    /does not match built/,
  );
  assert.equal(server.manifestRequestCount(), 2);
});

test("deployment smoke rejects partially propagated critical bytes", async (context) => {
  const current = makeDeployment();
  const corruptedAssets = { ...current.assets, "wasm/c64core.wasm": Buffer.from([0xde, 0xad]) };
  const server = await startServer({
    manifestResponses: [current.manifestBytes],
    assets: corruptedAssets,
  });
  context.after(() => server.close());

  await assert.rejects(
    smokePagesDeployment({
      baseUrl: server.url,
      expectedManifestSha256: current.manifestSha256,
      attempts: 1,
      delayMs: 0,
      logger: quietLogger,
    }),
    /wasm\/c64core\.wasm byte length/,
  );
});

test("deployment smoke rejects index references outside the exact manifest", async (context) => {
  const deployment = makeDeployment({
    "index.html": Buffer.from(
      '<!doctype html><link rel="stylesheet" href="styles.css"><script type="module" src="missing.js"></script>',
    ),
  });
  const server = await startServer({
    manifestResponses: [deployment.manifestBytes],
    assets: deployment.assets,
  });
  context.after(() => server.close());

  await assert.rejects(
    smokePagesDeployment({
      baseUrl: server.url,
      expectedManifestSha256: deployment.manifestSha256,
      attempts: 1,
      delayMs: 0,
      logger: quietLogger,
    }),
    /index\.html references unlisted asset missing\.js/,
  );
});

function makeDeployment(overrides = {}) {
  const assets = { ...BASE_ASSETS, ...overrides };
  const files = Object.entries(assets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => ({
      path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      contentType: CONTENT_TYPES[path],
    }));
  const manifest = {
    manifestVersion: 1,
    generator: "scripts/build/build-dist.mjs",
    app: "c64",
    basePathIndependent: true,
    wasmIncluded: true,
    bundledRomsIncluded: true,
    fileCount: files.length,
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return { assets, manifestBytes, manifestSha256: sha256(manifestBytes) };
}

async function startServer({ manifestResponses, assets, contentTypes = CONTENT_TYPES }) {
  let manifestRequests = 0;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const path = pathname.startsWith("/c64/") ? pathname.slice("/c64/".length) : pathname.slice(1);
    if (path === "asset-manifest.json") {
      const body = manifestResponses[Math.min(manifestRequests, manifestResponses.length - 1)];
      manifestRequests += 1;
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(body);
      return;
    }
    if (Object.hasOwn(assets, path)) {
      response.writeHead(200, { "content-type": contentTypes[path] });
      response.end(assets[path]);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/c64/`,
    manifestRequestCount: () => manifestRequests,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    }),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
