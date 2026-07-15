// Tokenized BASIC "10 SYS <addr>" stub used by basic-sys run mode. See specs/CODEGEN.md.
//
// Layout starting at the fixed BASIC load address $0801:
//   +0,+1  little-endian pointer to the next BASIC line (points at the terminating $00 $00)
//   +2,+3  line number 10 => $0A $00
//   +4     SYS token $9E
//   +5..   the run address as PETSCII decimal digits ($30..$39)
//   +N     $00  end of line
//   +N+1,2 $00 $00  end of program (null next-line pointer)
// Stub length is 8 + (number of decimal digits in the run address).

export const BASIC_LOAD_ADDRESS = 0x0801;
const SYS_TOKEN = 0x9e;
const BASIC_LINE_NUMBER = 10;

/**
 * Build the BASIC SYS stub bytes for a given run address.
 * @param {number} runAddress uint16 SYS target
 * @returns {Uint8Array}
 */
export function buildBasicSysStub(runAddress) {
  const digits = String(runAddress);
  const digitBytes = [];
  for (const ch of digits) {
    digitBytes.push(ch.charCodeAt(0));
  }
  const d = digitBytes.length;
  // The next-line pointer targets the end-of-program marker two zero bytes after the line
  // terminator: $0801 + 5 header bytes + d digit bytes + 1 line terminator.
  const nextLink = BASIC_LOAD_ADDRESS + 6 + d;
  const bytes = [
    nextLink & 0xff,
    (nextLink >> 8) & 0xff,
    BASIC_LINE_NUMBER & 0xff,
    (BASIC_LINE_NUMBER >> 8) & 0xff,
    SYS_TOKEN,
    ...digitBytes,
    0x00,
    0x00,
    0x00,
  ];
  return Uint8Array.from(bytes);
}

/** Byte length of the stub for a given run address. */
export function basicSysStubLength(runAddress) {
  return 8 + String(runAddress).length;
}

/**
 * The default machine-code origin in basic-sys mode is the byte immediately after the stub.
 * Because the stub length depends on the decimal digit count of the SYS target, and the SYS
 * target equals this origin when the source does not relocate, the origin is a fixed point of
 * `origin = $0801 + stubLength(origin)`. This converges immediately for $0801-based programs.
 * @returns {number}
 */
export function defaultBasicCodeOrigin() {
  let origin = BASIC_LOAD_ADDRESS + basicSysStubLength(BASIC_LOAD_ADDRESS + 12);
  for (let i = 0; i < 8; i++) {
    const next = BASIC_LOAD_ADDRESS + basicSysStubLength(origin);
    if (next === origin) {
      return origin;
    }
    origin = next;
  }
  return origin;
}
