import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../src/index.js";
import { assembleCode, assembleDirect } from "./helpers.mjs";

// Regression tests for the model-diverse review findings (F1, F2, F3, F6, F7).

// F1: a forward reference used by a zero-page-capable instruction must resolve to the correct
// address and width. The layout previously left forward references unresolved during sizing,
// silently emitting a stale operand and a mismatched size.
test("F1: forward operand encodes the correct absolute address and size", () => {
  assert.deepEqual(assembleCode("lda target\ntarget rts", 0x1000), [0xad, 0x03, 0x10, 0x60]);
});

test("F1: a forward reference that lands in the zero page stays zero page", () => {
  // At load $0010 the forward label is $0012 (<= $FF), so LDA remains zero page (A5 12).
  assert.deepEqual(assembleCode("lda target\ntarget rts", 0x0010), [0xa5, 0x12, 0x60]);
});

test("F1: deep forward-reference chains converge deterministically", () => {
  const src = "jmp a\na jmp b\nb jmp c\nc lda d\nd rts";
  const first = assembleCode(src, 0x1000);
  const second = assembleCode(src, 0x1000);
  assert.deepEqual(first, second);
  // jmp a($1003) jmp b($1006) jmp c($1009) lda d($100c abs) rts
  assert.deepEqual(first, [0x4c, 0x03, 0x10, 0x4c, 0x06, 0x10, 0x4c, 0x09, 0x10, 0xad, 0x0c, 0x10, 0x60]);
});

// F2: forward-dependent directive sizing must feed back into label addresses.
test("F2: a forward-dependent .fill count updates dependent label addresses", () => {
  // .fill COUNT (=3), then rts at $1003, then .word target must point at $1003.
  assert.deepEqual(
    assembleCode(".fill COUNT\nCOUNT = 3\ntarget rts\n.word target", 0x1000),
    [0x00, 0x00, 0x00, 0x60, 0x03, 0x10],
  );
});

// F3: alignment must not silently wrap the program counter past the top of memory.
test("F3: .align past $FFFF is a range error, not a silent wrap to $0000", () => {
  const r = assembleDirect("* = $ffff\n.byte 1\n.align 2\n.byte 2", 0x0000);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "range"));
});

// F6: a leading identifier that cannot begin a valid statement is an unknown opcode, not a
// label with a confusing downstream diagnostic.
test("F6: an unknown mnemonic with an operand reports unknown-opcode against itself", () => {
  const bra = assembleDirect("bra target", 0x1000);
  assert.equal(bra.diagnostics[0].code, "unknown-opcode");
  assert.equal(bra.diagnostics[0].column, 1);
  const lax = assembleDirect("lax $10", 0x1000);
  assert.equal(lax.diagnostics[0].code, "unknown-opcode");
});

test("F6: a label followed by a real mnemonic is still a label", () => {
  assert.deepEqual(assembleCode("loop nop\nbne loop", 0x1000), [0xea, 0xd0, 0xfd]);
});

// F7: character literals accept a full Unicode code point; unsupported ones report
// unsupported-character rather than a lexer syntax error.
test("F7: an astral character literal reports unsupported-character", () => {
  const r = assembleDirect(".byte '\u{1F600}'", 0x1000);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "unsupported-character"));
});

test("F7: a normal character literal still assembles", () => {
  assert.deepEqual(assembleCode(".byte 'A'"), [0x41]);
});

// --- Second review round (R1..R5) ---------------------------------------------------------

// R1: a deep acyclic forward-assignment chain must converge, not hit the pass cap.
test("R1: a deep forward-assignment chain converges instead of reporting phase-error", () => {
  const chain = [
    "a0 = a1", "a1 = a2", "a2 = a3", "a3 = a4", "a4 = a5",
    "a5 = a6", "a6 = a7", "a7 = a8", "a8 = target", "lda a0", "target rts",
  ].join("\n");
  const r = assembleDirect(chain, 0x1000);
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  // a0 resolves to target ($1003, after the 3-byte LDA), so LDA is absolute.
  assert.deepEqual([...r.prg], [0x00, 0x10, 0xad, 0x03, 0x10, 0x60]);
});

// R2: assignment right-hand-side errors must surface, not silently assemble.
test("R2: an unsupported character in an assignment is reported", () => {
  const r = assembleDirect(".byte BAD\nBAD = '\u{1F600}'", 0x1000);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "unsupported-character"));
});

test("R2: an undefined symbol on an assignment right-hand side is reported", () => {
  const r = assembleDirect("alias = missing\nrts", 0x1000);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "undefined-symbol"));
});

// R3: `*` must advance across successive values within a single directive.
test("R3: the current-location operator is live within a multi-value directive", () => {
  assert.deepEqual(assembleCode(".word *, *", 0x1000), [0x00, 0x10, 0x02, 0x10]);
  assert.deepEqual(assembleCode(".byte *, *, *", 0x0080), [0x80, 0x81, 0x82]);
});

// R4: a branch that crosses the $FFFF/$0000 boundary encodes via the 16-bit wrap.
test("R4: a relative branch across the address-space wrap encodes correctly", () => {
  // At $FFFE, BEQ $0000: post-instruction PC wraps to $0000, so the displacement is 0.
  assert.deepEqual(assembleCode("beq $0000", 0xfffe), [0xf0, 0x00]);
});

// R5: directives reject arguments beyond their documented arity.
test("R5: excess directive arguments are rejected, not ignored", () => {
  assert.equal(assembleDirect(".fill 2,$aa,$bb", 0x1000).diagnostics[0].code, "syntax");
  assert.equal(assembleDirect(".align 4,8\n.byte 1", 0x1000).diagnostics[0].code, "syntax");
});

// --- Third review round (T2..T4) ----------------------------------------------------------

// T2: a branch target outside 0..$FFFF must be a range error, not silently masked.
test("T2: an out-of-range branch target is rejected before wrap normalization", () => {
  const r = assembleDirect("beq $10000", 0xfffe);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "range"));
  // The legitimate in-range wrap case still assembles.
  assert.deepEqual(assembleCode("beq $0000", 0xfffe), [0xf0, 0x00]);
});

// T3: empty directive argument slices are malformed, not zero.
test("T3: empty .fill/.align arguments are syntax errors", () => {
  assert.equal(assembleDirect(".fill ,$aa\nrts", 0x1000).diagnostics[0].code, "syntax");
  assert.equal(assembleDirect(".fill 2,\nrts", 0x1000).diagnostics[0].code, "syntax");
  // A single-argument .fill is still valid (fills with $00).
  assert.deepEqual(assembleCode(".fill 2\nrts", 0x1000), [0x00, 0x00, 0x60]);
});

// T4: blank/comment lines must not amplify resolver work or alter output.
test("T4: many blank lines do not change output (no amplification)", () => {
  const blanks = Array(10000).fill("").join("\n");
  const bytes = assembleCode(`.byte 1\n${blanks}\n; a comment\n.byte 2`, 0x1000);
  assert.deepEqual(bytes, [0x01, 0x02]);
});
