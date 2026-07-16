// Node tests for the URL/state contract resolver (web/client/lib/urlContract.js).
import test from "node:test";
import assert from "node:assert/strict";

import { resolveUrlState } from "../../web/client/lib/urlContract.js";
import { encodeSourceToCode } from "../../web/client/lib/base64url.js";

function gallery() {
  return new Map([
    ["border-flash", { id: "border-flash", timingProfile: "pal-6569", curatedD64Path: null }],
    ["disk-demo", { id: "disk-demo", timingProfile: "pal-6569", curatedD64Path: "examples/disk-demo/demo.d64" }],
  ]);
}

test("resolves a valid ?code as an ephemeral remix with a bearer warning", () => {
  const code = encodeSourceToCode("lda #$01\n");
  const r = resolveUrlState(`?code=${code}`, gallery());
  assert.equal(r.sourceOrigin, "code");
  assert.equal(r.source, "lda #$01\n");
  assert.equal(r.bearerWarning, true);
  assert.equal(r.errors.length, 0);
  assert.ok(r.notices.some((n) => /bearer data/i.test(n)));
});

test("?code takes precedence over ?src", () => {
  const code = encodeSourceToCode("nop\n");
  const r = resolveUrlState(`?code=${code}&src=border-flash`, gallery());
  assert.equal(r.sourceOrigin, "code");
  assert.equal(r.galleryEntry, null);
  assert.ok(r.notices.some((n) => /ignored/i.test(n)));
});

test("resolves ?src to a known gallery entry", () => {
  const r = resolveUrlState("?src=border-flash", gallery());
  assert.equal(r.sourceOrigin, "src");
  assert.equal(r.galleryEntry.id, "border-flash");
  assert.equal(r.errors.length, 0);
});

test("a malformed ?code is a visible error and does not fall back to ?src", () => {
  const r = resolveUrlState("?code=@@@@&src=border-flash", gallery());
  assert.equal(r.sourceOrigin, "default");
  assert.equal(r.source, null);
  assert.equal(r.galleryEntry, null); // did NOT silently select the src project
  assert.ok(r.errors.some((e) => e.code === "malformed-code"));
});

test("unknown and invalid ?src ids are visible errors", () => {
  const unknown = resolveUrlState("?src=nope", gallery());
  assert.ok(unknown.errors.some((e) => e.code === "unknown-src"));
  const invalid = resolveUrlState("?src=Bad_Id", gallery());
  assert.ok(invalid.errors.some((e) => e.code === "invalid-src"));
});

test("duplicate values are rejected for each parameter", () => {
  const code = encodeSourceToCode("x");
  assert.ok(resolveUrlState(`?code=${code}&code=${code}`, gallery()).errors.some((e) => e.code === "duplicate-code"));
  assert.ok(resolveUrlState("?src=a&src=b", gallery()).errors.some((e) => e.code === "duplicate-src"));
  assert.ok(resolveUrlState("?d64=a&d64=b", gallery()).errors.some((e) => e.code === "duplicate-d64"));
});

test("?d64 resolves only through a valid gallery entry that declares curated media", () => {
  const ok = resolveUrlState("?d64=disk-demo", gallery());
  assert.deepEqual(ok.d64, {
    entry: gallery().get("disk-demo"),
    path: "examples/disk-demo/demo.d64",
  });
  const noMedia = resolveUrlState("?d64=border-flash", gallery());
  assert.equal(noMedia.d64, null);
  assert.ok(noMedia.errors.some((e) => e.code === "no-curated-d64"));
  const unknown = resolveUrlState("?d64=nope", gallery());
  assert.ok(unknown.errors.some((e) => e.code === "unknown-d64"));
});

test("?d64 is independent of source selection", () => {
  const r = resolveUrlState("?src=border-flash&d64=disk-demo", gallery());
  assert.equal(r.sourceOrigin, "src");
  assert.ok(r.d64);
});

test("an oversized ?code is refused with a download recommendation", () => {
  const big = encodeSourceToCode("A".repeat(300 * 1024));
  const r = resolveUrlState(`?code=${big}`, gallery());
  assert.equal(r.sourceOrigin, "default");
  assert.ok(r.errors.some((e) => e.code === "too-large"));
});
