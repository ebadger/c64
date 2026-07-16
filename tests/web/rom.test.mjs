// Node tests for ROM validation, set readiness, and set-id computation (memory-only).
import test from "node:test";
import assert from "node:assert/strict";

import {
  validateRomRole,
  romSetStatus,
  computeRomSetId,
  ROM_ROLES,
} from "../../web/client/lib/romValidate.js";

function rom(role, fill = 0) {
  const sizes = { basic: 8192, kernal: 8192, chargen: 4096 };
  return new Uint8Array(sizes[role]).fill(fill);
}

test("validates correct role sizes and returns a digest without exposing bytes", () => {
  for (const role of ROM_ROLES) {
    const r = validateRomRole(role, rom(role, 0x11));
    assert.equal(r.ok, true);
    assert.match(r.digest, /^[0-9a-f]{64}$/);
    assert.equal(r.requiresConfirmation, true); // unknown digest -> confirm
    assert.equal("bytes" in r, false);
  }
});

test("rejects wrong sizes with rom-size and preserves the role", () => {
  const r = validateRomRole("basic", new Uint8Array(100));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "rom-size");
  assert.equal(r.error.category, "rom");
  assert.equal(r.role, "basic");
});

test("rejects an unknown role and non-Uint8Array input", () => {
  assert.equal(validateRomRole("bogus", rom("basic")).error.code, "rom-role");
  assert.equal(validateRomRole("basic", [1, 2, 3]).error.code, "rom-read");
});

test("romSetStatus reports missing and unconfirmed roles", () => {
  const b = { ok: true, requiresConfirmation: true };
  assert.deepEqual(romSetStatus({}).missing, ["basic", "kernal", "chargen"]);
  const partial = romSetStatus({ basic: b, kernal: b });
  assert.deepEqual(partial.missing, ["chargen"]);
  assert.equal(partial.ready, false);
  const unconfirmed = romSetStatus({ basic: b, kernal: b, chargen: b });
  assert.equal(unconfirmed.complete, true);
  assert.equal(unconfirmed.ready, false);
  assert.deepEqual(unconfirmed.unconfirmed, ["basic", "kernal", "chargen"]);
  const confirmed = { ok: true, requiresConfirmation: true, confirmed: true };
  const ready = romSetStatus({ basic: confirmed, kernal: confirmed, chargen: confirmed });
  assert.equal(ready.ready, true);
});

test("computeRomSetId is deterministic and content-sensitive", () => {
  const set = { basic: rom("basic", 1), kernal: rom("kernal", 2), chargen: rom("chargen", 3) };
  const id1 = computeRomSetId(set);
  const id2 = computeRomSetId({ basic: rom("basic", 1), kernal: rom("kernal", 2), chargen: rom("chargen", 3) });
  assert.equal(id1, id2);
  assert.match(id1, /^[0-9a-f]{64}$/);
  const changed = computeRomSetId({ ...set, chargen: rom("chargen", 4) });
  assert.notEqual(id1, changed);
});

test("RomManager integrates validation, confirmation, and set readiness (memory-only)", async () => {
  const { RomManager } = await import("../../web/client/lib/roms.js");
  const mgr = new RomManager();
  assert.equal(mgr.ready(), false);
  assert.equal(mgr.getRomSet(), null);

  // Load all three roles from raw bytes (as the file picker / test hook do).
  for (const role of ROM_ROLES) {
    const res = mgr.setRoleBytes(role, rom(role, 0x11));
    assert.equal(res.ok, true, role);
    // The returned descriptor must never carry the raw bytes.
    assert.equal("bytes" in res.descriptor, false);
  }
  // Unknown digests require confirmation, so the set is complete but not ready yet.
  const before = mgr.status();
  assert.equal(before.complete, true);
  assert.equal(before.ready, false);
  assert.deepEqual(before.unconfirmed, ["basic", "kernal", "chargen"]);

  for (const role of ROM_ROLES) mgr.confirmRole(role);
  assert.equal(mgr.ready(), true);

  const set = mgr.getRomSet();
  assert.ok(set && set.basic.length === 8192 && set.kernal.length === 8192 && set.chargen.length === 4096);
  assert.match(set.id, /^[0-9a-f]{64}$/);

  // A wrong-sized role is rejected and does not corrupt the ready set.
  assert.equal(mgr.setRoleBytes("basic", new Uint8Array(10)).ok, false);
});
