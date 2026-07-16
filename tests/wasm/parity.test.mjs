// Native/WASM parity: the native scenario_dump binary and the WASM build run the identical C++
// scenario suite; their canonical JSON must be byte-identical. This proves the same behaviour on
// CPU traces, PRG loading, bus banking, resets, errors, and repeated-run determinism.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { loadEmulator, nativeScenarioDumpPath, wasmArtifactExists } from "./helpers.mjs";

test("native and WASM scenario suites are byte-identical", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built (run: emcmake cmake -S core -B build/wasm && cmake --build build/wasm)");
    return;
  }
  const dump = nativeScenarioDumpPath();
  if (!dump) {
    t.skip("native scenario_dump not built (run: cmake -S core -B build/native && cmake --build build/native)");
    return;
  }

  const nativeJson = execFileSync(dump, [], { encoding: "utf8" }).trim();
  const emu = await loadEmulator();
  const wasmJson = emu.allScenariosJson().trim();

  // Byte-identical raw strings — the strongest parity assertion.
  assert.equal(wasmJson, nativeJson, "native and WASM scenario JSON differ");

  // And structurally valid.
  const parsed = JSON.parse(wasmJson);
  assert.ok(Array.isArray(parsed) && parsed.length >= 10);
});

test("determinism scenario reports identical repeated runs (WASM)", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built");
    return;
  }
  const emu = await loadEmulator();
  const result = emu.scenario("determinism");
  assert.equal(result.identical, true);
});

test("per-scenario native/WASM parity", async (t) => {
  if (!wasmArtifactExists() || !nativeScenarioDumpPath()) {
    t.skip("artifacts not built");
    return;
  }
  const dump = nativeScenarioDumpPath();
  const emu = await loadEmulator();
  for (const id of emu.scenarioIds()) {
    const nativeOne = execFileSync(dump, [id], { encoding: "utf8" }).trim();
    const wasmOne = emu.scenario(id);
    assert.deepEqual(wasmOne, JSON.parse(nativeOne), `scenario '${id}' differs`);
  }
});
