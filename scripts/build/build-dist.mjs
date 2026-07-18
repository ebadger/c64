// Deterministic production asset assembly for the c64 static web client.
//
// Assembles a clean, flattened `dist/` containing only the files the deployed site needs:
// the HTML/CSS/ES-module client, the module worker, the shared assembler pipeline, the thin
// emulator wrapper, the production Emscripten loader + WASM, the validated gallery and its
// referenced example sources, the allowlisted bundled ROM set with licenses/corresponding source,
// a license inventory, and a sha256 asset manifest. It emits no source maps, private inputs,
// proprietary Commodore ROMs, or user-supplied bytes.
//
// Base-path independence: every asset reference in the client resolves *relatively* (ES module
// specifiers and `import.meta.url` math, relative `fetch`/`new URL`, relative HTML href/src), so
// the same `dist/` works unchanged when served at localhost root (`/`) and under the GitHub Pages
// project base (`/c64/`). The build flattens the source layout (which nests the client under
// `web/client/`) into an app-rooted tree and rewrites the small, explicit set of cross-tree module
// specifiers and path constants that the flattening changes. Every rewrite is anchored: if an
// expected source string is missing the build fails loudly rather than silently shipping a broken
// path.
//
// Determinism: inputs are copied byte-for-byte; the generated manifest and notices are pure
// functions of file contents with fixed key order, LF endings, and no timestamps or commit ids, so
// repeated clean builds from the same commit/toolchain are byte-identical (WASM bytes are identical
// only to the extent the pinned Emscripten toolchain is reproducible — the caller records the
// toolchain out of band).
//
//   node scripts/build/build-dist.mjs [--out dist] [--allow-missing-wasm]
//
// It also exports buildDist() so tests can assemble into a temp directory and assert the layout.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { buildDriveRom } from "./build-drive-rom.mjs";
import { buildKernalRom } from "./build-kernal-rom.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, "..", "..");

// Content types the site expects, kept in sync with scripts/dev/serve.mjs so local dev and the
// eventual Pages deployment agree. Exported for the reference/MIME tests.
export const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".asm": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".d64": "application/octet-stream",
  ".prg": "application/octet-stream",
  ".rom": "application/octet-stream",
  ".gz": "application/gzip",
});

export function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

/**
 * One anchored rewrite: `find` MUST occur exactly once in the source; otherwise the build fails.
 * @typedef {{ find: string, replace: string }} Rewrite
 */

/**
 * The explicit, auditable set of transforms the flattening requires. Source layout -> dist layout:
 *   web/client/index.html      -> index.html            (verbatim; relative href/src)
 *   web/client/main.js         -> main.js               (repoBase -> app root)
 *   web/client/styles.css      -> styles.css            (verbatim)
 *   web/client/buildWorker.js  -> buildWorker.js        (src/index.js -> ./pipeline/index.js)
 *   web/client/gallery.json    -> gallery.json          (verbatim)
 *   web/client/lib/*.js        -> lib/*.js              (config.js, machine.js rewritten)
 *   web/emulator/c64.mjs       -> emulator/c64.mjs      (verbatim)
 *   src/*.js                   -> pipeline/*.js         (verbatim; internal relative imports)
 *   build/wasm/c64core.{mjs,wasm} -> wasm/c64core.{mjs,wasm}
 *   examples/<referenced>      -> examples/<referenced> (only gallery-referenced sources/media)
 */
const REWRITES = {
  "web/client/main.js": [
    {
      find: 'const repoBase = new URL("../../", import.meta.url); // repository root static base',
      replace: 'const repoBase = new URL("./", import.meta.url); // app root static base (dist)',
    },
    {
      find: 'import { detectBasicSysRunAddress, extractPrg, parseD64 } from "../../src/index.js";',
      replace: 'import { detectBasicSysRunAddress, extractPrg, parseD64 } from "./pipeline/index.js";',
    },
  ],
  "web/client/buildWorker.js": [
    { find: 'import { buildArtifacts } from "../../src/index.js";', replace: 'import { buildArtifacts } from "./pipeline/index.js";' },
  ],
  "web/client/lib/machine.js": [
    { find: 'import { createEmulator } from "../../emulator/c64.mjs";', replace: 'import { createEmulator } from "../emulator/c64.mjs";' },
  ],
  "web/client/lib/downloadsCore.js": [
    { find: 'import { downloadFilename } from "../../../src/prg.js";', replace: 'import { downloadFilename } from "../pipeline/prg.js";' },
  ],
  "web/client/lib/projectModel.js": [
    { find: '} from "../../../src/index.js";', replace: '} from "../pipeline/index.js";' },
  ],
  "web/client/lib/romValidate.js": [
    { find: 'import { sha256Hex } from "../../../src/hash.js";', replace: 'import { sha256Hex } from "../pipeline/hash.js";' },
  ],
  "web/client/lib/roms.js": [
    { find: 'import { sha256Hex } from "../../../src/hash.js";', replace: 'import { sha256Hex } from "../pipeline/hash.js";' },
  ],
  "web/client/lib/bundledRoms.js": [
    { find: 'import { sha256Hex } from "../../../src/hash.js";', replace: 'import { sha256Hex } from "../pipeline/hash.js";' },
  ],
  "web/client/lib/config.js": [
    { find: 'export const WASM_LOADER_PATH = "build/wasm/c64core.mjs";', replace: 'export const WASM_LOADER_PATH = "wasm/c64core.mjs";' },
    { find: 'export const EMULATOR_WRAPPER_PATH = "web/emulator/c64.mjs";', replace: 'export const EMULATOR_WRAPPER_PATH = "emulator/c64.mjs";' },
    { find: 'export const GALLERY_PATH = "web/client/gallery.json";', replace: 'export const GALLERY_PATH = "gallery.json";' },
    { find: 'export const BUNDLED_ROM_MANIFEST_PATH = "third_party/pascual-roms/manifest.json";', replace: 'export const BUNDLED_ROM_MANIFEST_PATH = "roms/manifest.json";' },
    { find: '  return new URL("../../../", moduleUrl);', replace: '  return new URL("../", moduleUrl);' },
  ],
};

const BUNDLED_ROM_SOURCE_DIR = "third_party/pascual-roms";
const BUNDLED_ROM_DIST_DIR = "roms";
const BUNDLED_ROM_ROLES = Object.freeze({
  basic: { bytes: 8192, upstreamPath: "bin/basic_c64.bin" },
  kernal: { bytes: 8192, upstreamPath: "bin/kernal_c64.bin" },
  chargen: { bytes: 4096, upstreamPath: "bin/chargen.bin" },
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeSingleFilename(path) {
  return typeof path === "string" && /^[A-Za-z0-9._-]+$/.test(path);
}

/**
 * Validate the allowlisted bundled-ROM manifest and every integrity-addressed file in a tree.
 * The returned file list is the complete subtree the production build may copy.
 */
export function verifyBundledRomAssets(root, baseDir = BUNDLED_ROM_SOURCE_DIR) {
  const base = join(resolve(root), baseDir);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  } catch (err) {
    throw new Error(`build-dist: invalid bundled ROM manifest: ${String(err && err.message ? err.message : err)}`);
  }
  if (
    !manifest || manifest.schema !== 4 || manifest.id !== "pascuals-basic-c64" ||
    manifest.upstreamRepository !== "https://github.com/Pascual-Candel-Palazon/Pascuals-BASIC" ||
    typeof manifest.title !== "string" || !/^[0-9a-f]{40}$/.test(manifest.revision || "") ||
    typeof manifest.upstreamRepository !== "string" || typeof manifest.sourceUrl !== "string" ||
    !manifest.roles || !manifest.sourceArchive || !manifest.licenses || !manifest.drive ||
    !Array.isArray(manifest.redistributionFiles)
  ) {
    throw new Error("build-dist: malformed bundled ROM manifest metadata");
  }
  const expectedSourceUrl = `${manifest.upstreamRepository}/tree/${manifest.revision}`;
  if (manifest.sourceUrl !== expectedSourceUrl) {
    throw new Error("build-dist: bundled ROM source URL does not match the pinned revision");
  }
  const roleNames = Object.keys(manifest.roles).sort();
  if (JSON.stringify(roleNames) !== JSON.stringify(Object.keys(BUNDLED_ROM_ROLES).sort())) {
    throw new Error(`build-dist: bundled ROM manifest roles must be exactly ${Object.keys(BUNDLED_ROM_ROLES).join(", ")}`);
  }

  const integrityFiles = [];
  for (const [role, expected] of Object.entries(BUNDLED_ROM_ROLES)) {
    const entry = manifest.roles[role];
    if (
      !entry || !safeSingleFilename(entry.path) || entry.bytes !== expected.bytes ||
      entry.upstreamPath !== expected.upstreamPath ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 || "")
    ) {
      throw new Error(`build-dist: invalid bundled ROM ${role} manifest entry`);
    }
    integrityFiles.push({ label: `${role} ROM`, ...entry });
    if (role === "kernal") {
      if (
        entry.basePath !== "kernal-upstream.rom" ||
        !/^[0-9a-f]{64}$/.test(entry.baseSha256 || "") ||
        !entry.patch ||
        entry.patch.path !== "kernal-c64-load-compat.patch" ||
        !Number.isSafeInteger(entry.patch.bytes) ||
        entry.patch.bytes <= 0 ||
        !/^[0-9a-f]{64}$/.test(entry.patch.sha256 || "")
      ) {
        throw new Error("build-dist: invalid bundled KERNAL compatibility metadata");
      }
      integrityFiles.push({
        label: "upstream KERNAL",
        path: entry.basePath,
        bytes: entry.bytes,
        sha256: entry.baseSha256,
      });
      integrityFiles.push({ label: "KERNAL source patch", ...entry.patch });
    }
  }
  const sourceArchive = manifest.sourceArchive;
  if (
    !safeSingleFilename(sourceArchive.path) || !sourceArchive.path.endsWith(".tar.gz") ||
    sourceArchive.path !== `pascuals-basic-${manifest.revision}.tar.gz` ||
    !Number.isSafeInteger(sourceArchive.bytes) || sourceArchive.bytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(sourceArchive.sha256 || "")
  ) {
    throw new Error("build-dist: invalid bundled ROM sourceArchive manifest entry");
  }
  integrityFiles.push({ label: "source archive", ...sourceArchive });
  const expectedLicenses = {
    package: { id: "MIT", path: "LICENSE.txt" },
    basic: { id: "MIT", path: "LICENSE-microsoft.txt" },
    chargen: {
      id: "LGPL-3.0-or-later",
      path: "COPYING.LESSER",
      companionPaths: ["COPYING", "LICENSE-megabase-notice.txt", "NOTICE.md"],
    },
  };
  if (JSON.stringify(manifest.licenses) !== JSON.stringify(expectedLicenses)) {
    throw new Error("build-dist: bundled ROM license map is incomplete or unexpected");
  }
  const expectedRedistributionPaths = [
    "LICENSE.txt",
    "LICENSE-microsoft.txt",
    "COPYING",
    "COPYING.LESSER",
    "LICENSE-megabase-notice.txt",
    "NOTICE.md",
    "PROVENANCE.md",
  ].sort();
  const redistributionPaths = [];
  for (const entry of manifest.redistributionFiles) {
    if (
      !entry || !safeSingleFilename(entry.path) ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 || "")
    ) {
      throw new Error("build-dist: invalid bundled ROM redistribution file entry");
    }
    redistributionPaths.push(entry.path);
    integrityFiles.push({ label: `redistribution file ${entry.path}`, ...entry });
  }
  if (
    new Set(redistributionPaths).size !== redistributionPaths.length ||
    JSON.stringify(redistributionPaths.sort()) !== JSON.stringify(expectedRedistributionPaths)
  ) {
    throw new Error("build-dist: bundled ROM redistribution file list is incomplete or contains extras");
  }

  const drive = manifest.drive;
  if (
    drive.id !== "pascual-dos-1541-c64" ||
    drive.upstreamRepository !== "https://github.com/Pascual-Candel-Palazon/Pascual_DOS-1541" ||
    !/^[0-9a-f]{40}$/.test(drive.revision || "") ||
    drive.sourceUrl !== `${drive.upstreamRepository}/tree/${drive.revision}` ||
    !drive.sourceArchive ||
    !drive.license ||
    !Array.isArray(drive.redistributionFiles) ||
    !drive.baseRom ||
    !drive.patch ||
    !drive.rom
  ) {
    throw new Error("build-dist: malformed bundled drive manifest metadata");
  }
  if (
    drive.sourceArchive.path !== `pascual-dos-1541-${drive.revision}.tar.gz` ||
    !Number.isSafeInteger(drive.sourceArchive.bytes) ||
    drive.sourceArchive.bytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(drive.sourceArchive.sha256 || "")
  ) {
    throw new Error("build-dist: invalid bundled drive sourceArchive manifest entry");
  }
  integrityFiles.push({ label: "drive source archive", ...drive.sourceArchive });
  if (JSON.stringify(drive.license) !== JSON.stringify({ id: "MIT", path: "LICENSE-dos1541.txt" })) {
    throw new Error("build-dist: bundled drive license entry is incomplete or unexpected");
  }
  const expectedDriveRedistributionPaths = [
    "LICENSE-dos1541.txt",
    "README-dos1541.md",
    "PROCEDENCIA-dos1541.md",
    "NOTAS-BUS-VICE-dos1541.md",
    "NOTAS-DISCO-VICE-dos1541.md",
  ].sort();
  const driveRedistributionPaths = [];
  for (const entry of drive.redistributionFiles) {
    if (
      !entry ||
      !safeSingleFilename(entry.path) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 || "")
    ) {
      throw new Error("build-dist: invalid bundled drive redistribution file entry");
    }
    driveRedistributionPaths.push(entry.path);
    integrityFiles.push({ label: `drive redistribution file ${entry.path}`, ...entry });
  }
  if (
    new Set(driveRedistributionPaths).size !== driveRedistributionPaths.length ||
    JSON.stringify(driveRedistributionPaths.sort()) !== JSON.stringify(expectedDriveRedistributionPaths)
  ) {
    throw new Error("build-dist: bundled drive redistribution file list is incomplete or contains extras");
  }
  for (const [key, expectedPath] of [["baseRom", "dos1541-upstream.rom"], ["rom", "dos1541.rom"]]) {
    const entry = drive[key];
    if (
      entry.path !== expectedPath ||
      entry.upstreamPath !== "dos.bin" ||
      entry.bytes !== 16384 ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 || "")
    ) {
      throw new Error(`build-dist: invalid bundled drive ${key} manifest entry`);
    }
    integrityFiles.push({ label: `drive ${key}`, ...entry });
  }
  if (
    drive.rom.baseSha256 !== drive.baseRom.sha256 ||
    drive.patch.path !== "dos1541-c64-wildcards.patch" ||
    !Number.isSafeInteger(drive.patch.bytes) ||
    drive.patch.bytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(drive.patch.sha256 || "")
  ) {
    throw new Error("build-dist: invalid bundled drive patch identity");
  }
  integrityFiles.push({ label: "drive source patch", ...drive.patch });

  for (const entry of integrityFiles) {
    const path = join(base, entry.path);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`build-dist: bundled ROM ${entry.label} is missing: ${entry.path}`);
    }
    const bytes = readFileSync(path);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`build-dist: bundled ROM ${entry.label} failed size/sha256 verification: ${entry.path}`);
    }
  }
  const kernal = manifest.roles.kernal;
  buildKernalRom({
    basePath: join(base, kernal.basePath),
    outputPath: join(base, kernal.path),
    check: true,
  });
  buildDriveRom({
    basePath: join(base, drive.baseRom.path),
    outputPath: join(base, drive.rom.path),
    check: true,
  });

  const files = [
    "manifest.json",
    ...Object.values(manifest.roles).map((entry) => entry.path),
    kernal.basePath,
    kernal.patch.path,
    sourceArchive.path,
    ...manifest.redistributionFiles.map((entry) => entry.path),
    drive.rom.path,
    drive.sourceArchive.path,
    ...drive.redistributionFiles.map((entry) => entry.path),
    drive.baseRom.path,
    drive.patch.path,
  ];
  if (new Set(files).size !== files.length || files.some((path) => !safeSingleFilename(path))) {
    throw new Error("build-dist: bundled ROM manifest contains duplicate or unsafe file paths");
  }
  return { manifest, files };
}

function applyRewrites(relSource, text) {
  const rewrites = REWRITES[relSource] || [];
  let out = text;
  for (const { find, replace } of rewrites) {
    const idx = out.indexOf(find);
    if (idx === -1) {
      throw new Error(`build-dist: rewrite anchor not found in ${relSource}:\n  ${find}`);
    }
    if (out.indexOf(find, idx + find.length) !== -1) {
      throw new Error(`build-dist: rewrite anchor is ambiguous (appears more than once) in ${relSource}:\n  ${find}`);
    }
    out = out.slice(0, idx) + replace + out.slice(idx + find.length);
  }
  return out;
}

/** Recursively list files under `dir` as repo-relative POSIX paths. */
function listFiles(dir, root, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) listFiles(abs, root, acc);
    else acc.push(relPosix(root, abs));
  }
  return acc;
}

function relPosix(root, abs) {
  return abs.slice(root.length + 1).split(/[\\/]/).join("/");
}

/**
 * Validate a gallery-declared repository-relative asset path (no traversal, no absolute, no
 * scheme). Mirrors web/client/lib/paths.js so the build refuses anything the client would refuse.
 */
function safeRepoRelative(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\\") || path.includes(":") || path.includes("%")) return false;
  if (path.startsWith("/") || path.includes("//")) return false;
  return path.split("/").every((seg) => seg && seg !== "." && seg !== ".." && /^[A-Za-z0-9._-]+$/.test(seg));
}

/**
 * Assemble the production dist tree.
 * @param {{ repoRoot?: string, outDir: string, requireWasm?: boolean }} opts
 * @returns {{ manifest: object, outDir: string, wasmIncluded: boolean }}
 */
export function buildDist({ repoRoot = defaultRepoRoot, outDir, requireWasm = true } = {}) {
  if (!outDir) throw new Error("build-dist: outDir is required");
  const root = resolve(repoRoot);
  const out = resolve(outDir);
  if (out === root) throw new Error("build-dist: outDir must not be the repository root");

  // Clean slate so removed inputs never linger in a release artifact.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  /** @type {{ src: string, dest: string }[]} literal file copies (dest is dist-relative POSIX) */
  const copies = [];
  /** @type {{ src: string, dest: string }[]} rewritten text copies */
  const rewrites = [];

  // Client shell + logic (flattened to the app root).
  rewrites.push({ src: "web/client/main.js", dest: "main.js" });
  rewrites.push({ src: "web/client/buildWorker.js", dest: "buildWorker.js" });
  copies.push({ src: "web/client/index.html", dest: "index.html" });
  copies.push({ src: "web/client/styles.css", dest: "styles.css" });
  copies.push({ src: "web/client/gallery.json", dest: "gallery.json" });

  // lib/ modules (config.js + machine.js are rewritten; the rest are verbatim).
  for (const rel of listFiles(join(root, "web", "client", "lib"), root)) {
    const dest = `lib/${rel.slice("web/client/lib/".length)}`;
    if (REWRITES[rel]) rewrites.push({ src: rel, dest });
    else copies.push({ src: rel, dest });
  }

  // Thin emulator wrapper + shared assembler pipeline.
  copies.push({ src: "web/emulator/c64.mjs", dest: "emulator/c64.mjs" });
  for (const rel of listFiles(join(root, "src"), root)) {
    copies.push({ src: rel, dest: `pipeline/${rel.slice("src/".length)}` });
  }

  // Production WASM artifact (required on the release path).
  const wasmLoader = "build/wasm/c64core.mjs";
  const wasmBinary = "build/wasm/c64core.wasm";
  const wasmPresent = existsSync(join(root, wasmLoader)) && existsSync(join(root, wasmBinary));
  if (!wasmPresent && requireWasm) {
    throw new Error(
      "build-dist: production WASM artifact missing (build/wasm/c64core.mjs + c64core.wasm). " +
        "Build it with scripts/build/build-wasm.sh (pinned Emscripten). Use --allow-missing-wasm " +
        "only for inspection-only dev builds, never for a release.",
    );
  }
  if (wasmPresent) {
    copies.push({ src: wasmLoader, dest: "wasm/c64core.mjs" });
    copies.push({ src: wasmBinary, dest: "wasm/c64core.wasm" });
  }

  // Gallery-referenced example sources / curated media only (never the whole examples/ tree).
  const gallery = JSON.parse(readFileSync(join(root, "web", "client", "gallery.json"), "utf8"));
  for (const entry of gallery) {
    for (const key of ["sourcePath", "curatedD64Path"]) {
      const p = entry[key];
      if (p === undefined) continue;
      if (!safeRepoRelative(p)) throw new Error(`build-dist: unsafe gallery ${key} '${p}' in entry '${entry.id}'`);
      if (!existsSync(join(root, p))) throw new Error(`build-dist: gallery ${key} '${p}' does not exist`);
      copies.push({ src: p, dest: p });
    }
  }

  // Only the reviewed, manifest-addressed ROM set and its redistribution materials.
  const bundledRoms = verifyBundledRomAssets(root);
  for (const path of bundledRoms.files) {
    copies.push({ src: `${BUNDLED_ROM_SOURCE_DIR}/${path}`, dest: `${BUNDLED_ROM_DIST_DIR}/${path}` });
  }

  // Perform copies + rewrites.
  for (const { src, dest } of copies) writeOut(root, out, src, dest, null);
  for (const { src, dest } of rewrites) {
    const text = readFileSync(join(root, src), "utf8");
    writeOut(root, out, src, dest, applyRewrites(src, text));
  }

  // License inventory + notices (generated deterministically).
  writeFileSync(join(out, "THIRD-PARTY-NOTICES.md"), thirdPartyNotices(), "utf8");

  // Manifest: sorted, content-derived, no volatile fields.
  const files = listFiles(out, out)
    .filter((p) => p !== "asset-manifest.json")
    .sort()
    .map((p) => {
      const bytes = readFileSync(join(out, p));
      return { path: p, bytes: bytes.length, sha256: sha256(bytes), contentType: contentTypeFor(p) };
    });
  const manifest = {
    manifestVersion: 1,
    generator: "scripts/build/build-dist.mjs",
    app: "c64",
    basePathIndependent: true,
    wasmIncluded: wasmPresent,
    bundledRomsIncluded: true,
    fileCount: files.length,
    files,
  };
  writeFileSync(join(out, "asset-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return { manifest, outDir: out, wasmIncluded: wasmPresent };
}

function writeOut(root, out, src, dest, textOrNull) {
  const destAbs = join(out, dest);
  mkdirSync(dirname(destAbs), { recursive: true });
  if (textOrNull === null) cpSync(join(root, src), destAbs);
  else writeFileSync(destAbs, textOrNull, "utf8");
}

function thirdPartyNotices() {
  // The runtime client and pipeline are first-party and dependency-free. Shipped third-party
  // components are the bundled ROM set and Emscripten-generated loader support. No npm runtime dependencies
  // are bundled. Playwright and the emsdk toolchain are build-time only and are never shipped.
  return [
    "# Third-party notices — c64 production bundle",
    "",
    "This document inventories third-party materials present in the deployed `dist/` bundle.",
    "The web client, the assembler/media pipeline, the emulator wrapper, and the C64 core are all",
    "first-party code in this repository and have no bundled npm runtime dependencies.",
    "",
    "## Shipped components",
    "",
    "| Component | Origin | License | In bundle |",
    "|-----------|--------|---------|-----------|",
    "| `wasm/c64core.mjs` (loader glue) | Emscripten-generated | MIT / University of Illinois/NCSA | Yes |",
    "| `wasm/c64core.wasm` | Compiled from first-party `core/` C++17 | Repository license (see CONTRIBUTING.md) | Yes |",
    "| `roms/` Pascual's BASIC/KERNAL + MEGA65 PXL chargen | Pascual-Candel-Palazon/Pascuals-BASIC, pinned revision; c64 KERNAL LOAD-compatibility patch | MIT (project KERNAL/tooling); Microsoft MIT (BASIC); LGPL-3.0-or-later (chargen) | Yes — clean-room base and patched KERNAL, complete license/notices, provenance, corresponding source |",
    "| `roms/dos1541.rom` | Pascual-Candel-Palazon/Pascual_DOS-1541, pinned revision; c64 wildcard and sequential-LOAD compatibility patches | MIT | Yes — clean-room base and patched image, source patch, complete license/provenance, corresponding source |",
    "| Web client, `lib/`, `pipeline/`, `emulator/` | First-party (this repository) | Repository license | Yes |",
    "",
    "## Build-time only (NOT shipped)",
    "",
    "| Tool | Purpose | License |",
    "|------|---------|---------|",
    "| Emscripten SDK (pinned) | Compile the C++ core to WebAssembly | MIT / University of Illinois/NCSA |",
    "| Playwright + browser binaries | Browser end-to-end tests | Apache-2.0 |",
    "| VICE `c1541` / `cc1541` | External D64 interoperability verification | GPL-2.0-or-later / permissive (recorded per run) |",
    "",
    "## Explicitly excluded",
    "",
    "- No proprietary Commodore ROM dump is committed, fetched, logged, or bundled.",
    "- No user-supplied ROM/D64 bytes are included; custom files remain local, in-memory, and private.",
    "- No source maps, tests, or private inputs are emitted into the bundle.",
    "",
  ].join("\n");
}

// CLI entry.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let outDir = join(defaultRepoRoot, "dist");
  let requireWasm = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = resolve(args[++i]);
    else if (args[i] === "--allow-missing-wasm") requireWasm = false;
    else {
      console.error(`build-dist: unknown argument '${args[i]}'`);
      process.exit(2);
    }
  }
  try {
    const { manifest, outDir: out, wasmIncluded } = buildDist({ outDir, requireWasm });
    const total = manifest.files.reduce((n, f) => n + f.bytes, 0);
    console.error(
      `dist: wrote ${manifest.fileCount} files (${total} bytes) to ${out}` +
        (wasmIncluded ? "" : "  [WARNING: WASM omitted — NOT a releasable build]"),
    );
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}
