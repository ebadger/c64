// Helpers for the browser E2E tests. These drive the real app against the ACTUAL production WASM
// artifact — assembled into the deployable `dist/` — through the dev static server. They skip
// cleanly when the artifact or Playwright (an opt-in dev-only tool) is unavailable, exactly like
// the headless WASM parity tests, UNLESS the release gate opts into strict mode (see
// requiredBrowsers): on the release path CI sets C64_E2E_REQUIRE so a missing artifact or browser
// FAILS instead of skipping.

import { existsSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildDist } from "../../scripts/build/build-dist.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export const wasmLoaderPath = resolve(repoRoot, "build", "wasm", "c64core.mjs");

export function wasmArtifactExists() {
  return existsSync(wasmLoaderPath);
}

/**
 * The browsers the release gate must exercise. C64_E2E_REQUIRE="1"|"all" requires all three;
 * a comma list (e.g. "chromium,firefox") requires exactly those. Empty/unset -> best-effort
 * (skip missing browsers), used for local developer convenience.
 * @returns {{ names: string[], strict: boolean }}
 */
export function requiredBrowsers() {
  const raw = (process.env.C64_E2E_REQUIRE || "").trim().toLowerCase();
  const all = ["chromium", "firefox", "webkit"];
  if (raw === "") return { names: all, strict: false };
  if (raw === "1" || raw === "all" || raw === "true") return { names: all, strict: true };
  return { names: raw.split(",").map((s) => s.trim()).filter(Boolean), strict: true };
}

/**
 * Load a Playwright browser type by name, or null when it (or its binary) is unavailable.
 * @param {string} name "chromium" | "firefox" | "webkit"
 */
export async function tryLoadBrowser(name) {
  try {
    const pw = await import("playwright");
    const root = pw.default && pw.default[name] ? pw.default : pw;
    return root[name] || null;
  } catch {
    return null;
  }
}

/** Back-compat: chromium loader used by the original single-browser journey test. */
export async function tryLoadPlaywright() {
  return tryLoadBrowser("chromium");
}

/**
 * Assemble the deployable dist into a temp dir (production WASM required) and return its path.
 * Throws when the WASM artifact is missing, matching the release-gate fail-not-skip contract.
 */
export function buildTempDist() {
  const outDir = mkdtempSync(join(tmpdir(), "c64-e2e-dist-"));
  buildDist({ repoRoot, outDir, requireWasm: true });
  return outDir;
}

/**
 * Produce a site root that hosts the same dist bundle at BOTH the server root ("/") and under a
 * "/c64/" project base, so one server proves base-path independence. Returns { siteRoot }.
 */
export function stageDistBasePaths(distDir) {
  const siteRoot = mkdtempSync(join(tmpdir(), "c64-e2e-site-"));
  cpSync(distDir, siteRoot, { recursive: true }); // app at "/"
  cpSync(distDir, join(siteRoot, "c64"), { recursive: true }); // app at "/c64/"
  return { siteRoot };
}

/**
 * Best-effort recursive remove that tolerates the Windows race where a just-closed browser still
 * holds a handle on a file under a temp dir (ENOTEMPTY/EBUSY). Never throws.
 */
export function safeRm(dir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {
      // brief spin; the OS releases the handle shortly after browser close
      const until = Date.now() + 150;
      while (Date.now() < until) {
        /* wait */
      }
    }
  }
}

/** Synthetic, legally-clean ROM set matching the C++ syntheticRomSet() (arrays for page.evaluate). */
export function syntheticRomArrays(resetVec = 0x080d) {
  const basic = new Array(8192);
  for (let i = 0; i < basic.length; i++) basic[i] = (i * 3 + 0x11) & 0xff;
  const kernal = new Array(8192);
  for (let i = 0; i < kernal.length; i++) kernal[i] = (i * 7 + 0x22) & 0xff;
  // Point the reset vector at the loaded program so a cold reset lands in it if needed.
  const putVec = (addr, value) => {
    const off = addr - 0xe000;
    kernal[off] = value & 0xff;
    kernal[off + 1] = (value >> 8) & 0xff;
  };
  putVec(0xfffa, 0xc200);
  putVec(0xfffc, resetVec);
  putVec(0xfffe, 0xc100);
  const chargen = new Array(4096);
  for (let i = 0; i < chargen.length; i++) chargen[i] = (i * 5 + 0x33) & 0xff;
  return { basic, kernal, chargen };
}
