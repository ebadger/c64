// URL share/remix codec: base64url UTF-8 encoding of editable source with the documented
// decoded-size cap. See specs/WEB-CLIENT.md "URL and local-state rules".
//
// Pure module (no DOM): the same code runs in the browser and in Node smoke tests. It relies
// only on TextEncoder/TextDecoder and btoa/atob, which exist in modern browsers and Node 18+.

import { appError } from "./errors.v1.js";

/**
 * Maximum decoded `?code` source size, in UTF-8 bytes. Oversized payloads are rejected before
 * the base64 is expanded so a hostile URL cannot force allocation amplification. This mirrors
 * the pipeline's own MAX_SOURCE_BYTES but is a distinct client-side gate.
 */
export const MAX_DECODED_SOURCE_BYTES = 256 * 1024;

// base64url uses '-' and '_' in place of '+' and '/'. Standard base64 '+' and '/' are invalid
// per spec; '=' padding is tolerated but optional.
const BASE64URL_RE = /^[A-Za-z0-9\-_]*={0,2}$/;
const CHUNK = 0x8000;

/**
 * Encode UTF-8 source into an unpadded base64url string suitable for a `?code` value.
 * @param {string} source
 * @returns {string}
 */
export function encodeShareSource(source) {
  const bytes = new TextEncoder().encode(String(source));
  if (bytes.length > MAX_DECODED_SOURCE_BYTES) {
    throw appError(
      "share",
      `Source is ${bytes.length} bytes, over the ${MAX_DECODED_SOURCE_BYTES}-byte share limit. Download the source instead.`,
    );
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Decode a `?code` base64url value into UTF-8 source. Rejects invalid characters, oversize
 * payloads (before allocation), and malformed UTF-8 with a stable `share` category error.
 * @param {string} value
 * @returns {string}
 */
export function decodeShareCode(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw appError("share", "Share code is empty.");
  }
  if (!BASE64URL_RE.test(value)) {
    throw appError("share", "Share code contains invalid base64url characters.");
  }

  const unpadded = value.replace(/=+$/g, "");
  // Estimate decoded size from the base64url length and reject before expanding the payload.
  const estimatedBytes = Math.floor((unpadded.length * 3) / 4);
  if (estimatedBytes > MAX_DECODED_SOURCE_BYTES) {
    throw appError(
      "share",
      `Shared source is about ${estimatedBytes} bytes, over the ${MAX_DECODED_SOURCE_BYTES}-byte limit. Download the source instead.`,
    );
  }

  let base64 = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = base64.length % 4;
  if (remainder === 2) base64 += "==";
  else if (remainder === 3) base64 += "=";
  else if (remainder === 1) throw appError("share", "Share code is truncated.");

  let binary;
  try {
    binary = atob(base64);
  } catch {
    throw appError("share", "Share code is not valid base64url.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.length > MAX_DECODED_SOURCE_BYTES) {
    throw appError("share", "Shared source exceeds the size limit.");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw appError("share", "Share code is not valid UTF-8 text.");
  }
}
