// URL source-parameter selection. Pure and Node-testable. See specs/WEB-CLIENT.md: `code`
// takes precedence over `src`, and duplicate `code`/`src` values are a visible error rather
// than a silent first-wins selection.

import { appError } from "./errors.v1.js";

/**
 * Read the editor source parameters from a URL query string. Throws a stable-category error on
 * duplicate `code` or `src` parameters; otherwise returns the single values (or null).
 * @param {string} search  e.g. location.search ("?code=...&src=...")
 * @returns {{ code: string|null, src: string|null }}
 */
export function readEditorParams(search) {
  const params = new URLSearchParams(search);
  if (params.getAll("code").length > 1) {
    throw appError("share", "The URL has duplicate ?code parameters; refusing to guess which to load.");
  }
  if (params.getAll("src").length > 1) {
    throw appError("media", "The URL has duplicate ?src parameters; refusing to guess which to load.");
  }
  return { code: params.get("code"), src: params.get("src") };
}
