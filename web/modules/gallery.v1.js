// Gallery loading, entry validation, and deterministic project construction for `?src` and
// `?code`. See specs/WEB-CLIENT.md. Pure module: fetch is injected so Node tests can exercise
// the same construction logic the browser uses.

import { appError } from "./errors.v1.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TIMING_PROFILES = new Set(["pal-6569", "ntsc-6567r8"]);

/**
 * Construct the ephemeral project for a `?code` share: the decoded string becomes `source`;
 * every other field takes its documented pipeline default.
 * @param {string} source
 */
export function projectFromSource(source) {
  return { schema: 1, source: String(source) };
}

/**
 * Construct the ephemeral project for a resolved gallery `?src` entry: the fetched source plus
 * the entry's declared timing profile, with all other fields defaulted. `expectedBuildId` is
 * the build id of exactly this project.
 * @param {object} entry
 * @param {string} source
 */
export function projectFromGalleryEntry(entry, source) {
  return { schema: 1, source: String(source), timingProfile: entry.timingProfile };
}

/**
 * Validate a repository-relative, same-origin asset path: no leading slash, no `..` segment,
 * no backslash, and no absolute URL scheme. Throws a `media` error on violation.
 * @param {string} path
 * @param {string} field
 */
export function assertSafeAssetPath(path, field = "sourcePath") {
  if (typeof path !== "string" || path.length === 0) {
    throw appError("media", `Gallery ${field} is missing.`);
  }
  if (path.startsWith("/") || path.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw appError("media", `Gallery ${field} must be a repository-relative path.`);
  }
  if (path.split("/").some((segment) => segment === "..")) {
    throw appError("media", `Gallery ${field} may not contain '..'.`);
  }
  return path;
}

/**
 * Validate one gallery entry against the versioned GalleryEntry shape. Returns the entry on
 * success; throws a `media` error otherwise.
 * @param {object} entry
 */
export function validateGalleryEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw appError("media", "Gallery entry must be an object.");
  }
  if (entry.schema !== 1) {
    throw appError("media", `Unsupported gallery entry schema: ${entry.schema}.`);
  }
  for (const field of ["id", "title", "description", "sourcePath", "expectedBuildId"]) {
    if (typeof entry[field] !== "string" || entry[field].length === 0) {
      throw appError("media", `Gallery entry field '${field}' must be a non-empty string.`);
    }
  }
  if (!ID_RE.test(entry.id)) {
    throw appError("media", `Gallery entry id '${entry.id}' is not a valid id.`);
  }
  if (!TIMING_PROFILES.has(entry.timingProfile)) {
    throw appError("media", `Gallery entry '${entry.id}' has an invalid timingProfile.`);
  }
  assertSafeAssetPath(entry.sourcePath, "sourcePath");
  if (entry.curatedD64Path !== undefined) {
    assertSafeAssetPath(entry.curatedD64Path, "curatedD64Path");
  }
  return entry;
}

/**
 * Validate the gallery document `{ schema: 1, entries: GalleryEntry[] }` and return the parsed
 * entries. Rejects duplicate ids.
 * @param {object} doc
 */
export function validateGallery(doc) {
  if (doc === null || typeof doc !== "object" || doc.schema !== 1 || !Array.isArray(doc.entries)) {
    throw appError("media", "gallery.json must be { schema: 1, entries: [...] }.");
  }
  const seen = new Set();
  for (const entry of doc.entries) {
    validateGalleryEntry(entry);
    if (seen.has(entry.id)) {
      throw appError("media", `Duplicate gallery id '${entry.id}'.`);
    }
    seen.add(entry.id);
  }
  return doc.entries;
}

/**
 * Load and validate the gallery document using an injected fetch implementation.
 * @param {(url: string) => Promise<Response>} fetchImpl
 * @param {string | URL} url
 * @returns {Promise<object[]>}
 */
export async function loadGallery(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(String(url));
  } catch (cause) {
    throw appError("media", "Could not load the examples gallery.", { cause });
  }
  if (!response.ok) {
    throw appError("media", `Gallery request failed (${response.status}).`);
  }
  const doc = await response.json();
  return validateGallery(doc);
}

/**
 * Find a gallery entry by id, or throw a `media` error if it is unknown.
 * @param {readonly object[]} entries
 * @param {string} id
 */
export function findEntry(entries, id) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw appError("media", `Unknown gallery id '${id}'.`);
  }
  return entry;
}
