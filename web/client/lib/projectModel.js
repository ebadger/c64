// SourceProject helpers for the web client. Environment-free wrapper over the production
// pipeline model in src/: it adds only UI-facing construction/canonicalization helpers and the
// deterministic gallery-project rule (see specs/WEB-CLIENT.md). No browser globals.

import {
  DEFAULT_PROJECT,
  validateProject,
  normalizeLineEndings,
  canonicalJson,
  computeBuildId,
} from "../../../src/index.js";

export { DEFAULT_PROJECT, validateProject, normalizeLineEndings, canonicalJson, computeBuildId };

/** The editable project fields the UI exposes, in a stable order for forms and autosave. */
export const EDITABLE_FIELDS = Object.freeze([
  "name",
  "source",
  "loadAddress",
  "runMode",
  "runAddress",
  "timingProfile",
  "diskName",
  "diskId",
  "outputName",
]);

/**
 * A fresh editable project seeded from documented defaults, optionally overridden. Line endings
 * on `source` are normalized so the in-memory project is already canonical.
 * @param {object} [overrides]
 */
export function makeProject(overrides = {}) {
  const project = { ...DEFAULT_PROJECT, ...overrides };
  project.source = normalizeLineEndings(project.source ?? "");
  return project;
}

/**
 * Construct the canonical SourceProject for a gallery entry from its declared source text and
 * timing profile. Deterministic so `expectedBuildId` is CI-verifiable (see specs/WEB-CLIENT.md):
 *   { ...DEFAULT_PROJECT, source, timingProfile: entry.timingProfile,
 *     name: entry.id, outputName: entry.id (<=16 chars) }.
 * @param {{ id: string, timingProfile: string }} entry
 * @param {string} source
 */
export function projectFromGalleryEntry(entry, source) {
  return makeProject({
    name: entry.id,
    source,
    timingProfile: entry.timingProfile,
    outputName: entry.id.slice(0, 16),
  });
}

/**
 * Canonical JSON for autosave/build identity, validating first. Returns null when the project is
 * invalid (the caller surfaces diagnostics from `validateProject`).
 * @param {object} rawProject
 */
export function canonicalProjectJson(rawProject) {
  const { ok, project } = validateProject(rawProject);
  return ok ? canonicalJson(project) : null;
}
