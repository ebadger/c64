// Gallery loading (browser): fetch and validate gallery.json, then fetch a committed entry's
// source or curated same-origin D64. All paths are validated and resolved within the static base
// (no cross-origin, no traversal). See specs/WEB-CLIENT.md.

import { GALLERY_PATH } from "./config.js";
import { validateGallery } from "./galleryValidate.js";
import { validateRepoRelativePath, resolveWithinBase } from "./paths.js";
import { normalizeLineEndings } from "./projectModel.js";

/** Fetch and validate gallery.json. Returns validation output plus any fetch error. */
export async function loadGallery(baseUrl) {
  let parsed;
  try {
    const url = new URL(GALLERY_PATH, baseUrl);
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return { ok: false, entries: [], byId: new Map(), errors: [{ id: null, reason: `http-${res.status}` }] };
    parsed = await res.json();
  } catch (err) {
    return { ok: false, entries: [], byId: new Map(), errors: [{ id: null, reason: "fetch-failed" }] };
  }
  return validateGallery(parsed);
}

/** Fetch the normalized source text for a validated gallery entry. */
export async function fetchSource(entry, baseUrl) {
  const check = validateRepoRelativePath(entry.sourcePath);
  if (!check.ok) return { ok: false, error: { category: "gallery", code: "bad-path", message: `Unsafe source path (${check.reason}).` } };
  const resolved = resolveWithinBase(check.path, baseUrl);
  if (!resolved.ok) return { ok: false, error: { category: "gallery", code: "bad-path", message: `Source path escapes the base (${resolved.reason}).` } };
  try {
    const res = await fetch(resolved.url, { credentials: "omit" });
    if (!res.ok) return { ok: false, error: { category: "gallery", code: `http-${res.status}`, message: `Could not load source for '${entry.id}'.` } };
    const text = await res.text();
    return { ok: true, source: normalizeLineEndings(text) };
  } catch {
    return { ok: false, error: { category: "gallery", code: "fetch-failed", message: `Could not load source for '${entry.id}'.` } };
  }
}

/** Fetch a curated, same-origin D64 as bytes. */
export async function fetchCuratedD64(path, baseUrl) {
  const check = validateRepoRelativePath(path);
  if (!check.ok) return { ok: false, error: { category: "media", code: "bad-path", message: `Unsafe D64 path (${check.reason}).` } };
  const resolved = resolveWithinBase(check.path, baseUrl);
  if (!resolved.ok) return { ok: false, error: { category: "media", code: "bad-path", message: `D64 path escapes the base (${resolved.reason}).` } };
  try {
    const res = await fetch(resolved.url, { credentials: "omit" });
    if (!res.ok) return { ok: false, error: { category: "media", code: `http-${res.status}`, message: "Could not load curated media." } };
    const buf = await res.arrayBuffer();
    return { ok: true, bytes: new Uint8Array(buf) };
  } catch {
    return { ok: false, error: { category: "media", code: "fetch-failed", message: "Could not load curated media." } };
  }
}
