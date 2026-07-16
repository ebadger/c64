// URL/state contract resolution for `?code`, `?src`, and `?d64`. Environment-free and pure so it
// is exhaustively Node-testable. See specs/WEB-CLIENT.md "URL and local-state rules".
//
// Guarantees enforced here:
//  - `?code` (base64url UTF-8, <=256 KiB decoded) is an ephemeral remix using documented default
//    settings; consuming one raises a public bearer-data notice.
//  - `?src` selects a committed gallery entry by id.
//  - `?code` takes precedence over `?src` for source content.
//  - `?d64` is independent but resolves ONLY through a valid gallery entry that declares a
//    same-origin curated D64 path.
//  - Duplicate, malformed, or unknown values produce a visible error and never silently select
//    another project (a bad value yields a blank default editor plus an explicit error).

import { decodeCodeToSource } from "./base64url.js";
import { MAX_DECODED_SOURCE_BYTES } from "./config.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function urlError(code, message) {
  return { category: "url", code, message };
}

/** Normalize a query input (string with optional leading '?', or URLSearchParams). */
function toParams(input) {
  if (input instanceof URLSearchParams) return input;
  let str = String(input ?? "");
  if (str.startsWith("?")) str = str.slice(1);
  return new URLSearchParams(str);
}

/**
 * Resolve the initial project intent from the URL query and the validated gallery.
 * @param {string|URLSearchParams} query
 * @param {Map<string, object>} galleryById validated entries keyed by id
 * @returns {{
 *   sourceOrigin: "code"|"src"|"default",
 *   source: string|null,
 *   galleryEntry: object|null,
 *   d64: { entry: object, path: string }|null,
 *   bearerWarning: boolean,
 *   errors: object[],
 *   notices: string[],
 * }}
 */
export function resolveUrlState(query, galleryById = new Map()) {
  const params = toParams(query);
  const errors = [];
  const notices = [];

  const codes = params.getAll("code");
  const srcs = params.getAll("src");
  const d64s = params.getAll("d64");

  let sourceOrigin = "default";
  let source = null;
  let galleryEntry = null;
  let bearerWarning = false;

  // --- Source: `code` takes precedence over `src`. A malformed value is a hard, visible error
  // and does not fall back to another project.
  let sourceResolved = false;
  if (codes.length > 1) {
    errors.push(urlError("duplicate-code", "The share URL has more than one ?code value."));
    sourceResolved = true;
  } else if (codes.length === 1) {
    const decoded = decodeCodeToSource(codes[0], MAX_DECODED_SOURCE_BYTES);
    if (decoded.ok) {
      sourceOrigin = "code";
      source = decoded.source;
      bearerWarning = true;
      notices.push(
        "This project came from a shared link. A ?code link is public bearer data: anyone with it can read it, it cannot be revoked, and edits are not shared until you press Share.",
      );
      if (srcs.length > 0) notices.push("The ?src value was ignored because ?code takes precedence.");
    } else {
      const reason = decoded.reason === "too-large" ? "too-large" : "malformed-code";
      errors.push(
        urlError(
          reason,
          reason === "too-large"
            ? "The shared source exceeds the 256 KiB limit. Ask the sender to share the source file instead."
            : `The ?code value could not be decoded (${decoded.reason}).`,
        ),
      );
    }
    sourceResolved = true;
  }

  if (!sourceResolved) {
    if (srcs.length > 1) {
      errors.push(urlError("duplicate-src", "The URL has more than one ?src value."));
    } else if (srcs.length === 1) {
      const id = srcs[0];
      if (!ID_RE.test(id)) {
        errors.push(urlError("invalid-src", `The ?src id '${id}' is not a valid gallery id.`));
      } else if (!galleryById.has(id)) {
        errors.push(urlError("unknown-src", `No gallery entry has id '${id}'.`));
      } else {
        sourceOrigin = "src";
        galleryEntry = galleryById.get(id);
      }
    }
  }

  // --- Curated D64 (independent of source), resolved only through a valid gallery entry.
  let d64 = null;
  if (d64s.length > 1) {
    errors.push(urlError("duplicate-d64", "The URL has more than one ?d64 value."));
  } else if (d64s.length === 1) {
    const id = d64s[0];
    if (!ID_RE.test(id)) {
      errors.push(urlError("invalid-d64", `The ?d64 id '${id}' is not a valid gallery id.`));
    } else if (!galleryById.has(id)) {
      errors.push(urlError("unknown-d64", `No gallery entry has id '${id}'.`));
    } else {
      const entry = galleryById.get(id);
      if (!entry.curatedD64Path) {
        errors.push(urlError("no-curated-d64", `Gallery entry '${id}' declares no curated D64.`));
      } else {
        d64 = { entry, path: entry.curatedD64Path };
      }
    }
  }

  return { sourceOrigin, source, galleryEntry, d64, bearerWarning, errors, notices };
}

/**
 * Build a shareable `?code` query string for the given source. Pure string assembly; the caller
 * enforces URL-length policy.
 * @param {string} code base64url payload
 */
export function shareQueryForCode(code) {
  return `?code=${code}`;
}
