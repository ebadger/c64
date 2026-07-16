// Headless WASM smoke test: runs the SAME production WebAssembly artifact the browser will load,
// against the SAME assembler-generated fixture used by the native golden test. This protects the
// product critical path end to end (assemble -> load PRG -> run -> observe framebuffer/registers)
// through the real embind boundary.
//
// The test SKIPS when the WASM artifact has not been built, so `node --test tests/` stays green
// in environments without the Emscripten toolchain. Build it first per SETUP.md:
//   emcmake cmake -S core -B core/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
//   cmake --build core/build-wasm

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const loaderPath = join(repoRoot, "core", "build-wasm", "c64core.js");
const fixturePath = join(repoRoot, "core", "tests", "fixtures", "border_bg_fixture.json");

const skip = existsSync(loaderPath)
  ? false
  : "core/build-wasm/c64core.js not built — see SETUP.md (Emscripten WASM build)";

test("headless WASM core renders the border/background fixture", { skip }, async () => {
  const createC64Core = (await import(pathToFileURL(loaderPath).href)).default;
  const mod = await createC64Core();
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

  const machine = new mod.Machine(fixture.timingProfile);
  try {
    const load = machine.loadPrg(Uint8Array.from(fixture.prg));
    assert.equal(load.ok, true);
    assert.equal(load.loadAddress, fixture.loadAddress);

    machine.setPC(fixture.runAddress);
    machine.runFrame();

    const fb = machine.framebuffer();
    assert.equal(fb.length, fixture.expected.width * fixture.expected.height);
    assert.equal(fb[fixture.expected.borderSample.index], fixture.expected.border);
    assert.equal(fb[fixture.expected.centreSample.index], fixture.expected.background);

    assert.equal(machine.readMem(0xd020) & 0x0f, fixture.expected.border);
    assert.equal(machine.readMem(0xd021) & 0x0f, fixture.expected.background);

    assert.equal(machine.frameWidth(), fixture.expected.width);
    assert.equal(machine.frameHeight(), fixture.expected.height);
  } finally {
    machine.delete(); // free the embind-owned C++ instance
  }
});
