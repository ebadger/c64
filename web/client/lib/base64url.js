// base64url + UTF-8 helpers for `?code` share/remix. Environment-free and dependency-light: a
// self-contained base64 codec (no atob/btoa/Buffer) so browser, worker, and Node behave
// identically. Standard base64 `+`/`/` are rejected; padding `=` is optional (see WEB-CLIENT.md).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DECODE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

const encoder = new TextEncoder();

/**
 * Encode raw bytes to an unpadded base64url string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64url(bytes) {
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + ALPHABET[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63];
  }
  return out;
}

/**
 * Decode a base64url string to bytes. Rejects standard base64 (`+`/`/`) and any other invalid
 * character with a stable reason. `maxBytes` bounds the decoded length and is checked from the
 * input length *before* allocating the output buffer, preventing allocation amplification.
 * @param {string} str
 * @param {number} maxBytes
 * @returns {{ ok: true, bytes: Uint8Array } | { ok: false, reason: string }}
 */
export function base64urlToBytes(str, maxBytes = Infinity) {
  if (typeof str !== "string") return { ok: false, reason: "not-a-string" };
  // Strip optional trailing padding only; interior '=' is invalid.
  let end = str.length;
  while (end > 0 && str[end - 1] === "=") end--;
  const body = str.slice(0, end);
  if (body.length === 0) return { ok: false, reason: "empty" };

  // Validate charset and reject standard-base64 markers up front.
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c === 43 /* + */ || c === 47 /* / */) return { ok: false, reason: "standard-base64" };
    if (c > 127 || DECODE[c] === -1) return { ok: false, reason: "invalid-character" };
  }
  // A base64 group of length 1 (mod 4) is structurally impossible.
  if (body.length % 4 === 1) return { ok: false, reason: "invalid-length" };

  const fullGroups = Math.floor(body.length / 4);
  const remChars = body.length - fullGroups * 4; // 0, 2, or 3
  const outLen = fullGroups * 3 + (remChars === 2 ? 1 : remChars === 3 ? 2 : 0);
  if (outLen > maxBytes) return { ok: false, reason: "too-large" };

  const bytes = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  for (let g = 0; g < fullGroups; g++, i += 4) {
    const n =
      (DECODE[body.charCodeAt(i)] << 18) |
      (DECODE[body.charCodeAt(i + 1)] << 12) |
      (DECODE[body.charCodeAt(i + 2)] << 6) |
      DECODE[body.charCodeAt(i + 3)];
    bytes[o++] = (n >>> 16) & 0xff;
    bytes[o++] = (n >>> 8) & 0xff;
    bytes[o++] = n & 0xff;
  }
  if (remChars === 2) {
    const n = (DECODE[body.charCodeAt(i)] << 18) | (DECODE[body.charCodeAt(i + 1)] << 12);
    bytes[o++] = (n >>> 16) & 0xff;
  } else if (remChars === 3) {
    const n =
      (DECODE[body.charCodeAt(i)] << 18) |
      (DECODE[body.charCodeAt(i + 1)] << 12) |
      (DECODE[body.charCodeAt(i + 2)] << 6);
    bytes[o++] = (n >>> 16) & 0xff;
    bytes[o++] = (n >>> 8) & 0xff;
  }
  return { ok: true, bytes };
}

/**
 * Encode source text to a base64url `?code` payload (UTF-8).
 * @param {string} source
 * @returns {string}
 */
export function encodeSourceToCode(source) {
  return bytesToBase64url(encoder.encode(String(source)));
}

/**
 * Decode a `?code` payload back to source text, enforcing a byte cap and strict UTF-8.
 * @param {string} code
 * @param {number} maxBytes
 * @returns {{ ok: true, source: string } | { ok: false, reason: string }}
 */
export function decodeCodeToSource(code, maxBytes = Infinity) {
  if (code === "") return { ok: true, source: "" };
  const decoded = base64urlToBytes(code, maxBytes);
  if (!decoded.ok) return decoded;
  try {
    // fatal:true rejects malformed UTF-8 rather than substituting U+FFFD.
    const source = new TextDecoder("utf-8", { fatal: true }).decode(decoded.bytes);
    return { ok: true, source };
  } catch {
    return { ok: false, reason: "invalid-utf8" };
  }
}
