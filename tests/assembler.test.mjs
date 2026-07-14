import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../src/index.js";
import { assembleCode, assembleDirect } from "./helpers.mjs";

function basicSys(source, extra = {}) {
  return assemble({ schema: 1, source, runMode: "basic-sys", loadAddress: 0x0801, ...extra });
}

test("basic-sys emits the exact golden SYS stub then machine code", () => {
  const r = basicSys("lda #$00\nrts");
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.equal(r.loadAddress, 0x0801);
  assert.equal(r.runAddress, 0x080d); // default origin = 2061
  assert.deepEqual(
    [...r.prg],
    [
      0x01, 0x08, // load address $0801
      0x0b, 0x08, // next-line pointer -> $080b
      0x0a, 0x00, // line number 10
      0x9e, // SYS token
      0x32, 0x30, 0x36, 0x31, // "2061"
      0x00, // end of line
      0x00, 0x00, // end of program
      0xa9, 0x00, // lda #$00
      0x60, // rts
    ],
  );
});

test("basic-sys derives runAddress from an explicit higher origin and fills the gap", () => {
  const r = basicSys("* = $0810\nrts");
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  assert.equal(r.runAddress, 0x0810);
  // SYS target is 2064; stub is still 12 bytes ($0801..$080c); gap $080d..$080f is $00.
  assert.deepEqual([...r.prg.slice(0, 11)], [0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x34]);
  assert.equal(r.prg[r.prg.length - 1], 0x60); // rts at $0810
});

test("direct mode places code at the load address and records the project run address", () => {
  const r = assemble({ schema: 1, source: "rts", runMode: "direct", loadAddress: 0xc000, runAddress: 0xc000 });
  assert.ok(r.ok);
  assert.equal(r.loadAddress, 0xc000);
  assert.equal(r.runAddress, 0xc000);
  assert.deepEqual([...r.prg], [0x00, 0xc0, 0x60]);
});

test("forward label references resolve via the multi-pass resolver", () => {
  const bytes = assembleCode("jmp target\nnop\ntarget\nrts", 0x1000);
  // jmp abs (3) at $1000, nop (1) at $1003, target=$1004
  assert.deepEqual(bytes, [0x4c, 0x04, 0x10, 0xea, 0x60]);
});

test("zero-page is selected for small operands and absolute for 16-bit operands", () => {
  assert.deepEqual(assembleCode("lda $10"), [0xa5, 0x10]);
  assert.deepEqual(assembleCode("lda $1234"), [0xad, 0x34, 0x12]);
  // A label always lives above the zero page, so it grows to absolute.
  assert.deepEqual(assembleCode("here lda here", 0x1000), [0xad, 0x00, 0x10]);
});

test("a symbol assigned a small constant stays zero page", () => {
  assert.deepEqual(assembleCode("PTR = $fb\nlda PTR"), [0xa5, 0xfb]);
});

test("backward and forward branches encode signed offsets", () => {
  // Backward: label at $1000, bne back at $1000 -> ... actually branch to earlier label.
  assert.deepEqual(assembleCode("back nop\nbne back", 0x1000), [0xea, 0xd0, 0xfd]);
  assert.deepEqual(assembleCode("beq fwd\nfwd rts", 0x1000), [0xf0, 0x00, 0x60]);
});

test("out-of-range branch is a branch-range error", () => {
  const r = assembleDirect("bne far\n.fill 200\nfar rts", 0x1000);
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, "branch-range");
});

test(".byte .word .text .fill and .align emit the documented bytes", () => {
  assert.deepEqual(assembleCode(".byte $01, $02, $ff"), [0x01, 0x02, 0xff]);
  assert.deepEqual(assembleCode(".word $1234, $abcd"), [0x34, 0x12, 0xcd, 0xab]);
  assert.deepEqual(assembleCode('.text "AB0"'), [0x41, 0x42, 0x30]);
  assert.deepEqual(assembleCode(".fill 3, $aa"), [0xaa, 0xaa, 0xaa]);
  assert.deepEqual(assembleCode(".fill 2"), [0x00, 0x00]);
  assert.deepEqual(assembleCode("* = $1000\nlda #$00\n.align 4\n.byte $ff", 0x1000), [0xa9, 0x00, 0x00, 0x00, 0xff]);
});

test("char literals map through PETSCII inside expressions", () => {
  assert.deepEqual(assembleCode(".byte 'A', 'a'"), [0x41, 0xc1]);
  assert.deepEqual(assembleCode("lda #'Z'"), [0xa9, 0x5a]);
});

test("low/high byte operators split an address", () => {
  assert.deepEqual(assembleCode("target = $1234\nlda #<target\nldx #>target"), [0xa9, 0x34, 0xa2, 0x12]);
});

test("gaps between origins are filled with $00", () => {
  assert.deepEqual(assembleCode("* = $1000\n.byte $01\n* = $1003\n.byte $02", 0x1000), [0x01, 0x00, 0x00, 0x02]);
});

test("overlapping output is an overlap error", () => {
  const r = assembleDirect("* = $1000\n.byte $01, $02, $03\n* = $1001\n.byte $ff", 0x1000);
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, "overlap");
});

test("empty output is an empty-output error", () => {
  const r = assembleDirect("; only a comment", 0x1000);
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, "empty-output");
});

test("failed assembly returns no PRG and no build id", () => {
  const r = assembleDirect("lda missing", 0x1000);
  assert.equal(r.ok, false);
  assert.equal(r.prg, null);
  assert.equal(r.buildId, null);
});

const DIAGNOSTIC_CASES = [
  ["syntax", "lda #"],
  ["unknown-opcode", "here: lax $10"],
  ["invalid-addressing-mode", "inx #$01"],
  ["undefined-symbol", "lda missing"],
  ["duplicate-symbol", "foo nop\nfoo rts"],
  ["unsupported-character", '.text "ca\tt"'],
  ["range", ".byte $100"],
  ["range", "lda #$100"],
];

for (const [code, source] of DIAGNOSTIC_CASES) {
  test(`diagnostic category '${code}' is produced for: ${source.replace(/\n/g, " | ")}`, () => {
    const r = assembleDirect(source, 0x1000);
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics.some((d) => d.code === code), `expected ${code}, got ${JSON.stringify(r.diagnostics)}`);
  });
}

test("unsupported-target is surfaced through assemble()", () => {
  const r = assemble({ schema: 1, source: "rts", target: "wdc65c02", runMode: "direct", loadAddress: 0x1000 });
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, "unsupported-target");
});

test("basic-sys requires load address $0801", () => {
  const r = assemble({ schema: 1, source: "rts", runMode: "basic-sys", loadAddress: 0x1000 });
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].code, "invalid-project");
});

test("assembly is deterministic: identical source yields identical bytes and build id", () => {
  const a = basicSys("ldx #$00\nloop inx\nbne loop\nrts");
  const b = basicSys("ldx #$00\nloop inx\nbne loop\nrts");
  assert.deepEqual([...a.prg], [...b.prg]);
  assert.equal(a.buildId, b.buildId);
});

test("diagnostics are sorted by source position", () => {
  const r = assembleDirect("lda missing2\nlda missing1", 0x1000);
  assert.equal(r.ok, false);
  // Two undefined symbols on lines 1 and 2; line 1 must sort first.
  assert.equal(r.diagnostics[0].line, 1);
  assert.equal(r.diagnostics[1].line, 2);
});

test("case-insensitive mnemonics and symbols", () => {
  assert.deepEqual(assembleCode("LDA #$01"), assembleCode("lda #$01"));
  assert.deepEqual(assembleCode("Foo = $10\nlda foo"), [0xa5, 0x10]);
});
