// Dependency-light, synchronous SHA-256 over raw bytes.
//
// The build identity must be computed identically in modern browsers and in Node.js from a
// single implementation. Node's `crypto` module and the browser's `crypto.subtle` digest
// diverge (one is Node-only, the other is asynchronous), so neither yields "one
// implementation that runs unchanged" for a synchronous AssemblyResult.buildId. A small pure
// ES-module implementation keeps the assembler synchronous, deterministic, and portable.
//
// This is a standard FIPS 180-4 SHA-256 over a byte sequence; it is used only for content
// addressing (build identity), never for security.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Compute the lowercase hexadecimal SHA-256 digest of the supplied bytes.
 * @param {Uint8Array} bytes
 * @returns {string} 64-character lowercase hex string.
 */
export function sha256Hex(bytes) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const messageLengthBits = bytes.length * 8;
  // Pad to a multiple of 64 bytes: 0x80, then zeros, then a 64-bit big-endian bit length.
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 64-bit length; JS bitwise math is 32-bit, so split the high/low words. Message lengths in
  // this pipeline never approach 2^53 bits, so the high word is computed with float math.
  const highWord = Math.floor(messageLengthBits / 0x100000000);
  const lowWord = messageLengthBits >>> 0;
  const lengthOffset = paddedLength - 8;
  padded[lengthOffset] = (highWord >>> 24) & 0xff;
  padded[lengthOffset + 1] = (highWord >>> 16) & 0xff;
  padded[lengthOffset + 2] = (highWord >>> 8) & 0xff;
  padded[lengthOffset + 3] = highWord & 0xff;
  padded[lengthOffset + 4] = (lowWord >>> 24) & 0xff;
  padded[lengthOffset + 5] = (lowWord >>> 16) & 0xff;
  padded[lengthOffset + 6] = (lowWord >>> 8) & 0xff;
  padded[lengthOffset + 7] = lowWord & 0xff;

  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += h[i].toString(16).padStart(8, "0");
  }
  return hex;
}
