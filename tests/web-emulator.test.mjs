import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMachine,
  categoryForReason,
  MACHINE_METHODS,
  UNAVAILABLE_REASONS,
  C64_DISPLAY,
} from "../web/modules/emulatorBridge.v1.js";

function fakeMachine(omit = []) {
  const machine = { ok: () => true, configError: () => null };
  for (const name of MACHINE_METHODS) {
    if (!omit.includes(name)) machine[name] = () => 0;
  }
  return machine;
}

test("with no module factory the emulator is unavailable (core missing) and fabricates nothing", async () => {
  const result = await createMachine({});
  assert.equal(result.available, false);
  assert.equal(result.reason, UNAVAILABLE_REASONS.coreMissing);
  assert.equal(result.machine, null);
  assert.deepEqual(result.display, C64_DISPLAY);
});

test("a module without a Machine class is incompatible", async () => {
  const result = await createMachine({ createCore: async () => ({}) });
  assert.equal(result.reason, UNAVAILABLE_REASONS.incompatible);
});

test("a Machine missing required methods is incompatible and is deleted (no native leak)", async () => {
  let deleted = false;
  const result = await createMachine({
    createCore: async () => ({
      Machine: function () {
        Object.assign(this, fakeMachine(["framebuffer"]));
        this.delete = () => { deleted = true; };
      },
    }),
  });
  assert.equal(result.reason, UNAVAILABLE_REASONS.incompatible);
  assert.equal(deleted, true, "a constructed instance must be delete()d on a failure path");
});

test("a complete Machine makes the core available (v0 needs no ROM to construct)", async () => {
  let seenProfile = null;
  const result = await createMachine({
    createCore: async () => ({ Machine: function (profile) { seenProfile = profile; Object.assign(this, fakeMachine()); } }),
    timingProfile: "ntsc-6567r8",
  });
  assert.equal(result.available, true);
  assert.equal(result.reason, null);
  assert.ok(result.machine);
  assert.equal(seenProfile, "ntsc-6567r8");
});

test("the timing profile is passed through unchanged (core validates via ok()); undefined defaults to PAL", async () => {
  let seenProfile = "unset";
  await createMachine({
    createCore: async () => ({ Machine: function (profile) { seenProfile = profile; Object.assign(this, fakeMachine()); } }),
    timingProfile: "bogus",
  });
  assert.equal(seenProfile, "bogus", "invalid profiles are not silently coerced");

  seenProfile = "unset";
  await createMachine({
    createCore: async () => ({ Machine: function (profile) { seenProfile = profile; Object.assign(this, fakeMachine()); } }),
  });
  assert.equal(seenProfile, "pal-6569", "an absent profile defaults to PAL");
});

test("a Machine reporting ok()===false is unavailable and deleted, not available", async () => {
  let deleted = false;
  const result = await createMachine({
    createCore: async () => ({
      Machine: function () {
        Object.assign(this, fakeMachine());
        this.ok = () => false;
        this.configError = () => "invalid-config";
        this.delete = () => { deleted = true; };
      },
    }),
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, UNAVAILABLE_REASONS.moduleError);
  assert.match(result.message, /invalid-config/);
  assert.equal(deleted, true);
});

test("categoryForReason maps rom vs wasm", () => {
  assert.equal(categoryForReason(UNAVAILABLE_REASONS.romMissing), "rom");
  assert.equal(categoryForReason(UNAVAILABLE_REASONS.coreMissing), "wasm");
  assert.equal(categoryForReason(UNAVAILABLE_REASONS.incompatible), "wasm");
});
