// Release-gate guard: FAIL (never skip) when a required production artifact is missing.
//
// The WASM parity, browser E2E, and dist tests skip cleanly for local developer convenience when
// the production WebAssembly artifact is absent. On the release path that silent skip is not
// acceptable — a missing artifact means the build did not actually run. CI invokes this guard after
// the native + WASM builds so the pipeline fails loudly if the artifact was not produced.
//
//   node scripts/dev/require-release-artifacts.mjs
//
// Exits 0 when every required artifact exists; exits 1 (with a clear message) otherwise.

import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const required = [
  { path: "build/wasm/c64core.mjs", minBytes: 1024, what: "Emscripten ES loader" },
  { path: "build/wasm/c64core.wasm", minBytes: 1024, what: "compiled WebAssembly core" },
];

let ok = true;
for (const { path, minBytes, what } of required) {
  const abs = join(repoRoot, path);
  if (!existsSync(abs)) {
    console.error(`MISSING required release artifact: ${path} (${what}). Build it with scripts/build/build-wasm.sh (pinned Emscripten).`);
    ok = false;
    continue;
  }
  const size = statSync(abs).size;
  if (size < minBytes) {
    console.error(`TRUNCATED release artifact: ${path} is ${size} bytes (< ${minBytes}).`);
    ok = false;
    continue;
  }
  console.log(`ok: ${path} (${size} bytes)`);
}

if (!ok) {
  console.error("Release artifacts are missing or truncated; failing the release gate (this must NOT be skipped).");
  process.exit(1);
}
console.log("All required release artifacts are present.");
