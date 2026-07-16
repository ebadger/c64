// Build (and optionally record) web/client/gallery.json. Each entry loads a committed source
// file and, via the deterministic gallery-project rule (see specs/WEB-CLIENT.md), assembles to a
// reproducible expectedBuildId. Curated publishing stays PR-only; this generator just records the
// golden expectedBuildId so a Node test can fail on drift.
//
//   node web/client/tools/build-gallery.mjs           verify web/client/gallery.json (fails on drift)
//   node web/client/tools/build-gallery.mjs --write    regenerate web/client/gallery.json

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildArtifacts } from "../../../src/index.js";
import { projectFromGalleryEntry } from "../lib/projectModel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const galleryPath = join(here, "..", "gallery.json");

// The curated gallery source manifest. `curatedD64Path` is optional and, when present, must be a
// committed same-origin file declared by that entry.
const MANIFEST = [
  {
    id: "border-flash",
    title: "Border flash",
    description:
      "The canonical milestone-1 example: symbol assignment, zero-page vs absolute selection, indexed load, a branch, a forward-referenced subroutine, and .byte/.text/.word data. Runnable and remixable.",
    sourcePath: "examples/border-flash/source.asm",
    timingProfile: "pal-6569",
  },
];

function buildEntry(manifest) {
  const source = readFileSync(join(repoRoot, manifest.sourcePath), "utf8");
  const project = projectFromGalleryEntry({ id: manifest.id, timingProfile: manifest.timingProfile }, source);
  const result = buildArtifacts(project);
  if (!result.ok) {
    const detail = result.assembly && !result.assembly.ok ? JSON.stringify(result.assembly.diagnostics) : JSON.stringify(result.error);
    throw new Error(`Gallery entry '${manifest.id}' failed to build: ${detail}`);
  }
  const entry = {
    schema: 1,
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    sourcePath: manifest.sourcePath,
    expectedBuildId: result.assembly.buildId,
    timingProfile: manifest.timingProfile,
  };
  if (manifest.curatedD64Path) entry.curatedD64Path = manifest.curatedD64Path;
  return entry;
}

export function buildGallery() {
  return MANIFEST.map(buildEntry);
}

// CLI entry (skipped when imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const write = process.argv.includes("--write");
  const built = buildGallery();
  if (write) {
    writeFileSync(galleryPath, JSON.stringify(built, null, 2) + "\n");
    console.log(`wrote gallery.json with ${built.length} entr${built.length === 1 ? "y" : "ies"}`);
  } else {
    const committed = JSON.parse(readFileSync(galleryPath, "utf8"));
    if (JSON.stringify(committed) !== JSON.stringify(built)) {
      console.error("DRIFT: web/client/gallery.json does not match the rebuilt gallery.");
      console.error(`  committed: ${JSON.stringify(committed)}`);
      console.error(`  rebuilt:   ${JSON.stringify(built)}`);
      process.exit(1);
    }
    console.log(`gallery.json OK (${built.length} entr${built.length === 1 ? "y" : "ies"})`);
  }
}
