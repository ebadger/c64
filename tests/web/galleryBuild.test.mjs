// Node test: the committed web/client/gallery.json is structurally valid and every entry rebuilds
// deterministically to its recorded expectedBuildId (the gallery golden vectors).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { validateGallery } from "../../web/client/lib/galleryValidate.js";
import { projectFromGalleryEntry } from "../../web/client/lib/projectModel.js";
import { buildArtifacts } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const galleryPath = join(repoRoot, "web", "client", "gallery.json");

test("committed gallery.json passes structural validation", () => {
  const parsed = JSON.parse(readFileSync(galleryPath, "utf8"));
  const result = validateGallery(parsed);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.entries.length >= 1);
  assert.ok(result.byId.has("border-flash"), "the canonical example must be a gallery entry");
});

test("every gallery entry rebuilds to its recorded expectedBuildId", () => {
  const parsed = JSON.parse(readFileSync(galleryPath, "utf8"));
  const { entries } = validateGallery(parsed);
  for (const entry of entries) {
    const source = readFileSync(join(repoRoot, entry.sourcePath), "utf8");
    const project = projectFromGalleryEntry(entry, source);
    const result = buildArtifacts(project);
    assert.equal(result.ok, true, `entry '${entry.id}' failed to build`);
    assert.equal(result.assembly.buildId, entry.expectedBuildId, `buildId drift in gallery entry '${entry.id}'`);
  }
});
