// PRG validation and download-name helpers. See specs/MEDIA.md.
//
// The media layer validates standard bytes and never infers a run address; run metadata comes
// from the SourceProject. Downloaded bytes are exactly the assembler bytes.

/** @typedef {{ code: string, message: string }} MediaError */

function mediaError(code, message) {
  return { ok: false, metadata: null, warnings: [], error: { code, message } };
}

/**
 * Validate a PRG byte stream and return its load/end metadata without executing it.
 * @param {Uint8Array} bytes
 * @returns {{ ok: boolean, metadata: object|null, warnings: object[], error: MediaError|null }}
 */
export function parsePrg(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return mediaError("invalid-prg", "PRG input must be a Uint8Array.");
  }
  if (bytes.length < 3) {
    return mediaError("invalid-prg", "PRG must have a 2-byte load address and at least one data byte.");
  }
  const loadAddress = bytes[0] | (bytes[1] << 8);
  const dataLength = bytes.length - 2;
  const endAddress = loadAddress + dataLength;
  if (endAddress > 0x10000) {
    return mediaError("invalid-prg", `PRG data wraps past $FFFF (ends at $${endAddress.toString(16)}).`);
  }
  return {
    ok: true,
    metadata: { loadAddress, dataLength, endAddress },
    warnings: [],
    error: null,
  };
}

/**
 * Derive a sanitized, lowercase ASCII download filename with the given extension. Characters
 * outside [a-z0-9-_] collapse to '-'; the result is never empty.
 * @param {string} outputName
 * @param {"prg"|"d64"} ext
 */
export function downloadFilename(outputName, ext) {
  let base = String(outputName)
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base === "") {
    base = "program";
  }
  return `${base}.${ext}`;
}
