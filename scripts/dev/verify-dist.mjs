// Dist integrity + smoke check for the ACTUAL assembled dist/ tree (the bytes uploaded to Pages).
//
// Complements tests/dist/ (which builds into temp dirs): this verifies the real, to-be-deployed
// dist/ directory that the release workflow uploads and deploys. It confirms:
//   - required entry files are present (index.html, main.js, the WASM loader + binary, manifest),
//   - every file listed in asset-manifest.json exists with the recorded byte length and sha256,
//   - the manifest lists exactly the files on disk (no unlisted/missing files),
//   - no source maps or ROM/binary blobs leaked in,
//   - the CSP meta and eval-free constraints hold in index.html.
//
//   node scripts/dev/verify-dist.mjs [dist-dir]
//
// Exits 0 on success; exits 1 with a clear message otherwise.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const distDir = resolve(process.argv[2] || join(repoRoot, "dist"));

function fail(msg) {
  console.error(`verify-dist: ${msg}`);
  process.exit(1);
}

function listFiles(dir, root = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) listFiles(abs, root, acc);
    else acc.push(relative(root, abs).split("\\").join("/"));
  }
  return acc;
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  fail(`dist directory not found: ${distDir} (run: node scripts/build/build-dist.mjs)`);
}

for (const req of ["index.html", "main.js", "asset-manifest.json", "wasm/c64core.mjs", "wasm/c64core.wasm"]) {
  if (!existsSync(join(distDir, req))) fail(`required dist file missing: ${req} (WASM must be present for a release build)`);
}

const manifest = JSON.parse(readFileSync(join(distDir, "asset-manifest.json"), "utf8"));
if (manifest.wasmIncluded !== true) fail("manifest.wasmIncluded is not true — not a releasable build");

const onDisk = listFiles(distDir).filter((p) => p !== "asset-manifest.json").sort();
const listed = manifest.files.map((f) => f.path).sort();
if (JSON.stringify(onDisk) !== JSON.stringify(listed)) {
  fail(`manifest file set does not match dist contents\n  on disk: ${onDisk.join(", ")}\n  listed:  ${listed.join(", ")}`);
}

for (const f of manifest.files) {
  const abs = join(distDir, f.path);
  const bytes = readFileSync(abs);
  if (bytes.length !== f.bytes) fail(`${f.path}: size ${bytes.length} != manifest ${f.bytes}`);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== f.sha256) fail(`${f.path}: sha256 mismatch`);
  if (f.path.endsWith(".map")) fail(`source map leaked into dist: ${f.path}`);
  if (/\.(rom|bin)$/i.test(f.path)) fail(`ROM/binary blob leaked into dist: ${f.path}`);
}

const html = readFileSync(join(distDir, "index.html"), "utf8");
if (!/http-equiv="Content-Security-Policy"/.test(html)) fail("index.html is missing the CSP meta tag");
if (/'unsafe-eval'/.test(html) || /'unsafe-inline'/.test(html)) fail("index.html CSP relaxes eval/inline");

const loader = readFileSync(join(distDir, "wasm", "c64core.mjs"), "utf8");
if (/\beval\s*\(/.test(loader) || /new Function\s*\(/.test(loader)) {
  fail("the WASM loader contains eval()/new Function() — rebuild with -sDYNAMIC_EXECUTION=0 for CSP compliance");
}

console.log(`verify-dist: OK — ${manifest.fileCount} files, integrity verified, WASM present, CSP intact (${distDir}).`);
