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

    // Banking region + implemented device status (milestone 3).
    assert.equal(machine.regionOf(0xa000), "basic-rom");
    const status = machine.deviceStatus();
    assert.equal(status.vic, true);
    assert.equal(status.sid, true);
    assert.equal(status.cia1, true);
    assert.equal(status.cia2, true);

    // Framebuffer copy returns an owned Uint8Array of indexed pixels.
    const frame = machine.copyFramebuffer();
    assert.ok(frame.width > 0 && frame.height > 0);
    assert.equal(frame.pixels.length, machine.framebufferSize());
    assert.ok(frame.pixels instanceof Uint8Array);

    // Audio drain returns an owned Float32Array and sane metadata.
    const audio = machine.drainAudio(256);
    assert.ok(audio.sampleRate > 0);
    assert.ok(audio.samples instanceof Float32Array);

    // Input is accepted through the bridge.
    assert.equal(machine.setInput({ keyboardColumns: new Uint8Array(8).fill(0xff) }), "none");

    // A malformed D64 is rejected (never mounted).
    const mount = machine.mountD64(new Uint8Array(10));
    assert.equal(mount.ok, false);
    assert.equal(mount.errorCode, "unsupported-geometry");

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

test("mount a JS-built D64 and LOAD it through the WASM boundary", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built");
    return;
  }
  const { buildD64 } = await import("../../src/d64.js");
  // A valid D64 with one PRG file "PROG" that loads to $0801.
  const prg = Uint8Array.from([0x01, 0x08, 0x11, 0x22, 0x33, 0x44]);
  const built = buildD64({ outputName: "PROG", diskName: "TESTDISK", diskId: "ID" }, prg);
  assert.equal(built.ok, true, built.error?.message);

  const emu = await loadEmulator();
  const machine = emu.createMachine({ timingProfile: "pal-6569", ...makeSyntheticRoms() });
  try {
    const mount = machine.mountD64(built.d64);
    assert.equal(mount.ok, true, mount.errorMessage);
    assert.equal(mount.fileCount, 1);
    assert.equal(machine.diskMounted(), true);

    // Set up the KERNAL LOAD zero page (as SETNAM/SETLFS would) and JSR $FFD5.
    const name = "PROG";
    for (let i = 0; i < name.length; i++) machine.debugWriteRam(0x0500 + i, name.charCodeAt(i));
    machine.debugWriteRam(0xb7, name.length); // filename length
    machine.debugWriteRam(0xbb, 0x00);        // filename ptr lo
    machine.debugWriteRam(0xbc, 0x05);        // filename ptr hi
    machine.debugWriteRam(0xb9, 0x01);        // secondary address 1
    machine.debugWriteRam(0xba, 0x08);        // device 8
    // JSR $FFD5; BRK at $C000.
    machine.loadPrg(Uint8Array.from([0x00, 0xc0, 0x20, 0xd5, 0xff, 0x00]));
    machine.setProgramCounter(0xc000);
    machine.runCycles(3000);

    assert.equal(machine.debugReadRam(0x0801), 0x11);
    assert.equal(machine.debugReadRam(0x0804), 0x44);
    const st = machine.cpuState();
    assert.equal(st.x, 0x05); // end address low
    assert.equal(st.y, 0x08); // end address high

    const beforeEject = machine.cpuState();
    assert.equal(machine.unmountD64(), "none");
    assert.equal(machine.diskMounted(), false);
    assert.deepEqual(machine.cpuState(), beforeEject, "eject does not reset CPU state");
    assert.equal(machine.debugReadRam(0x0801), 0x11, "eject does not reset RAM");
    assert.equal(machine.unmountD64(), "none", "eject is idempotent");
  } finally {
    machine.dispose();
  }
});
