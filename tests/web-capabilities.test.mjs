import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCapabilities } from "../web/modules/capabilities.v1.js";
import { formatDiagnostic } from "../web/modules/diagnostics.v1.js";
import { ERROR_CATEGORIES, isErrorCategory, AppError } from "../web/modules/errors.v1.js";

function capableEnv() {
  return {
    WebAssembly: { instantiate: () => {} },
    Worker: function () {},
    Uint8Array,
    Blob: function () {},
    URL: Object.assign(function () {}, { createObjectURL: () => "blob:x" }),
    TextEncoder,
    TextDecoder,
    localStorage: {
      _m: new Map(),
      setItem(k, v) { this._m.set(k, v); },
      removeItem(k) { this._m.delete(k); },
    },
  };
}

test("a fully capable environment is supported", () => {
  const caps = detectCapabilities(capableEnv());
  assert.equal(caps.supported, true);
  assert.deepEqual(caps.missing, []);
  assert.equal(caps.features.webAssembly, true);
  assert.equal(caps.features.workers, true);
});

test("a missing Blob/URL capability marks the browser unsupported", () => {
  const env = capableEnv();
  delete env.Blob;
  const caps = detectCapabilities(env);
  assert.equal(caps.supported, false);
  assert.ok(caps.missing.includes("blobUrls"));
});

test("missing localStorage is a reported feature, not an unsupported gate", () => {
  const env = capableEnv();
  env.localStorage = { setItem() { throw new Error("blocked"); }, removeItem() {} };
  const caps = detectCapabilities(env);
  assert.equal(caps.supported, true);
  assert.equal(caps.features.localStorage, false);
});

test("formatDiagnostic is stable", () => {
  const line = formatDiagnostic({ severity: "error", code: "unknown-opcode", message: "nope", line: 3, column: 5 });
  assert.equal(line, "error [unknown-opcode] line 3, col 5: nope");
});

test("error categories are the documented stable set", () => {
  assert.deepEqual(ERROR_CATEGORIES, ["share", "storage", "build", "rom", "wasm", "media", "audio", "input"]);
  assert.equal(isErrorCategory("share"), true);
  assert.equal(isErrorCategory("bogus"), false);
  assert.equal(new AppError("bogus", "x").category, "build");
});
