import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateGalleryEntry,
  validateGallery,
  projectFromGalleryEntry,
  projectFromSource,
  assertSafeAssetPath,
  findEntry,
} from "../web/modules/gallery.v1.js";
import { runBuild } from "../web/modules/buildCore.v1.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function goodEntry(overrides = {}) {
  return {
    schema: 1,
    id: "border-flash",
    title: "Border flash",
    description: "desc",
    sourcePath: "examples/border-flash/source.asm",
    expectedBuildId: "deadbeef",
    timingProfile: "pal-6569",
    ...overrides,
  };
}

test("a well-formed gallery entry validates", () => {
  assert.doesNotThrow(() => validateGalleryEntry(goodEntry()));
});

test("invalid ids, timing profiles, and schema are rejected", () => {
  assert.throws(() => validateGalleryEntry(goodEntry({ id: "Bad Id" })), (e) => e.category === "media");
  assert.throws(() => validateGalleryEntry(goodEntry({ timingProfile: "pal" })), (e) => e.category === "media");
  assert.throws(() => validateGalleryEntry(goodEntry({ schema: 2 })), (e) => e.category === "media");
});

test("unsafe asset paths are rejected", () => {
  for (const bad of ["/etc/passwd", "../secret.asm", "a/../b", "https://x/y.asm", "a\\b"]) {
    assert.throws(() => assertSafeAssetPath(bad), (e) => e.category === "media", `expected reject: ${bad}`);
  }
  assert.equal(assertSafeAssetPath("examples/border-flash/source.asm"), "examples/border-flash/source.asm");
});

test("validateGallery rejects duplicate ids", () => {
  const doc = { schema: 1, entries: [goodEntry(), goodEntry()] };
  assert.throws(() => validateGallery(doc), (e) => e.category === "media");
});

test("findEntry throws on unknown id", () => {
  assert.throws(() => findEntry([goodEntry()], "missing"), (e) => e.category === "media");
});

test("projectFromSource / projectFromGalleryEntry produce the documented shapes", () => {
  assert.deepEqual(projectFromSource("abc"), { schema: 1, source: "abc" });
  assert.deepEqual(projectFromGalleryEntry(goodEntry({ timingProfile: "ntsc-6567r8" }), "abc"), {
    schema: 1,
    source: "abc",
    timingProfile: "ntsc-6567r8",
  });
});

test("committed gallery.json builds each entry to its recorded expectedBuildId", () => {
  const doc = JSON.parse(readFileSync(join(repoRoot, "web/gallery.json"), "utf8"));
  const entries = validateGallery(doc);
  assert.ok(entries.length >= 1, "gallery must have at least one entry");
  for (const entry of entries) {
    const source = readFileSync(join(repoRoot, entry.sourcePath), "utf8");
    const outcome = runBuild(projectFromGalleryEntry(entry, source));
    assert.ok(outcome.ok, `gallery entry '${entry.id}' failed to build: ${JSON.stringify(outcome.diagnostics)}`);
    assert.equal(outcome.buildId, entry.expectedBuildId, `buildId drift for gallery entry '${entry.id}'`);
  }
});
