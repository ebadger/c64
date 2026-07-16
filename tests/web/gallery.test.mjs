// Node tests for path safety and gallery structural validation.
import test from "node:test";
import assert from "node:assert/strict";

import { validateRepoRelativePath, resolveWithinBase } from "../../web/client/lib/paths.js";
import { validateGallery, validateGalleryEntry } from "../../web/client/lib/galleryValidate.js";

test("accepts safe repo-relative paths", () => {
  for (const p of ["examples/border-flash/source.asm", "web/client/gallery.json", "a", "a/b/c.d64"]) {
    assert.equal(validateRepoRelativePath(p).ok, true, p);
  }
});

test("rejects traversal, absolute, cross-origin, and encoded paths", () => {
  const bad = {
    "../etc/passwd": "bad-segment",
    "a/../b": "bad-segment",
    "/abs/path": "leading-slash",
    "a//b": "double-slash",
    "http://evil.example/x": "scheme-or-colon",
    "//evil.example/x": "leading-slash",
    "a\\b": "backslash",
    "a%2e%2e/b": "percent-escape",
    "": "empty",
    "a/ b": "invalid-character",
  };
  for (const [p, reason] of Object.entries(bad)) {
    const r = validateRepoRelativePath(p);
    assert.equal(r.ok, false, `expected ${p} to be rejected`);
    assert.equal(r.reason, reason, `wrong reason for ${p}`);
  }
});

test("resolveWithinBase keeps paths same-origin and within the base", () => {
  const base = new URL("http://localhost:8080/");
  const r = resolveWithinBase("examples/x.asm", base);
  assert.equal(r.ok, true);
  assert.equal(r.url.href, "http://localhost:8080/examples/x.asm");
  // Resolving against a nested base keeps the result under that base directory.
  const nested = new URL("http://localhost:8080/web/client/");
  const n = resolveWithinBase("examples/x.asm", nested);
  assert.equal(n.ok, true);
  assert.ok(n.url.pathname.startsWith("/web/client/"));
});

const goodEntry = {
  schema: 1,
  id: "border-flash",
  title: "Border flash",
  description: "Canonical example.",
  sourcePath: "examples/border-flash/source.asm",
  expectedBuildId: "a".repeat(64),
  timingProfile: "pal-6569",
};

test("validates a well-formed entry and normalizes curatedD64Path", () => {
  const r = validateGalleryEntry({ ...goodEntry, curatedD64Path: "examples/x.d64" });
  assert.equal(r.ok, true);
  assert.equal(r.entry.curatedD64Path, "examples/x.d64");
  const noD64 = validateGalleryEntry(goodEntry);
  assert.equal(noD64.entry.curatedD64Path, null);
});

test("rejects entries with bad id/schema/buildId/path/profile", () => {
  const cases = {
    "invalid-id": { ...goodEntry, id: "Bad_Id" },
    "invalid-schema": { ...goodEntry, schema: 2 },
    "invalid-build-id": { ...goodEntry, expectedBuildId: "xyz" },
    "invalid-timing-profile": { ...goodEntry, timingProfile: "pal-6572" },
    "invalid-title": { ...goodEntry, title: "" },
  };
  for (const [reason, entry] of Object.entries(cases)) {
    const r = validateGalleryEntry(entry);
    assert.equal(r.ok, false, reason);
    assert.equal(r.error.reason, reason);
  }
  const badPath = validateGalleryEntry({ ...goodEntry, sourcePath: "../escape" });
  assert.match(badPath.error.reason, /^invalid-source-path:/);
});

test("validateGallery collects errors and detects duplicate ids", () => {
  const parsed = [goodEntry, { ...goodEntry }, { ...goodEntry, id: "other", title: "x", description: "y" }];
  const r = validateGallery(parsed);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.reason === "duplicate-id"));
  assert.equal(r.byId.size, 2);
  assert.equal(validateGallery("nope").errors[0].reason, "gallery-not-an-array");
});
