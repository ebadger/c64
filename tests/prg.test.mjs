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
