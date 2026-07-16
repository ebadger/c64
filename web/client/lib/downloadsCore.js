// Pure download/share decision logic. Environment-free so the byte/URL policy is Node-testable;
// the actual Blob creation, anchor click, and URL.revokeObjectURL live in the browser module
// downloads.js. See specs/WEB-CLIENT.md and specs/MEDIA.md.

import { downloadFilename } from "../../../src/prg.js";
import { encodeSourceToCode } from "./base64url.js";
import { MAX_SHARE_URL_CHARS } from "./config.js";

export { downloadFilename };

/** Sanitized `.asm` filename for a source download fallback. */
export function sourceFilename(name) {
  return downloadFilename(name, "asm");
}

/**
 * Compute the `?code` share for a source string against a base URL, and decide whether the
 * resulting URL is within the length budget. When it is not, the caller offers a source-file
 * download instead of a truncatable link.
 * @param {string} source
 * @param {string} baseUrl absolute base (e.g. location.origin + pathname), no query/hash
 * @returns {{ code: string, query: string, url: string, urlLength: number, withinLimit: boolean }}
 */
export function buildShare(source, baseUrl) {
  const code = encodeSourceToCode(source);
  const query = `?code=${code}`;
  const url = `${baseUrl}${query}`;
  return { code, query, url, urlLength: url.length, withinLimit: url.length <= MAX_SHARE_URL_CHARS };
}
