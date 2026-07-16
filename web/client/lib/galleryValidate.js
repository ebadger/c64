// Gallery validation. Environment-free: validates the parsed gallery.json structure, every
// entry, and every path/id/buildId per specs/WEB-CLIENT.md. Rebuilding each entry's artifacts to
// confirm expectedBuildId is done by the committed generator + a Node test, not at runtime.

import { validateRepoRelativePath } from "./paths.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BUILD_ID_RE = /^[0-9a-f]{64}$/;
const TIMING_PROFILES = new Set(["pal-6569", "ntsc-6567r8"]);

function entryError(id, reason) {
  return { id, reason };
}

/**
 * Validate one gallery entry. Returns a normalized entry or an error with a stable reason.
 * @param {unknown} raw
 */
export function validateGalleryEntry(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: entryError(null, "not-an-object") };
  }
  const id = raw.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return { ok: false, error: entryError(typeof id === "string" ? id : null, "invalid-id") };
  }
  if (raw.schema !== 1) return { ok: false, error: entryError(id, "invalid-schema") };
  if (typeof raw.title !== "string" || raw.title.length === 0) {
    return { ok: false, error: entryError(id, "invalid-title") };
  }
  if (typeof raw.description !== "string") return { ok: false, error: entryError(id, "invalid-description") };
  if (!TIMING_PROFILES.has(raw.timingProfile)) return { ok: false, error: entryError(id, "invalid-timing-profile") };
  if (typeof raw.expectedBuildId !== "string" || !BUILD_ID_RE.test(raw.expectedBuildId)) {
    return { ok: false, error: entryError(id, "invalid-build-id") };
  }
  const sp = validateRepoRelativePath(raw.sourcePath);
  if (!sp.ok) return { ok: false, error: entryError(id, `invalid-source-path:${sp.reason}`) };

  let curatedD64Path = null;
  if (raw.curatedD64Path !== undefined && raw.curatedD64Path !== null) {
    const dp = validateRepoRelativePath(raw.curatedD64Path);
    if (!dp.ok) return { ok: false, error: entryError(id, `invalid-d64-path:${dp.reason}`) };
    curatedD64Path = dp.path;
  }

  return {
    ok: true,
    entry: {
      schema: 1,
      id,
      title: raw.title,
      description: raw.description,
      sourcePath: sp.path,
      expectedBuildId: raw.expectedBuildId,
      timingProfile: raw.timingProfile,
      curatedD64Path,
    },
  };
}

/**
 * Validate a parsed gallery document (an array of entries). Every invalid or duplicate entry is
 * excluded and reported so the UI can show a visible error without silently substituting content.
 * @param {unknown} parsed
 * @returns {{ ok: boolean, entries: object[], byId: Map<string, object>, errors: object[] }}
 */
export function validateGallery(parsed) {
  const errors = [];
  if (!Array.isArray(parsed)) {
    return { ok: false, entries: [], byId: new Map(), errors: [entryError(null, "gallery-not-an-array")] };
  }
  const entries = [];
  const byId = new Map();
  for (const raw of parsed) {
    const result = validateGalleryEntry(raw);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    if (byId.has(result.entry.id)) {
      errors.push(entryError(result.entry.id, "duplicate-id"));
      continue;
    }
    byId.set(result.entry.id, result.entry);
    entries.push(result.entry);
  }
  return { ok: errors.length === 0, entries, byId, errors };
}
