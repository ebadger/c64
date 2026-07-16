// Headless WASM smoke test: drive the Machine API through the committed ES-module wrapper,
// exercising the full JavaScript -> embind -> C++ boundary that the browser will use.
import test from "node:test";
import assert from "node:assert/strict";

import { loadEmulator, makeSyntheticRoms, wasmArtifactExists } from "./helpers.mjs";

test("configure, load PRG, run, and inspect via WASM", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built");
    return;
  }
  const emu = await loadEmulator();
  const machine = emu.createMachine();
  try {
    const roms = makeSyntheticRoms(0xc000, 0xc100, 0xc200);
    const err = machine.configure({ timingProfile: "pal-6569", ...roms });
    assert.equal(err, "none");
    assert.equal(machine.ready(), true);
    assert.equal(machine.cpuState().pc, 0xc000); // reset vector

    // ROM identity matches the C++ rom-identity scenario (cross-language SHA-256 parity).
    const idScenario = emu.scenario("rom-identity");
    const idRoms = makeSyntheticRoms(0xfce2, 0xff48, 0xfe43);
    const m2 = emu.createMachine();
    try {
      m2.configure({ timingProfile: "pal-6569", ...idRoms });
      assert.equal(m2.romSetId(), idScenario.id);
    } finally {
      m2.dispose();
    }

    // LDA #$2A; STA $30; BRK  at $C000, then run.
    const prg = Uint8Array.from([0x00, 0xc0, 0xa9, 0x2a, 0x85, 0x30, 0x00]);
    const load = machine.loadPrg(prg);
    assert.equal(load.ok, true);
    assert.equal(load.loadAddress, 0xc000);

    machine.setProgramCounter(0xc000);
    const run = machine.runCycles(100);
    assert.equal(run.stopReason, "brk");
    assert.equal(machine.debugReadRam(0x30), 0x2a);

    // Banking region + honest device availability.
    assert.equal(machine.regionOf(0xa000), "basic-rom");
    const status = machine.deviceStatus();
    assert.equal(status.vic, false);
    assert.equal(status.sid, false);
    assert.equal(machine.copyFramebuffer(), "unavailable");
    assert.equal(machine.mountD64(new Uint8Array(0)), "unavailable");

    // reset accepts the two kinds and rejects an unknown one without destroying state.
    machine.debugWriteRam(0x40, 0x77);
    assert.equal(machine.reset("warm"), "none");
    assert.equal(machine.debugReadRam(0x40), 0x77); // warm preserved RAM
    assert.equal(machine.reset("bogus"), "invalid-state"); // no silent power-on
    assert.equal(machine.debugReadRam(0x40), 0x77); // still preserved
    assert.equal(machine.reset("power-on"), "none");
  } finally {
    machine.dispose();
  }
});

test("createMachine(config) configures atomically (WASM)", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built");
    return;
  }
  const emu = await loadEmulator();
  const machine = emu.createMachine({ timingProfile: "pal-6569", ...makeSyntheticRoms() });
  try {
    assert.equal(machine.configureError, "none");
    assert.equal(machine.ready(), true);
    assert.equal(machine.cpuState().pc, 0xc000);
  } finally {
    machine.dispose();
  }
});

test("invalid configuration returns a stable error code (WASM)", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built");
    return;
  }
  const emu = await loadEmulator();
  const machine = emu.createMachine();
  try {
    const roms = makeSyntheticRoms();
    assert.equal(machine.configure({ timingProfile: "pal-6572", ...roms }), "invalid-config");
    // Incomplete ROM set.
    assert.equal(
      machine.configure({ timingProfile: "pal-6569", basic: new Uint8Array(10), kernal: roms.kernal, chargen: roms.chargen }),
      "rom-size",
    );
  } finally {
    machine.dispose();
  }
});
