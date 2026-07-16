import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrg, downloadFilename } from "../src/prg.js";

test("a valid PRG returns load/end metadata", () => {
  const r = parsePrg(new Uint8Array([0x01, 0x08, 0xaa, 0xbb]));
  assert.ok(r.ok);
  assert.equal(r.metadata.loadAddress, 0x0801);
  assert.equal(r.metadata.dataLength, 2);
  assert.equal(r.metadata.endAddress, 0x0803);
});

test("a PRG shorter than three bytes is invalid", () => {
  assert.equal(parsePrg(new Uint8Array([0x01, 0x08])).error.code, "invalid-prg");
  assert.equal(parsePrg(new Uint8Array([])).error.code, "invalid-prg");
});

test("a PRG that wraps past $FFFF is invalid", () => {
  // load $FFFF + 2 data bytes -> end $10001
  assert.equal(parsePrg(new Uint8Array([0xff, 0xff, 0x00, 0x00])).error.code, "invalid-prg");
});

test("a PRG ending exactly at $10000 is valid", () => {
  // load $FFFE + 2 data bytes -> end $10000
  const r = parsePrg(new Uint8Array([0xfe, 0xff, 0x00, 0x00]));
  assert.ok(r.ok);
  assert.equal(r.metadata.endAddress, 0x10000);
});

test("non-Uint8Array input is rejected", () => {
  assert.equal(parsePrg([0x01, 0x08, 0x00]).error.code, "invalid-prg");
});

test("download filenames are sanitized lowercase ASCII with the right extension", () => {
  assert.equal(downloadFilename("BORDER-FLASH", "prg"), "border-flash.prg");
  assert.equal(downloadFilename("My Game!", "d64"), "my-game.d64");
  assert.equal(downloadFilename("***", "prg"), "program.prg");
});

test("download filenames cannot smuggle path traversal or separators (security)", () => {
  // No path separator, drive, traversal, NUL, or leading dot can survive sanitization: the result
  // is always a single flat, safe filename with the intended extension.
  for (const [name, expected] of [
    ["../../etc/passwd", "etc-passwd.prg"],
    ["..\\..\\windows\\system32", "windows-system32.prg"],
    ["/abs/olute", "abs-olute.prg"],
    ["a/b\\c:d*e", "a-b-c-d-e.prg"],
    ["..", "program.prg"],
    ["\u0000evil", "evil.prg"],
    [".hidden", "hidden.prg"],
  ]) {
    const out = downloadFilename(name, "prg");
    assert.equal(out, expected);
    assert.ok(!/[\\/:*?"<>|\u0000]/.test(out), `no unsafe char in ${out}`);
    assert.ok(!out.includes(".."), `no traversal in ${out}`);
  }
});
