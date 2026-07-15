// Explicit, documented ASCII -> PETSCII mapping for text and character literals.
//
// The C64 has two character sets (the default uppercase/graphics set and the shifted
// lowercase/uppercase set), so a byte's *rendered glyph* depends on the active charset. The
// byte *mapping* below is fixed and deterministic regardless of charset, which is what
// matters for artifact bytes. Any input outside the supported set is reported as an error
// (`unsupported-character`) rather than silently lossily converted.
//
// Supported input code points and their PETSCII byte:
//   0x20..0x5A  (space .. '@' 'A'..'Z')  -> identity (0x20..0x5A)
//   0x5B '['                             -> 0x5B
//   0x5D ']'                             -> 0x5D
//   0x61..0x7A ('a'..'z')                -> 0xC1..0xDA   (add 0x60)
// Everything else (control characters, '\\' '^' '_' '`' '{'..'~', and any non-ASCII / Unicode
// code point) is unsupported.

/**
 * Map a single Unicode code point to a PETSCII byte.
 * @param {number} codePoint
 * @returns {number|null} PETSCII byte, or null when unsupported.
 */
export function encodePetsciiCodePoint(codePoint) {
  if (codePoint >= 0x20 && codePoint <= 0x5a) {
    return codePoint;
  }
  if (codePoint === 0x5b) {
    return 0x5b;
  }
  if (codePoint === 0x5d) {
    return 0x5d;
  }
  if (codePoint >= 0x61 && codePoint <= 0x7a) {
    return codePoint + 0x60;
  }
  return null;
}

/**
 * Encode a JavaScript string (iterated by Unicode code point) into PETSCII bytes.
 * @param {string} text
 * @returns {{ ok: boolean, bytes: number[], badIndex: number, badChar: string }}
 *   `ok` is false when a code point is unsupported; `badIndex` is the code-point index and
 *   `badChar` the offending character.
 */
export function encodePetsciiString(text) {
  const bytes = [];
  let index = 0;
  for (const ch of text) {
    const byte = encodePetsciiCodePoint(ch.codePointAt(0));
    if (byte === null) {
      return { ok: false, bytes, badIndex: index, badChar: ch };
    }
    bytes.push(byte);
    index += 1;
  }
  return { ok: true, bytes, badIndex: -1, badChar: "" };
}
