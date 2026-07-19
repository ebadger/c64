import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const romDir = join(repoRoot, "third_party", "pascual-roms");

const BASE_SHA256 = "5423d7dbbf678a17640f08465705aaab5bf04975281c48b3d343e7cb64a3c414";
const OUTPUT_SHA256 = "dbf227205959580b188d5e93c9f1cffb6e19897957af6d2525c88e5e72ab6f06";
const ROM_BYTES = 8192;

const loadRoutineOffset = 0x0179;
const loadRoutine = Uint8Array.from([
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

const cursorRoutineOffset = 0x0a2b;
const cursorRoutine = Uint8Array.from([
  0x48,                   // PHA
  0xad, 0xad, 0x02,       // LDA KBLON
  0xf0, 0x23,             // BEQ done
  0x78,                   // SEI
  0x98, 0x48,             // TYA; PHA
  0xa4, 0xd3,             // LDY KCOL
  0xb1, 0xd1,             // LDA (KPNT),Y
  0x49, 0x80,             // EOR #$80
  0x91, 0xd1,             // STA (KPNT),Y
  0xa5, 0xd1, 0x85, 0xfb, // KCPTR = KPNT
  0xa5, 0xd2, 0x18,       // LDA KPNT+1; CLC
  0x69, 0xd4, 0x85, 0xfc, // ADC #$D4; STA KCPTR+1
  0xad, 0x87, 0x02,       // LDA KGDCOL
  0x91, 0xfb,             // STA (KCPTR),Y
  0xa9, 0x00,             // LDA #0
  0x8d, 0xad, 0x02,       // STA KBLON
  0x68, 0xa8,             // PLA; TAY
  0x58,                   // CLI
  0x68, 0x60,             // done: PLA; RTS
]);
const relocatedCursorOffset = 0x0192;
const cursorRedirect = Uint8Array.from([0x4c, 0x92, 0xe1]); // JMP relocated cursor routine
const irqContinueOffset = 0x0a31;
const irqContinue = Uint8Array.from([0x4c, 0x95, 0xea]); // JMP default IRQ handler

const unlistenCallOffset = 0x0ccd;
const unlistenCallBefore = Uint8Array.from([0x20, 0x06, 0xed]); // JSR KISEND
const unlistenCallAfter = Uint8Array.from([0x20, 0xbd, 0xe1]); // JSR send_unlisten
const unlistenRoutineOffset = 0x01bd;
const unlistenRoutine = Uint8Array.from([
  0xa9, 0x3f,             // LDA #$3F
  0x4c, 0x06, 0xed,       // JMP KISEND
]);

const ramClearOffset = 0x025f;
const ramClearBefore = Uint8Array.from([0x95, 0x02, 0xe8, 0xd0, 0xfb]);
const ramClearAfter = Uint8Array.from([0x20, 0xc2, 0xe1, 0xea, 0xea]); // JSR clear_zp; NOP; NOP
const ramClearRoutineOffset = 0x01c2;
const ramClearRoutine = Uint8Array.from([
  0xa2, 0x02,             // LDX #2
  0x95, 0x00,             // clear_zp: STA $00,X
  0xe8,                   // INX
  0xd0, 0xfb,             // BNE clear_zp
  0x60,                   // RTS
]);

const keyboardIdleOffsets = [0x05bc, 0x0a70];
const keyboardIdleBefore = 0x00;
const keyboardIdleAfter = 0x7f;

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
  if (!equalAt(bytes, cursorRoutineOffset, cursorRoutine)) {
    throw new Error("build-kernal-rom: the cursor routine no longer matches the reviewed bytes");
  }
  if (!equalAt(bytes, unlistenCallOffset, unlistenCallBefore)) {
    throw new Error("build-kernal-rom: the UNLSN patch site no longer matches");
  }
  if (!equalAt(bytes, ramClearOffset, ramClearBefore)) {
    throw new Error("build-kernal-rom: the RAMTAS patch site no longer matches");
  }
  if (!keyboardIdleOffsets.every((offset) => bytes[offset] === keyboardIdleBefore)) {
    throw new Error("build-kernal-rom: a keyboard idle-state patch site no longer matches");
  }
  const compatibilityEnd = ramClearRoutineOffset + ramClearRoutine.length;
  if (
    !bytes
      .slice(loadRoutineOffset, compatibilityEnd)
      .every((value) => value === 0x00)
  ) {
    throw new Error("build-kernal-rom: the reviewed compatibility routine region is not zero-filled");
  }

  bytes.set(loadRoutine, loadRoutineOffset);
  bytes.set(cursorRoutine, relocatedCursorOffset);
  bytes.set(unlistenRoutine, unlistenRoutineOffset);
  bytes.set(ramClearRoutine, ramClearRoutineOffset);
  bytes.set(cursorRedirect, cursorRoutineOffset);
  bytes.set(irqContinue, irqContinueOffset);
  bytes.set(unlistenCallAfter, unlistenCallOffset);
  bytes.set(ramClearAfter, ramClearOffset);
  for (const offset of keyboardIdleOffsets) bytes[offset] = keyboardIdleAfter;
  bytes.set(basicBoundaryAfter, basicBoundaryOffset);
  bytes.set(loadAddressAfter, loadAddressOffset);
  const digest = sha256(bytes);
  if (digest !== OUTPUT_SHA256) {
    throw new Error(
      `build-kernal-rom: generated KERNAL digest ${digest} does not match the reviewed identity`,
    );
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
