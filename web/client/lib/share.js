// Share helper (browser). Computes a `?code` share URL and copies it, but only after the caller
// has shown the public bearer-data warning. When the URL would exceed the length budget, the
// caller falls back to a source-file download. See specs/WEB-CLIENT.md.

import { buildShare } from "./downloadsCore.js";

/** Compute the share for the current source against the app's base URL (no query/hash). */
export function computeShare(source, baseUrl) {
  return buildShare(source, baseUrl);
}

/** Copy text to the clipboard. Returns { ok } — a failure is surfaced so the user can copy by hand. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
  } catch {
    /* fall through */
  }
  return { ok: false };
}
