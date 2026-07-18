import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const romDir = join(repoRoot, "third_party", "pascual-roms");

const BASE_SHA256 = "c63f4933689e7582e6fa857564eb03df3466bd56ca1f9ab78e6b9f798ddeee39";
const OUTPUT_SHA256 = "543577ca940e8ad88906de4d173bb995ec434a789698319d62f8441cecf579af";
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
  0x4c, 0x30, 0xd3,       // JMP reset_channel_name
  0xea, 0xea, 0xea, 0xea,
]);
const filenameResetRoutineOffset = 0x1330;
const filenameResetRoutine = Uint8Array.from([
  0xa5, 0x02,             // LDA iec_sa
  0xd0, 0x09,             // BNE save_open
  0xa9, 0x00,             // LDA #0
  0x85, 0x09,             // STA data_idx
  0x85, 0x0a,             // STA iec_chan_mode
  0x4c, 0x48, 0xc2,       // JMP command_loop
  0x4c, 0xd2, 0xc2,       // save_open: JMP original handler
]);

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
  if (
    !bytes
      .slice(filenameResetRoutineOffset, filenameResetRoutineOffset + filenameResetRoutine.length)
      .every((value) => value === 0xff)
  ) {
    throw new Error("build-drive-rom: the reviewed filename-reset routine region is not erased ROM space");
  }

  bytes.set(matcherAfter, matcherOffset);
  bytes.set(wildcardRoutine, wildcardRoutineOffset);
  bytes.set(filenameResetAfter, filenameResetOffset);
  bytes.set(filenameResetRoutine, filenameResetRoutineOffset);
  const digest = sha256(bytes);
  if (digest !== OUTPUT_SHA256) {
    throw new Error("build-drive-rom: generated DOS-1541 digest does not match the reviewed identity");
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
