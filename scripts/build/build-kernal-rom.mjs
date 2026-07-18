import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const romDir = join(repoRoot, "third_party", "pascual-roms");

const BASE_SHA256 = "5423d7dbbf678a17640f08465705aaab5bf04975281c48b3d343e7cb64a3c414";
const OUTPUT_SHA256 = "6545abf06d097be2f95039a77e1cdf44eba3d669808717094a1fcf9cebb0fa97";
const ROM_BYTES = 8192;

const routineOffset = 0x0179;
const routine = Uint8Array.from([
  0x20, 0xd2, 0xed,       // JSR KACPTR
  0x85, 0xad,             // STA KLDTMPHI
  0x60,                   // RTS
  0xa5, 0xb9,             // LDA KSA
  0xf0, 0x0c,             // BEQ set_boundary
  0xa5, 0xac,             // LDA KLDTMP
  0xc5, 0x28,             // CMP TXTTAB
  0xd0, 0x08,             // BNE done
  0xa5, 0xad,             // LDA KLDTMPHI
  0xc5, 0x29,             // CMP TXTTAB+1
  0xd0, 0x02,             // BNE done
  0x86, 0x2a,             // set_boundary: STX VARTAB
  0x60,                   // done: RTS
]);

const basicBoundaryOffset = 0x1019;
const basicBoundaryBefore = Uint8Array.from([
  0xa5, 0xb9,             // LDA KSA
  0xd0, 0x21,             // BNE return
  0x86, 0x2a,             // STX VARTAB
]);
const basicBoundaryAfter = Uint8Array.from([
  0x20, 0x7f, 0xe1,       // JSR update_basic_boundary
  0xd0, 0x20,             // BNE return
  0xea,                   // preserve the following STY VARTAB+1 address
]);

const loadAddressOffset = 0x10fc;
const loadAddressBefore = Uint8Array.from([0x20, 0xd2, 0xed]);
const loadAddressAfter = Uint8Array.from([0x20, 0x79, 0xe1]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function equalAt(bytes, offset, expected) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function buildKernalRom({
  basePath = join(romDir, "kernal-upstream.rom"),
  outputPath = join(romDir, "kernal.rom"),
  check = false,
} = {}) {
  const bytes = new Uint8Array(readFileSync(basePath));
  if (bytes.length !== ROM_BYTES || sha256(bytes) !== BASE_SHA256) {
    throw new Error("build-kernal-rom: the pinned upstream KERNAL base failed integrity validation");
  }
  if (!equalAt(bytes, basicBoundaryOffset, basicBoundaryBefore)) {
    throw new Error("build-kernal-rom: the BASIC boundary patch site no longer matches");
  }
  if (!equalAt(bytes, loadAddressOffset, loadAddressBefore)) {
    throw new Error("build-kernal-rom: the load-address patch site no longer matches");
  }
  if (!bytes.slice(routineOffset, routineOffset + routine.length).every((value) => value === 0x00)) {
    throw new Error("build-kernal-rom: the reviewed compatibility routine region is not zero-filled");
  }

  bytes.set(routine, routineOffset);
  bytes.set(basicBoundaryAfter, basicBoundaryOffset);
  bytes.set(loadAddressAfter, loadAddressOffset);
  const digest = sha256(bytes);
  if (digest !== OUTPUT_SHA256) {
    throw new Error("build-kernal-rom: generated KERNAL digest does not match the reviewed identity");
  }

  if (check) {
    const current = new Uint8Array(readFileSync(outputPath));
    if (current.length !== bytes.length || !current.every((value, index) => value === bytes[index])) {
      throw new Error("build-kernal-rom: committed kernal.rom is not the deterministic patched output");
    }
  } else {
    writeFileSync(outputPath, bytes);
  }
  return { bytes: bytes.length, sha256: digest };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = buildKernalRom({ check: process.argv.includes("--check") });
  console.log(`KERNAL ROM: ${result.bytes} bytes, sha256 ${result.sha256}`);
}
