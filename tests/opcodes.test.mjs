import { test } from "node:test";
import assert from "node:assert/strict";
import { OPCODES } from "../src/opcodes.js";
import { assembleCode } from "./helpers.mjs";

// Operand text and expected trailing bytes for each addressing mode. Zero-page operands use
// $07 (forces zp); absolute operands use $1234 (forces abs); relative uses `*` (branch to
// self, delta -2 => 0xFE).
const MODE_OPERAND = {
  imp: "",
  acc: "A",
  imm: "#$07",
  zp: "$07",
  zpx: "$07,X",
  zpy: "$07,Y",
  abs: "$1234",
  abx: "$1234,X",
  aby: "$1234,Y",
  ind: "($1234)",
  izx: "($07,X)",
  izy: "($07),Y",
  rel: "*",
};

const MODE_TRAILING = {
  imp: [],
  acc: [],
  imm: [0x07],
  zp: [0x07],
  zpx: [0x07],
  zpy: [0x07],
  abs: [0x34, 0x12],
  abx: [0x34, 0x12],
  aby: [0x34, 0x12],
  ind: [0x34, 0x12],
  izx: [0x07],
  izy: [0x07],
  rel: [0xfe],
};

test("every documented opcode/addressing family encodes to its table byte", () => {
  let checked = 0;
  for (const [mnemonic, table] of Object.entries(OPCODES)) {
    for (const [mode, opcode] of Object.entries(table)) {
      const operand = MODE_OPERAND[mode];
      const source = operand === "" ? mnemonic : `${mnemonic} ${operand}`;
      const bytes = assembleCode(source);
      const expected = [opcode, ...MODE_TRAILING[mode]];
      assert.deepEqual(bytes, expected, `${mnemonic} ${mode} (${source})`);
      checked += 1;
    }
  }
  // The documented NMOS set has 151 distinct opcodes.
  assert.equal(checked, 151, "expected 151 documented opcode encodings");
});

test("the table contains no 65C02-only or undocumented mnemonics", () => {
  const forbidden = ["BRA", "PHX", "PLX", "PHY", "PLY", "STZ", "TRB", "TSB", "STP", "WAI", "SLO", "RLA", "LAX", "SAX", "DCP"];
  for (const name of forbidden) {
    assert.equal(OPCODES[name], undefined, `${name} must not be present`);
  }
});

test("hand-verified multi-byte vectors", () => {
  assert.deepEqual(assembleCode("lda #$2a"), [0xa9, 0x2a]);
  assert.deepEqual(assembleCode("lda $d020"), [0xad, 0x20, 0xd0]);
  assert.deepEqual(assembleCode("sta $0400,x"), [0x9d, 0x00, 0x04]);
  assert.deepEqual(assembleCode("jmp ($fffc)"), [0x6c, 0xfc, 0xff]);
  assert.deepEqual(assembleCode("jsr $ff81"), [0x20, 0x81, 0xff]);
  assert.deepEqual(assembleCode("lda ($fb),y"), [0xb1, 0xfb]);
  assert.deepEqual(assembleCode("lda ($fb,x)"), [0xa1, 0xfb]);
  assert.deepEqual(assembleCode("asl"), [0x0a]);
  assert.deepEqual(assembleCode("asl a"), [0x0a]);
  assert.deepEqual(assembleCode("brk"), [0x00]);
  assert.deepEqual(assembleCode("nop"), [0xea]);
});
