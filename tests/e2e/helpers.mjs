// Helpers for the browser E2E tests. These drive the real app against the ACTUAL production WASM
// artifact through the dev static server. They skip cleanly when the artifact or Playwright (an
// opt-in dev-only tool) is unavailable, exactly like the headless WASM parity tests.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export const wasmLoaderPath = resolve(repoRoot, "build", "wasm", "c64core.mjs");

export function wasmArtifactExists() {
  return existsSync(wasmLoaderPath);
}

/** Dynamically import Playwright's chromium, or null when it is not installed. */
export async function tryLoadPlaywright() {
  try {
    const pw = await import("playwright");
    return pw.chromium || (pw.default && pw.default.chromium) || null;
  } catch {
    return null;
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
