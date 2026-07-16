// Declared 16-colour C64 palette (presentation only; never affects machine state or collision
// logic — see specs/VIC-II.md and specs/WEB-CLIENT.md). Environment-free so the RGBA conversion
// is Node-testable. Values are the widely used "Pepto" PAL palette.

// Each entry is [R, G, B]; index is the 4-bit VIC-II colour index.
export const C64_PALETTE_RGB = Object.freeze([
  [0x00, 0x00, 0x00], // 0 black
  [0xff, 0xff, 0xff], // 1 white
  [0x68, 0x37, 0x2b], // 2 red
  [0x70, 0xa4, 0xb2], // 3 cyan
  [0x6f, 0x3d, 0x86], // 4 purple
  [0x58, 0x8d, 0x43], // 5 green
  [0x35, 0x28, 0x79], // 6 blue
  [0xb8, 0xc7, 0x6f], // 7 yellow
  [0x6f, 0x4f, 0x25], // 8 orange
  [0x43, 0x39, 0x00], // 9 brown
  [0x9a, 0x67, 0x59], // 10 light red
  [0x44, 0x44, 0x44], // 11 dark grey
  [0x6c, 0x6c, 0x6c], // 12 grey
  [0x9a, 0xd2, 0x84], // 13 light green
  [0x6c, 0x5e, 0xb5], // 14 light blue
  [0x95, 0x95, 0x95], // 15 light grey
]);

// Flattened RGBA lookup (16 entries × 4 bytes), alpha = 255.
export const PALETTE_RGBA = (() => {
  const table = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = C64_PALETTE_RGB[i];
    table[i * 4] = r;
    table[i * 4 + 1] = g;
    table[i * 4 + 2] = b;
    table[i * 4 + 3] = 255;
  }
  return table;
})();

/**
 * Expand an indexed framebuffer (one 4-bit colour index per byte) into RGBA, writing into `out`.
 * Only the low nibble of each index byte is used. Returns `out` for convenience.
 * @param {Uint8Array} indexed
 * @param {Uint8ClampedArray} out length must be indexed.length * 4
 */
export function indexedToRgba(indexed, out) {
  const n = indexed.length;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const c = (indexed[i] & 0x0f) * 4;
    out[o] = PALETTE_RGBA[c];
    out[o + 1] = PALETTE_RGBA[c + 1];
    out[o + 2] = PALETTE_RGBA[c + 2];
    out[o + 3] = 255;
  }
  return out;
}
