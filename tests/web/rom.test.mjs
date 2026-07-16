// Node tests for ROM validation, set readiness, and set-id computation (memory-only).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  validateRomRole,
  romSetStatus,
  computeRomSetId,
  ROM_ROLES,
} from "../../web/client/lib/romValidate.js";
import { RomManager } from "../../web/client/lib/roms.js";
import { loadBundledRomSet, validateBundledRomManifest } from "../../web/client/lib/bundledRoms.js";

const bundledRomsDir = new URL("../../third_party/pascual-roms/", import.meta.url);
const bundledManifest = JSON.parse(readFileSync(new URL("manifest.json", bundledRomsDir), "utf8"));

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

test("RomManager becomes ready after confirming a complete unknown-digest set (Run enablement)", () => {
  // Regression: setRoleBytes must store an accepted descriptor that romSetStatus keys readiness
  // off. A prior defect stored the descriptor without `ok`, so readiness was permanently false and
  // Run could never be enabled with user-supplied ROMs (the only supported case today).
  const rm = new RomManager();
  assert.equal(rm.ready(), false);
  for (const role of ROM_ROLES) {
    const res = rm.setRoleBytes(role, rom(role, 0x11 + ROM_ROLES.indexOf(role)));
    assert.equal(res.ok, true);
    // Unknown digests require explicit confirmation; before it, the set is not ready.
    assert.equal(rm.ready(), false);
    rm.confirmRole(role);
  }
  assert.equal(rm.ready(), true, "a confirmed, complete set is ready");
  assert.equal(rm.status().complete, true);
  assert.deepEqual(rm.status().missing, []);
  const romSet = rm.getRomSet();
  assert.ok(romSet && romSet.basic && romSet.kernal && romSet.chargen, "getRomSet exposes bytes when ready");
  assert.match(romSet.id, /^[0-9a-f]{64}$/);
});

test("RomManager rejects a wrong-size role and stays not-ready", () => {
  const rm = new RomManager();
  for (const role of ["basic", "kernal"]) rm.setRoleBytes(role, rom(role)), rm.confirmRole(role);
  const bad = rm.setRoleBytes("chargen", new Uint8Array(123));
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "rom-size");
  assert.equal(rm.ready(), false);
  assert.equal(rm.getRomSet(), null);
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

test("loads the pinned vendored Pascual set only after every package asset passes integrity", async () => {
  const manifestUrl = new URL("https://example.test/c64/roms/manifest.json");
  const fetched = [];
  const result = await loadBundledRomSet(manifestUrl, async (url) => {
    fetched.push(String(url));
    if (String(url) === manifestUrl.href) {
      return jsonResponse(bundledManifest);
    }
    const name = new URL(String(url)).pathname.split("/").pop();
    const bytes = readFileSync(new URL(name, bundledRomsDir));
    return bytesResponse(bytes);
  });

  assert.equal(result.ok, true);
  assert.deepEqual(fetched, [
    manifestUrl.href,
    new URL(bundledManifest.roles.basic.path, manifestUrl).href,
    new URL(bundledManifest.roles.kernal.path, manifestUrl).href,
    new URL(bundledManifest.roles.chargen.path, manifestUrl).href,
    new URL(bundledManifest.sourceArchive.path, manifestUrl).href,
    ...bundledManifest.redistributionFiles.map((entry) => new URL(entry.path, manifestUrl).href),
  ]);
  assert.equal(result.set.licenseUrl, new URL("LICENSE.txt", manifestUrl).href);
  assert.equal(result.set.basicLicenseUrl, new URL("LICENSE-microsoft.txt", manifestUrl).href);
  assert.equal(result.set.lgplUrl, new URL("COPYING.LESSER", manifestUrl).href);
  assert.equal(result.set.gplUrl, new URL("COPYING", manifestUrl).href);
  assert.equal(result.set.chargenNoticeUrl, new URL("NOTICE.md", manifestUrl).href);
  assert.equal(result.set.provenanceUrl, new URL("PROVENANCE.md", manifestUrl).href);
  assert.equal(result.set.sourceArchiveUrl, new URL(bundledManifest.sourceArchive.path, manifestUrl).href);

  const manager = new RomManager();
  const applied = manager.setBundledSet(result.set);
  assert.equal(applied.ok, true);
  assert.equal(manager.ready(), true);
  assert.equal(manager.status().source, "bundled");
  assert.equal(manager.status().set.id, bundledManifest.id);
  for (const role of ROM_ROLES) {
    assert.equal(manager.status().roles[role].source, "bundled-replacement");
    assert.equal(manager.status().roles[role].digest, bundledManifest.roles[role].sha256);
  }
});

test("rejects malformed bundled manifests before requesting role bytes", async () => {
  const malformed = structuredClone(bundledManifest);
  malformed.roles.unreviewed = { ...malformed.roles.basic };
  assert.equal(validateBundledRomManifest(malformed).error.code, "rom-manifest");

  let calls = 0;
  const result = await loadBundledRomSet("https://example.test/roms/manifest.json", async () => {
    calls += 1;
    return jsonResponse(malformed);
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "rom-manifest");
  assert.equal(calls, 1, "only the manifest is requested");
});

test("a bundled role digest mismatch fails atomically and preserves the active set", async () => {
  const manager = new RomManager();
  for (const role of ROM_ROLES) {
    manager.setRoleBytes(role, rom(role, 0x30 + ROM_ROLES.indexOf(role)));
    manager.confirmRole(role);
  }
  const priorId = manager.getRomSet().id;
  const manifestUrl = new URL("https://example.test/roms/manifest.json");
  const loaded = await loadBundledRomSet(manifestUrl, async (url) => {
    if (String(url) === manifestUrl.href) return jsonResponse(bundledManifest);
    const name = new URL(String(url)).pathname.split("/").pop();
    const bytes = new Uint8Array(readFileSync(new URL(name, bundledRomsDir)));
    if (name === bundledManifest.roles.kernal.path) bytes[0] ^= 0xff;
    return bytesResponse(bytes);
  });

  assert.equal(loaded.ok, false);
  assert.equal(loaded.error.code, "rom-integrity");
  assert.equal(manager.status().source, "custom");
  assert.equal(manager.getRomSet().id, priorId);
});

test("a bundled source or legal-file mismatch fails the runtime package closed", async () => {
  for (const changedPath of [
    bundledManifest.sourceArchive.path,
    bundledManifest.licenses.basic.path,
  ]) {
    const manifestUrl = new URL("https://example.test/roms/manifest.json");
    const loaded = await loadBundledRomSet(manifestUrl, async (url) => {
      if (String(url) === manifestUrl.href) return jsonResponse(bundledManifest);
      const name = new URL(String(url)).pathname.split("/").pop();
      const bytes = new Uint8Array(readFileSync(new URL(name, bundledRomsDir)));
      if (name === changedPath) bytes[0] ^= 0xff;
      return bytesResponse(bytes);
    });
    assert.equal(loaded.ok, false, changedPath);
    assert.equal(loaded.error.code, "rom-integrity", changedPath);
  }
});

test("RomManager never mixes a bundled role with an incremental custom set", () => {
  const manager = new RomManager();
  const bundledSet = {
    id: bundledManifest.id,
    title: bundledManifest.title,
    revision: bundledManifest.revision,
    licenseIds: ["MIT", "LGPL-3.0-or-later"],
    roles: Object.fromEntries(
      ROM_ROLES.map((role) => [
        role,
        {
          bytes: new Uint8Array(readFileSync(new URL(bundledManifest.roles[role].path, bundledRomsDir))),
          sha256: bundledManifest.roles[role].sha256,
          licenseId: role === "chargen" ? "LGPL-3.0-or-later" : "MIT",
        },
      ]),
    ),
  };
  assert.equal(manager.setBundledSet(bundledSet).ok, true);
  assert.equal(manager.ready(), true);

  assert.equal(manager.setRoleBytes("basic", rom("basic", 0x55)).ok, true);
  const status = manager.status();
  assert.equal(status.source, "custom");
  assert.deepEqual(status.missing, ["kernal", "chargen"]);
  assert.equal(status.roles.basic.source, "user-supplied");
  assert.equal(status.roles.kernal, null);
  assert.equal(status.roles.chargen, null);
});

test("RomManager rejects an invalid bundled candidate without replacing a ready custom set", () => {
  const manager = new RomManager();
  for (const role of ROM_ROLES) {
    manager.setRoleBytes(role, rom(role, 0x60 + ROM_ROLES.indexOf(role)));
    manager.confirmRole(role);
  }
  const priorId = manager.getRomSet().id;
  const result = manager.setBundledSet({
    id: "incomplete",
    title: "Incomplete",
    revision: "0".repeat(40),
    licenseIds: ["MIT", "LGPL-3.0-or-later"],
    roles: {},
  });
  assert.equal(result.ok, false);
  assert.equal(manager.status().source, "custom");
  assert.equal(manager.ready(), true);
  assert.equal(manager.getRomSet().id, priorId);
});

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => structuredClone(value) };
}

function bytesResponse(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
