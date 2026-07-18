// Production dist-build tests. Assemble the flattened `dist/` into a temp directory and assert the
// contract from specs/WEB-CLIENT.md and the milestone-5 release requirements: base-path-independent
// (no absolute/external/escaping references), every referenced asset present, a content-derived
// sha256 manifest with correct MIME types, byte-identical repeated builds, no source maps/private
// inputs/unapproved ROMs, a restrictive CSP with no inline script/style, and a fail-not-skip WASM gate.
//
// These run under `node --test tests/` with no toolchain: the dist assembler is pure Node and the
// production WASM artifact is optional here (its presence/absence is asserted, its bytes are
// covered by the WASM parity + browser E2E gates).

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

import { buildDist, contentTypeFor, CONTENT_TYPES, verifyBundledRomAssets } from "../../scripts/build/build-dist.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function freshOut(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function listFiles(dir, root = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) listFiles(abs, root, acc);
    else acc.push(relative(root, abs).split("\\").join("/"));
  }
  return acc;
}

const TEXT_EXT = new Set([".js", ".mjs", ".html", ".css", ".json", ".md", ".asm", ".txt"]);
function isText(p) {
  return TEXT_EXT.has(extname(p).toLowerCase());
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

// Build once for the reference/manifest/MIME tests (WASM optional in this environment).
const out = freshOut("c64-dist-a-");
const { manifest, wasmIncluded } = buildDist({ repoRoot, outDir: out, requireWasm: false });
const bundledRoms = verifyBundledRomAssets(out, "roms");
const approvedRomPaths = new Set([
  ...Object.values(bundledRoms.manifest.roles).map((entry) => `roms/${entry.path}`),
  `roms/${bundledRoms.manifest.drive.rom.path}`,
  `roms/${bundledRoms.manifest.drive.baseRom.path}`,
]);

test.after(() => rmSync(out, { recursive: true, force: true }));

test("dist contains the required app-rooted layout and nothing private", () => {
  const files = new Set(listFiles(out));
  for (const required of [
    "index.html",
    "main.js",
    "styles.css",
    "buildWorker.js",
    "gallery.json",
    "lib/config.js",
    "lib/machine.js",
    "pipeline/index.js",
    "emulator/c64.mjs",
    "roms/manifest.json",
    "roms/LICENSE.txt",
    "roms/LICENSE-microsoft.txt",
    "roms/COPYING",
    "roms/COPYING.LESSER",
    "roms/LICENSE-megabase-notice.txt",
    "roms/NOTICE.md",
    "roms/PROVENANCE.md",
    `roms/${bundledRoms.manifest.sourceArchive.path}`,
    `roms/${bundledRoms.manifest.drive.rom.path}`,
    `roms/${bundledRoms.manifest.drive.baseRom.path}`,
    `roms/${bundledRoms.manifest.drive.patch.path}`,
    `roms/${bundledRoms.manifest.drive.sourceArchive.path}`,
    ...bundledRoms.manifest.drive.redistributionFiles.map((entry) => `roms/${entry.path}`),
    "asset-manifest.json",
    "THIRD-PARTY-NOTICES.md",
  ]) {
    assert.ok(files.has(required), `dist is missing required asset ${required}`);
  }
  // No source maps, unapproved ROM/binary blobs, package manifests, node_modules, or tests leak in.
  for (const p of files) {
    assert.ok(!p.endsWith(".map"), `source map must not ship: ${p}`);
    if (/\.rom$/i.test(p)) assert.ok(approvedRomPaths.has(p), `unapproved ROM must not ship: ${p}`);
    assert.ok(!/\.bin$/i.test(p), `unapproved binary blob must not ship: ${p}`);
    assert.ok(p !== "package.json" && !p.endsWith("/package.json"), `package.json must not ship: ${p}`);
    assert.ok(!p.includes("node_modules/"), `node_modules must not ship: ${p}`);
    assert.ok(!/(^|\/)tests?\//.test(p), `test files must not ship: ${p}`);
  }
});

test("no asset reference is absolute, external, protocol-relative, or escapes the app root", () => {
  // Context-aware: only flag values used as actual asset references (HTML href/src, CSS url(),
  // ES import specifiers, and `new URL(...)` first args). Plain string literals that merely
  // contain "//" or "http" as data (e.g. path-safety checks in lib/paths.js) are not references.
  const external = (v) => /^(https?:)?\/\//i.test(v); // http(s):// or protocol-relative //
  const absolute = (v) => v.startsWith("/");
  const check = (p, kind, v) => {
    assert.ok(!external(v), `${p}: ${kind} reference is external/protocol-relative: '${v}'`);
    assert.ok(!absolute(v), `${p}: ${kind} reference is an absolute path: '${v}'`);
    assert.ok(!v.includes("../../"), `${p}: ${kind} reference escapes with '../../': '${v}'`);
  };
  for (const p of listFiles(out)) {
    const ext = extname(p).toLowerCase();
    if (!isText(p)) continue;
    const text = readFileSync(join(out, p), "utf8");
    if (ext === ".html") {
      for (const m of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/g)) {
        if (m[1].startsWith("#")) continue; // in-page anchors
        check(p, "html-attr", m[1]);
      }
    } else if (ext === ".css") {
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) check(p, "css-url", m[1]);
    } else if (ext === ".js" || ext === ".mjs") {
      for (const m of text.matchAll(/new URL\(\s*["']([^"']+)["']/g)) check(p, "new-URL", m[1]);
      for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) check(p, "es-specifier", m[1]);
    }
  }
});

test("every static ES module specifier resolves to a file inside dist", () => {
  const specifier = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  for (const p of listFiles(out)) {
    if (extname(p) !== ".js" && extname(p) !== ".mjs") continue;
    // The vendored Emscripten loader (wasm/c64core.mjs) is third-party generated glue with
    // environment-guarded Node builtin imports ('module', 'fs', ...) that browsers never execute;
    // it is exempt from the first-party relative-specifier rule but still covered by the
    // absolute/external-reference check above.
    if (p.startsWith("wasm/")) continue;
    const text = readFileSync(join(out, p), "utf8");
    let m;
    while ((m = specifier.exec(text)) !== null) {
      const spec = m[1];
      assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${p}: non-relative ES specifier '${spec}'`);
      const target = resolve(dirname(join(out, p)), spec);
      const rel = relative(out, target);
      assert.ok(!rel.startsWith(".."), `${p}: specifier '${spec}' escapes dist`);
      assert.ok(existsSync(target), `${p}: specifier '${spec}' -> missing ${rel}`);
    }
  }
});

test("config path constants point at files that exist in dist", () => {
  const cfg = readFileSync(join(out, "lib", "config.js"), "utf8");
  for (const [name, expectPresent] of [
    ["gallery.json", true],
    ["emulator/c64.mjs", true],
    ["roms/manifest.json", true],
    ["wasm/c64core.mjs", wasmIncluded],
  ]) {
    assert.ok(cfg.includes(`"${name}"`), `config.js should reference '${name}'`);
    if (expectPresent) assert.ok(existsSync(join(out, name)), `dist should contain '${name}'`);
  }
});

test("asset manifest is content-accurate with correct MIME types", () => {
  const parsed = JSON.parse(readFileSync(join(out, "asset-manifest.json"), "utf8"));
  assert.equal(parsed.manifestVersion, 1);
  assert.equal(parsed.wasmIncluded, wasmIncluded);
  assert.equal(parsed.bundledRomsIncluded, true);
  const onDisk = listFiles(out).filter((p) => p !== "asset-manifest.json");
  assert.equal(parsed.fileCount, onDisk.length, "manifest fileCount matches files on disk");
  assert.deepEqual(
    parsed.files.map((f) => f.path),
    [...onDisk].sort(),
    "manifest lists exactly the files on disk, sorted",
  );
  for (const f of parsed.files) {
    const bytes = readFileSync(join(out, f.path));
    assert.equal(f.bytes, bytes.length, `${f.path}: manifest byte length`);
    assert.equal(f.sha256, createHash("sha256").update(bytes).digest("hex"), `${f.path}: manifest sha256`);
    assert.equal(f.contentType, contentTypeFor(f.path), `${f.path}: manifest contentType`);
  }
  // The manifest is a pure function of contents (also proven by the determinism test) and shares
  // the same value produced by buildDist.
  assert.equal(parsed.fileCount, manifest.fileCount);
});

test("MIME expectations match the served content types", () => {
  assert.equal(CONTENT_TYPES[".mjs"], "text/javascript; charset=utf-8");
  assert.equal(CONTENT_TYPES[".js"], "text/javascript; charset=utf-8");
  assert.equal(CONTENT_TYPES[".wasm"], "application/wasm");
  assert.equal(CONTENT_TYPES[".html"], "text/html; charset=utf-8");
  assert.equal(CONTENT_TYPES[".json"], "application/json; charset=utf-8");
  assert.equal(CONTENT_TYPES[".css"], "text/css; charset=utf-8");
  assert.equal(CONTENT_TYPES[".rom"], "application/octet-stream");
  assert.equal(CONTENT_TYPES[".gz"], "application/gzip");
});

test("index.html has the restrictive CSP and no inline script/style", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/, "CSP meta present");
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/, "script-src limited to self + wasm compile");
  assert.ok(!/'unsafe-inline'/.test(html), "no 'unsafe-inline'");
  assert.ok(!/'unsafe-eval'/.test(html), "no 'unsafe-eval'");
  // The only script is the module entry; no inline script bodies.
  assert.match(html, /<script type="module" src="main\.js"><\/script>/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S[^<]*<\/script>/.test(html), "no inline script body");
});

test("the production shell uses the breadbin and 1702-inspired emulator-first workspace", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  const css = readFileSync(join(out, "styles.css"), "utf8");

  assert.ok(html.indexOf('id="emulator"') < html.indexOf('id="ide"'), "emulator precedes the editor");
  assert.match(html, /<title>C64 Studio — 6510 Emulator &amp; Editor<\/title>/);
  assert.match(html, /<meta name="application-name" content="C64 Studio" \/>/);
  assert.match(html, /<h1>C64 Studio<\/h1>/);
  assert.match(html, /class="footer-badge">C64 Studio<\/strong>/);
  assert.equal([...html.matchAll(/class="brand-badge"/g)].length, 1, "single product badge");
  assert.equal([...html.matchAll(/class="brand-rainbow"/g)].length, 1, "single product stripe");
  assert.equal([...html.matchAll(/class="monitor-bezel"/g)].length, 1, "single monitor bezel");
  assert.equal([...html.matchAll(/class="monitor-controls" aria-hidden="true"/g)].length, 1, "decorative monitor controls");
  for (const id of [
    "btn-build-run",
    "btn-build",
    "btn-run",
    "btn-boot-basic",
    "btn-stop",
    "btn-reset",
    "btn-audio",
    "d64-file",
    "gallery-select",
    "skip-emulator-input",
    "virtual-keyboard",
    "virtual-keyboard-keys",
  ]) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, "g"))].length, 1, `${id} appears exactly once`);
  }
  assert.match(html, /id="btn-build-run"[\s\S]*aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
  assert.match(css, /--bg:\s*#1e1814;/);
  assert.match(css, /--case:\s*#c8b891;/);
  assert.match(css, /--case-light:\s*#e6d7ae;/);
  assert.match(css, /--keycap:\s*#493a33;/);
  assert.match(css, /--key-legend:\s*#f4e8c7;/);
  assert.match(css, /--monitor-case:\s*#d7c9a5;/);
  assert.match(css, /--monitor-bezel:\s*#272321;/);
  assert.match(css, /--screen-blue:\s*#403e93;/);
  assert.match(css, /--screen-ink:\s*#b7b5ff;/);
  assert.match(css, /--display:\s*"Arial Rounded MT Bold"/);
  assert.match(css, /--mono:\s*"Cascadia Mono"/);
  assert.doesNotMatch(css, /@font-face|url\(/, "shell has no external font or image dependency");
  const secondaryText = css.match(/--secondary-text:\s*(#[0-9a-f]{6});/i)?.[1];
  assert.ok(secondaryText, "secondary text color is declared");
  for (const background of ["#c8b891", "#e6d7ae"]) {
    assert.ok(
      contrastRatio(secondaryText, background) >= 4.5,
      `secondary text meets 4.5:1 contrast on ${background}`,
    );
  }
  const editorBackground = css.match(/--editor-bg:\s*(#[0-9a-f]{6});/i)?.[1];
  const editorText = css.match(/--editor-text:\s*(#[0-9a-f]{6});/i)?.[1];
  assert.ok(editorBackground && editorText, "editor color tokens are declared");
  assert.ok(contrastRatio("#f4e8c7", "#493a33") >= 4.5, "key legends contrast on keycaps");
  assert.ok(contrastRatio(editorText, editorBackground) >= 4.5, "editor text contrasts on editor");
  assert.ok(contrastRatio("#b7b5ff", "#403e93") >= 4.5, "diagnostic text contrasts on C64 blue");
  assert.match(css, /\.brand-rainbow\s*\{[^}]*linear-gradient\(/s);
  assert.match(css, /\.screen-surface\s*\{[^}]*border:\s*2px solid var\(--case-edge\);/s);
  assert.match(css, /\.monitor-bezel\s*\{[^}]*border-radius:\s*21px \/ 17px;/s);
  assert.match(css, /\.monitor-controls\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /\.monitor-door\s*\{[^}]*background:\s*linear-gradient\(/s);
  assert.match(css, /\.monitor-power-led\s*\{[^}]*background:\s*#cf4135;/s);
  assert.match(css, /\.vk-key\s*\{[^}]*background:\s*linear-gradient\(/s);
  assert.match(css, /\.editor\s*\{[^}]*background:\s*var\(--editor-bg\);/s);
  assert.match(css, /\.editor\s*\{[^}]*color:\s*var\(--editor-text\);/s);
  assert.match(css, /\.diagnostics\s*\{[^}]*background:\s*var\(--screen-blue\);/s);
  assert.match(css, /\.workspace\s*\{[^}]*display:\s*flex;/s);
  assert.match(css, /\.panel-machine\s*\{[^}]*width:\s*640px;/s);
  assert.match(css, /\.panel-editor\s*\{[^}]*max-width:\s*780px;/s);
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.ok(
    html.indexOf('id="skip-emulator-input"') < html.indexOf('id="screen-surface"')
      && html.indexOf('id="screen-surface"') < html.indexOf('id="virtual-keyboard"'),
    "focus escape, display, and virtual keyboard stay in source order",
  );
  assert.match(
    html,
    /<div class="monitor-bezel">\s*<canvas\b[^>]*\bid="screen"[^>]*><\/canvas>\s*<\/div>\s*<div class="monitor-controls" aria-hidden="true">/s,
    "the existing canvas stays nested in the monitor bezel",
  );
  assert.match(css, /\.vk-function-column\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(css, /\.vk-space-row \.space\s*\{[^}]*flex-grow:\s*6;/s);
  const narrowKeyboardStyles = css.slice(
    css.indexOf("@media (max-width: 640px)"),
    css.indexOf("@media (max-width: 480px)"),
  );
  assert.match(narrowKeyboardStyles, /\.virtual-keyboard-keys\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(narrowKeyboardStyles, /\.vk-layout\s*\{[^}]*min-width:\s*0;/s);
});

test("third-party notices inventory identifies Pascual redistribution and build-time-only tooling", () => {
  const notices = readFileSync(join(out, "THIRD-PARTY-NOTICES.md"), "utf8");
  assert.match(notices, /Pascual's BASIC\/KERNAL/);
  assert.match(notices, /Microsoft MIT/);
  assert.match(notices, /LGPL-3.0-or-later/);
  assert.match(notices, /corresponding source/);
  assert.match(notices, /Pascual_DOS-1541/);
  assert.match(notices, /wildcard patch/);
  assert.match(notices, /No proprietary Commodore ROM dump/i);
  assert.match(notices, /Emscripten/);
  assert.match(notices, /Playwright/);
  assert.match(notices, /NOT shipped/);
});

test("dist contains exactly the reviewed bundled ROM files, images, licenses, notices, and source", () => {
  const source = verifyBundledRomAssets(repoRoot);
  assert.deepEqual(bundledRoms.manifest, source.manifest);
  assert.deepEqual(
    listFiles(join(out, "roms"), out),
    source.files.map((path) => `roms/${path}`).sort(),
  );
  for (const path of source.files) {
    const expected = readFileSync(join(repoRoot, "third_party", "pascual-roms", path));
    const actual = readFileSync(join(out, "roms", path));
    assert.equal(
      createHash("sha256").update(actual).digest("hex"),
      createHash("sha256").update(expected).digest("hex"),
      path,
    );
  }
});

test("bundled ROM production verification rejects a changed role image", () => {
  const root = freshOut("c64-bundled-roms-tamper-");
  try {
    const target = join(root, "third_party", "pascual-roms");
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repoRoot, "third_party", "pascual-roms"), target, { recursive: true });
    const basicPath = join(target, bundledRoms.manifest.roles.basic.path);
    const changed = readFileSync(basicPath);
    changed[0] ^= 0xff;
    writeFileSync(basicPath, changed);
    assert.throws(() => verifyBundledRomAssets(root), /failed size\/sha256 verification/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repeated clean builds from the same tree are byte-identical", () => {
  const outB = freshOut("c64-dist-b-");
  try {
    buildDist({ repoRoot, outDir: outB, requireWasm: false });
    const a = listFiles(out);
    const b = listFiles(outB);
    assert.deepEqual(b, a, "same file set");
    for (const p of a) {
      const ha = createHash("sha256").update(readFileSync(join(out, p))).digest("hex");
      const hb = createHash("sha256").update(readFileSync(join(outB, p))).digest("hex");
      assert.equal(hb, ha, `byte-identical: ${p}`);
    }
  } finally {
    rmSync(outB, { recursive: true, force: true });
  }
});

test("the release path fails (not skips) when the production WASM artifact is missing", () => {
  const wasmPresent = existsSync(join(repoRoot, "build", "wasm", "c64core.mjs"));
  const outW = freshOut("c64-dist-w-");
  try {
    if (wasmPresent) {
      // On a full toolchain, requireWasm:true must include the artifact.
      const r = buildDist({ repoRoot, outDir: outW, requireWasm: true });
      assert.equal(r.wasmIncluded, true);
      assert.ok(existsSync(join(outW, "wasm", "c64core.wasm")));
      assert.ok(existsSync(join(outW, "wasm", "c64core.mjs")));
    } else {
      assert.throws(
        () => buildDist({ repoRoot, outDir: outW, requireWasm: true }),
        /WASM artifact missing/,
        "requireWasm must throw when the artifact is absent (CI gate fails, not skips)",
      );
    }
  } finally {
    rmSync(outW, { recursive: true, force: true });
  }
});

test("the flattened pipeline executes and reproduces the gallery buildId", async () => {
  // Prove the rewritten cross-tree specifiers resolve and run. Node treats bare `.js` as CommonJS
  // unless a package.json marks the tree as ESM; browsers do not need this. Use a throwaway copy so
  // the shipped dist stays clean (no package.json).
  const copy = freshOut("c64-dist-run-");
  try {
    cpSync(out, copy, { recursive: true });
    writeFileSync(join(copy, "package.json"), '{"type":"module"}\n');
    const { buildArtifacts } = await import(pathToFileURL(join(copy, "pipeline", "index.js")).href);
    const { makeProject } = await import(pathToFileURL(join(copy, "lib", "projectModel.js")).href);
    const gallery = JSON.parse(readFileSync(join(copy, "gallery.json"), "utf8"));
    const src = readFileSync(join(repoRoot, gallery[0].sourcePath), "utf8");
    const proj = makeProject({
      source: src,
      name: gallery[0].id,
      outputName: gallery[0].id,
      timingProfile: gallery[0].timingProfile,
    });
    const r = buildArtifacts(proj);
    assert.equal(r.ok, true);
    assert.equal(r.assembly.buildId, gallery[0].expectedBuildId, "dist pipeline reproduces the gallery buildId");
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
