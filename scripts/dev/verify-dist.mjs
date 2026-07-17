// Dist integrity + smoke check for the ACTUAL assembled dist/ tree (the bytes uploaded to Pages).
//
// Complements tests/dist/ (which builds into temp dirs): this verifies the real, to-be-deployed
// dist/ directory that the release workflow uploads and deploys. It confirms:
//   - required entry files are present (index.html, main.js, the WASM loader + binary, manifest),
//   - every file listed in asset-manifest.json exists with the recorded byte length and sha256,
//   - the manifest lists exactly the files on disk (no unlisted/missing files),
//   - the only ROM images are the exact allowlisted bundled files with corresponding source,
//   - no source maps or unapproved binary blobs leaked in,
//   - the CSP meta and eval-free constraints hold in index.html.
//
//   node scripts/dev/verify-dist.mjs [dist-dir]
//
// Exits 0 on success; exits 1 with a clear message otherwise.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { verifyBundledRomAssets } from "../build/build-dist.mjs";

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

for (const req of ["index.html", "main.js", "asset-manifest.json", "wasm/c64core.mjs", "wasm/c64core.wasm", "roms/manifest.json"]) {
  if (!existsSync(join(distDir, req))) fail(`required dist file missing: ${req} (WASM must be present for a release build)`);
}

const manifest = JSON.parse(readFileSync(join(distDir, "asset-manifest.json"), "utf8"));
if (manifest.wasmIncluded !== true) fail("manifest.wasmIncluded is not true — not a releasable build");
if (manifest.bundledRomsIncluded !== true) fail("manifest.bundledRomsIncluded is not true — approved ROMs are missing");

let sourceBundledRoms;
let distBundledRoms;
try {
  sourceBundledRoms = verifyBundledRomAssets(repoRoot);
  distBundledRoms = verifyBundledRomAssets(distDir, "roms");
} catch (err) {
  fail(String(err && err.message ? err.message : err));
}
if (JSON.stringify(distBundledRoms.manifest) !== JSON.stringify(sourceBundledRoms.manifest)) {
  fail("dist bundled-ROM manifest differs from the reviewed source manifest");
}
const approvedRomPaths = new Set([
  ...Object.values(sourceBundledRoms.manifest.roles).map((entry) => `roms/${entry.path}`),
  `roms/${sourceBundledRoms.manifest.drive.rom.path}`,
  `roms/${sourceBundledRoms.manifest.drive.baseRom.path}`,
]);
const expectedRomFiles = sourceBundledRoms.files.map((path) => `roms/${path}`).sort();
const actualRomFiles = listFiles(join(distDir, "roms"), distDir).sort();
if (JSON.stringify(actualRomFiles) !== JSON.stringify(expectedRomFiles)) {
  fail(`roms subtree is not the exact approved file set\n  actual: ${actualRomFiles.join(", ")}\n  expected: ${expectedRomFiles.join(", ")}`);
}
for (const path of expectedRomFiles) {
  const source = readFileSync(join(repoRoot, "third_party", "pascual-roms", path.slice("roms/".length)));
  const deployed = readFileSync(join(distDir, path));
  if (sha256(source) !== sha256(deployed)) fail(`${path}: deployed file differs from reviewed source`);
}

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
  if (/\.rom$/i.test(f.path) && !approvedRomPaths.has(f.path)) fail(`unapproved ROM leaked into dist: ${f.path}`);
  if (/\.bin$/i.test(f.path)) fail(`unapproved binary blob leaked into dist: ${f.path}`);
}

const html = readFileSync(join(distDir, "index.html"), "utf8");
if (!/http-equiv="Content-Security-Policy"/.test(html)) fail("index.html is missing the CSP meta tag");
if (/'unsafe-eval'/.test(html) || /'unsafe-inline'/.test(html)) fail("index.html CSP relaxes eval/inline");

const loader = readFileSync(join(distDir, "wasm", "c64core.mjs"), "utf8");
if (/\beval\s*\(/.test(loader) || /new Function\s*\(/.test(loader)) {
  fail("the WASM loader contains eval()/new Function() — rebuild with -sDYNAMIC_EXECUTION=0 for CSP compliance");
}

console.log(`verify-dist: OK — ${manifest.fileCount} files, integrity verified, bundled ROMs + source present, WASM present, CSP intact (${distDir}).`);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
