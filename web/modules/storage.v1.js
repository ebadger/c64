// Namespaced local autosave and preferences. See specs/WEB-CLIENT.md "URL and local-state
// rules". Keys live under the `c64.dev.v1.*` namespace and are version-checked on read. ROM and
// imported D64 bytes are never written here. The storage backend is injected so Node tests can
// exercise the versioning and quota handling without a browser.

import { appError } from "./errors.v1.js";

export const AUTOSAVE_KEY = "c64.dev.v1.autosave";
export const PREFERENCES_KEY = "c64.dev.v1.preferences";
export const STATE_VERSION = 1;

// Autosave persists only editable project fields — never binary media.
const AUTOSAVE_FIELDS = [
  "name",
  "source",
  "runMode",
  "loadAddress",
  "runAddress",
  "timingProfile",
  "diskName",
  "diskId",
  "outputName",
];

function readJson(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch (cause) {
    throw appError("storage", "Local storage is unavailable.", { cause });
  }
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // Corrupt or foreign value: ignore rather than crash.
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (cause) {
    // Quota exceeded or storage disabled: the caller disables autosave with a visible warning.
    throw appError("storage", "Could not save locally (storage full or blocked).", { cause });
  }
}

/**
 * Load the autosaved project, or null when absent, corrupt, or a different state version.
 * @param {Storage} storage
 * @returns {object|null}
 */
export function loadAutosave(storage) {
  const record = readJson(storage, AUTOSAVE_KEY);
  if (record === null || typeof record !== "object" || record.version !== STATE_VERSION) {
    return null;
  }
  const project = record.project;
  if (project === null || typeof project !== "object" || project.schema !== 1) {
    return null;
  }
  return project;
}

/**
 * Persist the autosave record. Throws a `storage`-category error on quota/permission failure so
 * the caller can disable autosave and warn.
 * @param {Storage} storage
 * @param {object} project
 */
export function saveAutosave(storage, project) {
  const slim = { schema: 1 };
  for (const field of AUTOSAVE_FIELDS) {
    if (project[field] !== undefined) slim[field] = project[field];
  }
  writeJson(storage, AUTOSAVE_KEY, { version: STATE_VERSION, project: slim });
}

/** Remove the autosaved project. */
export function clearAutosave(storage) {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Best-effort: nothing to recover if removal fails.
  }
}

/**
 * Load non-sensitive UI preferences, or an empty object.
 * @param {Storage} storage
 * @returns {Record<string, unknown>}
 */
export function loadPreferences(storage) {
  const record = readJson(storage, PREFERENCES_KEY);
  if (record === null || typeof record !== "object" || record.version !== STATE_VERSION) {
    return {};
  }
  return record.values && typeof record.values === "object" ? record.values : {};
}

/**
 * Persist non-sensitive UI preferences.
 * @param {Storage} storage
 * @param {Record<string, unknown>} values
 */
export function savePreferences(storage, values) {
  writeJson(storage, PREFERENCES_KEY, { version: STATE_VERSION, values });
}
