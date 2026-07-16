import test from "node:test";
import assert from "node:assert/strict";

import { MachineController } from "../../web/client/lib/machine.js";

function fakeController() {
  const calls = [];
  const machine = {
    configureError: "none",
    ready: () => true,
    reset: (kind) => {
      calls.push(["reset", kind]);
      return "none";
    },
    loadPrg: (prg) => {
      calls.push(["loadPrg", [...prg]]);
      return { ok: true, loadAddress: 0x0801, endAddressExclusive: 0x0803 };
    },
    setProgramCounter: (pc) => calls.push(["setProgramCounter", pc]),
    romSetId: () => "rom-set",
    dispose: () => calls.push(["dispose"]),
  };
  const emulator = {
    createMachine: () => {
      calls.push(["createMachine"]);
      return machine;
    },
  };
  const controller = new MachineController(emulator);
  const configured = controller.configure({
    timingProfile: "pal-6569",
    sidModel: "6581",
    roms: {
      basic: new Uint8Array(8192),
      kernal: new Uint8Array(8192),
      chargen: new Uint8Array(4096),
    },
  });
  assert.equal(configured.ok, true);
  calls.length = 0;
  return { controller, calls };
}

test("Boot BASIC resets at the ROM vector without loading a PRG or overriding PC", () => {
  const { controller, calls } = fakeController();
  assert.deepEqual(controller.bootBasic(), { ok: true, error: null });
  assert.deepEqual(calls, [["reset", "power-on"]]);
});

test("direct-entry Run still resets, loads the PRG, and overrides PC", () => {
  const { controller, calls } = fakeController();
  const result = controller.loadAndEnter(Uint8Array.from([0x01, 0x08, 0x60]), {
    runAddress: 0xc000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ["reset", "power-on"],
    ["loadPrg", [0x01, 0x08, 0x60]],
    ["setProgramCounter", 0xc000],
  ]);
});
