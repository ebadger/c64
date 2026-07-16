// Shared helpers for the headless WebAssembly tests.
//
// These tests load the SAME production WASM artifact the browser will use and exercise it
// through the committed web/emulator/c64.mjs wrapper, proving native/WASM parity and a working
// JavaScript boundary. Build the artifacts first (see SETUP.md):
//   emcmake cmake -S core -B build/wasm && cmake --build build/wasm
//   cmake -S core -B build/native && cmake --build build/native

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { createEmulator } from "../../web/emulator/c64.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export const wasmLoaderPath = resolve(repoRoot, "build", "wasm", "c64core.mjs");

// Locate the native scenario_dump binary produced by the native CMake build.
export function nativeScenarioDumpPath() {
  const candidates = [
    resolve(repoRoot, "build", "native", "scenario_dump.exe"),
    resolve(repoRoot, "build", "native", "scenario_dump"),
    process.env.C64_SCENARIO_DUMP ?? "",
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

export function wasmArtifactExists() {
  return existsSync(wasmLoaderPath);
}

// Load the emulator from the built WASM loader.
export async function loadEmulator() {
  const mod = await import(pathToFileURL(wasmLoaderPath).href);
  return createEmulator(mod.default);
}

// Generate the synthetic (legally-clean) ROM set identical to the C++ syntheticRomSet(), so a
// JS-driven machine and the C++ core agree on ROM identity as well as behaviour.
export function makeSyntheticRoms(resetVec = 0xc000, irqVec = 0xc100, nmiVec = 0xc200) {
  const basic = new Uint8Array(8192);
  for (let i = 0; i < basic.length; i++) basic[i] = (i * 3 + 0x11) & 0xff;
  const kernal = new Uint8Array(8192);
  for (let i = 0; i < kernal.length; i++) kernal[i] = (i * 7 + 0x22) & 0xff;
  const putVec = (addr, value) => {
    const off = addr - 0xe000;
    kernal[off] = value & 0xff;
    kernal[off + 1] = (value >> 8) & 0xff;
  };
  putVec(0xfffa, nmiVec);
  putVec(0xfffc, resetVec);
  putVec(0xfffe, irqVec);
  const chargen = new Uint8Array(4096);
  for (let i = 0; i < chargen.length; i++) chargen[i] = (i * 5 + 0x33) & 0xff;
  return { basic, kernal, chargen };
}
