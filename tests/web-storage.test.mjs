import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadAutosave,
  saveAutosave,
  clearAutosave,
  loadPreferences,
  savePreferences,
  AUTOSAVE_KEY,
} from "../web/modules/storage.v1.js";

function fakeStorage(overrides = {}) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
    ...overrides,
  };
}

const project = {
  schema: 1,
  name: "demo",
  source: "  rts\n",
  runMode: "basic-sys",
  loadAddress: 0x0801,
  runAddress: 0x080d,
  timingProfile: "pal-6569",
  diskName: "disk",
  diskId: "64",
  outputName: "demo",
};

test("autosave round-trips the editable project fields only", () => {
  const storage = fakeStorage();
  saveAutosave(storage, { ...project, target: "nmos-6510" });
  const loaded = loadAutosave(storage);
  assert.equal(loaded.schema, 1);
  assert.equal(loaded.source, "  rts\n");
  assert.equal(loaded.outputName, "demo");
  // 'target' is not an autosaved field.
  assert.equal(loaded.target, undefined);
});

test("a wrong state version is ignored", () => {
  const storage = fakeStorage();
  storage.setItem(AUTOSAVE_KEY, JSON.stringify({ version: 99, project }));
  assert.equal(loadAutosave(storage), null);
});

test("corrupt JSON is ignored, not thrown", () => {
  const storage = fakeStorage();
  storage.setItem(AUTOSAVE_KEY, "{not json");
  assert.equal(loadAutosave(storage), null);
});

test("clearAutosave removes the record", () => {
  const storage = fakeStorage();
  saveAutosave(storage, project);
  clearAutosave(storage);
  assert.equal(loadAutosave(storage), null);
});

test("a quota failure surfaces a storage-category error", () => {
  const storage = fakeStorage({
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.throws(() => saveAutosave(storage, project), (err) => err.category === "storage");
});

test("preferences round-trip and default to empty", () => {
  const storage = fakeStorage();
  assert.deepEqual(loadPreferences(storage), {});
  savePreferences(storage, { timingProfile: "ntsc-6567r8" });
  assert.deepEqual(loadPreferences(storage), { timingProfile: "ntsc-6567r8" });
});
