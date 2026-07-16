// Pure (de)serialization for autosave and preferences envelopes. Environment-free so the format
// and version checks are Node-testable; localStorage access + storage events live in the browser
// module storage.js. Only canonical project JSON and non-sensitive UI preferences are stored —
// never binary ROM/D64 bytes (see specs/WEB-CLIENT.md, specs/ROM-ASSETS.md).

import { validateProject, canonicalJson } from "./projectModel.js";

export const AUTOSAVE_VERSION = 1;
export const PREFERENCES_VERSION = 1;

// Whitelisted, non-sensitive preference keys and their validators.
const PREF_VALIDATORS = {
  timingProfile: (v) => v === "pal-6569" || v === "ntsc-6567r8",
  sidModel: (v) => v === "6581" || v === "8580",
  masterVolume: (v) => typeof v === "number" && v >= 0 && v <= 1,
  joystickPort: (v) => v === 1 || v === 2,
  audioEnabled: (v) => typeof v === "boolean",
};

/**
 * Serialize a validated project into a versioned autosave string. Returns null when the project
 * is invalid (nothing is persisted for an invalid project).
 * @param {object} rawProject
 */
export function serializeAutosave(rawProject) {
  const { ok, project } = validateProject(rawProject);
  if (!ok) return null;
  // Store canonical field order for stable bytes; parse re-validates.
  return JSON.stringify({ v: AUTOSAVE_VERSION, project: JSON.parse(canonicalJson(project)) });
}

/**
 * Parse an autosave string, enforcing the version and re-validating the project.
 * @param {string} text
 * @returns {{ ok: true, project: object } | { ok: false, reason: string }}
 */
export function parseAutosave(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (parsed === null || typeof parsed !== "object") return { ok: false, reason: "not-an-object" };
  if (parsed.v !== AUTOSAVE_VERSION) return { ok: false, reason: "version-mismatch" };
  const { ok, project } = validateProject(parsed.project);
  if (!ok) return { ok: false, reason: "invalid-project" };
  return { ok: true, project };
}

/**
 * Serialize a preferences object, keeping only whitelisted, well-typed keys.
 * @param {object} prefs
 */
export function serializePreferences(prefs) {
  const clean = {};
  if (prefs && typeof prefs === "object") {
    for (const [key, validate] of Object.entries(PREF_VALIDATORS)) {
      if (key in prefs && validate(prefs[key])) clean[key] = prefs[key];
    }
  }
  return JSON.stringify({ v: PREFERENCES_VERSION, prefs: clean });
}

/**
 * Parse a preferences string, enforcing the version and dropping unknown/ill-typed keys.
 * @param {string} text
 * @returns {{ ok: true, prefs: object } | { ok: false, reason: string }}
 */
export function parsePreferences(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (parsed === null || typeof parsed !== "object") return { ok: false, reason: "not-an-object" };
  if (parsed.v !== PREFERENCES_VERSION) return { ok: false, reason: "version-mismatch" };
  const prefs = {};
  const raw = parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : {};
  for (const [key, validate] of Object.entries(PREF_VALIDATORS)) {
    if (key in raw && validate(raw[key])) prefs[key] = raw[key];
  }
  return { ok: true, prefs };
}
