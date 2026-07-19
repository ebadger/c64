import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const romDir = join(repoRoot, "third_party", "pascual-roms");

const BASE_SHA256 = "c63f4933689e7582e6fa857564eb03df3466bd56ca1f9ab78e6b9f798ddeee39";
const OUTPUT_SHA256 = "725047c3310d843b99c02dbd35699b2d6ccfe07f16adef28025cb5519d89dd39";
const ROM_BYTES = 16384;

const matcherOffset = 0x0d4f;
const matcherBefore = Uint8Array.from([
  0xb9, 0x00, 0x07, 0xdd, 0x80, 0x02, 0xd0, 0x0e, 0xc8, 0xe8, 0xe0, 0x10, 0xd0, 0xf2,
]);
const matcherAfter = Uint8Array.from([
  0x20, 0x15, 0xd3, 0x90, 0x0f, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea,
]);

const wildcardRoutineOffset = 0x1315;
const wildcardRoutine = Uint8Array.from([
  0xbd, 0x80, 0x02,       // LDA NAME_BUF,X
  0xc9, 0x2a, 0xf0, 0x0f, // '*' matches the remaining filename
  0xc9, 0x3f, 0xf0, 0x05, // '?' matches one character
  0xd9, 0x00, 0x07, 0xd0, 0x08,
  0xc8, 0xe8, 0xe0, 0x10, 0xd0, 0xea,
  0x38, 0x60,             // match: SEC; RTS
  0x18, 0x60,             // mismatch: CLC; RTS
]);

const filenameResetOffset = 0x02cb;
const filenameResetBefore = Uint8Array.from([
  0xa5, 0x02,             // LDA iec_sa
  0xd0, 0x03,             // BNE save_open
  0x4c, 0x48, 0xc2,       // JMP command_loop
]);
const filenameResetAfter = Uint8Array.from([
  0x4c, 0xd7, 0xd3,       // JMP compatibility secondary OPEN handler
  0xea, 0xea, 0xea, 0xea,
]);

const talkHookOffset = 0x00ab;
const talkHookBefore = Uint8Array.from([0xad, 0x00, 0x03]); // LDA DATA_BUF
const talkHookAfter = Uint8Array.from([0x4c, 0x50, 0xd3]); // JMP compatibility talk dispatcher

const secondaryDataHookOffset = 0x02df;
const secondaryDataHookBefore = Uint8Array.from([0xa5, 0x02, 0xd0]); // LDA iec_sa; BNE
const secondaryDataHookAfter = Uint8Array.from([0x4c, 0xbb, 0xd3]); // JMP secondary_data

const directRoutineOffset = 0x1350;
const directRoutine = bytesFromHex(`
  a5 02 c9 0f f0 1f a5 6c f0 0e a5 6b c9 02 90 08
  c9 0f b0 04 c5 02 f0 32 ad 00 03 c9 24 f0 03 4c
  d4 c0 4c b2 c0 a5 09 f0 07 20 2f d4 a9 00 85 09
  a9 90 85 0e a9 02 85 0f a5 5c 85 10 a9 00 85 11
  a9 ff 85 12 20 fd c0 4c d7 c0 a5 6c f0 1a a9 00
  85 0e a9 04 85 0f a9 01 85 10 a9 01 85 11 a9 ff
  85 12 20 fd c0 4c d7 c0 4c d4 c0 a5 01 29 02 d0
  10 a5 02 f0 0c c9 0f d0 0b a9 00 85 09 85 0a 85
  0b 4c 48 c2 4c e6 c2 a5 02 f0 04 c9 0f d0 0b a9
  00 85 09 85 0a 85 0b 4c 48 c2 4c d2 c2 e4 09 b0
  0e bd 00 03 c9 30 90 04 c9 3a 90 05 e8 d0 ee 38
  60 a9 00 85 6d e4 09 b0 22 bd 00 03 c9 30 90 1b
  c9 3a b0 17 38 e9 30 85 6f a5 6d 0a 85 6e 0a 0a
  18 65 6e 18 65 6f 85 6d e8 d0 da a5 6d 18 60 a9
  00 85 6c 85 5a 85 5b ad 00 03 c9 55 d0 50 ad 01
  03 c9 31 d0 49 a2 02 20 ed d3 b0 42 85 6b 20 ed
  d3 b0 3b c9 00 d0 37 20 ed d3 b0 32 85 27 85 5a
  20 ed d3 b0 29 85 28 85 5b 4c 77 d4 ea ea ea ea
  ea ea ea ea ea ea ea 20 a1 c5 a5 2c d0 17 a9 00
  8d 00 04 a9 ff 85 6c a9 00 85 59 4c cd ce a9 1e
  85 59 4c cd ce a9 14 85 59 4c cd ce
`);

function bytesFromHex(source) {
  const hex = source.replace(/\s+/g, "");
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) {
    throw new Error("build-drive-rom: invalid embedded compatibility routine");
  }
  return Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function equalAt(bytes, offset, expected) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function buildDriveRom({
  basePath = join(romDir, "dos1541-upstream.rom"),
  outputPath = join(romDir, "dos1541.rom"),
  check = false,
} = {}) {
  const bytes = new Uint8Array(readFileSync(basePath));
  if (bytes.length !== ROM_BYTES || sha256(bytes) !== BASE_SHA256) {
    throw new Error("build-drive-rom: the pinned upstream DOS-1541 base failed integrity validation");
  }
  if (!equalAt(bytes, matcherOffset, matcherBefore)) {
    throw new Error("build-drive-rom: the upstream filename matcher no longer matches the reviewed patch site");
  }
  if (
    !bytes
      .slice(wildcardRoutineOffset, wildcardRoutineOffset + wildcardRoutine.length)
      .every((value) => value === 0xff)
  ) {
    throw new Error("build-drive-rom: the reviewed wildcard routine region is not erased ROM space");
  }
  if (!equalAt(bytes, filenameResetOffset, filenameResetBefore)) {
    throw new Error("build-drive-rom: the channel-0 OPEN handler no longer matches the reviewed patch site");
  }
  if (!equalAt(bytes, talkHookOffset, talkHookBefore)) {
    throw new Error("build-drive-rom: the TALK dispatcher patch site no longer matches");
  }
  if (!equalAt(bytes, secondaryDataHookOffset, secondaryDataHookBefore)) {
    throw new Error("build-drive-rom: the secondary DATA patch site no longer matches");
  }
  if (
    !bytes
      .slice(directRoutineOffset, directRoutineOffset + directRoutine.length)
      .every((value) => value === 0xff)
  ) {
    throw new Error("build-drive-rom: the reviewed direct-channel routine region is not erased ROM space");
  }

  bytes.set(matcherAfter, matcherOffset);
  bytes.set(wildcardRoutine, wildcardRoutineOffset);
  bytes.set(filenameResetAfter, filenameResetOffset);
  bytes.set(talkHookAfter, talkHookOffset);
  bytes.set(secondaryDataHookAfter, secondaryDataHookOffset);
  bytes.set(directRoutine, directRoutineOffset);
  const digest = sha256(bytes);
  if (digest !== OUTPUT_SHA256) {
    throw new Error(
      `build-drive-rom: generated DOS-1541 digest ${digest} does not match the reviewed identity`,
    );
  }

  if (check) {
    const current = new Uint8Array(readFileSync(outputPath));
    if (current.length !== bytes.length || !current.every((value, index) => value === bytes[index])) {
      throw new Error("build-drive-rom: committed dos1541.rom is not the deterministic patched output");
    }
  } else {
    writeFileSync(outputPath, bytes);
  }
  return { bytes: bytes.length, sha256: digest };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = buildDriveRom({ check: process.argv.includes("--check") });
  console.log(`DOS-1541 ROM: ${result.bytes} bytes, sha256 ${result.sha256}`);
}
