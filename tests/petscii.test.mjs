import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePetsciiCodePoint, encodePetsciiString } from "../src/petscii.js";

test("uppercase letters and digits map to identity PETSCII bytes", () => {
  assert.equal(encodePetsciiCodePoint("A".codePointAt(0)), 0x41);
  assert.equal(encodePetsciiCodePoint("Z".codePointAt(0)), 0x5a);
  assert.equal(encodePetsciiCodePoint("0".codePointAt(0)), 0x30);
  assert.equal(encodePetsciiCodePoint(" ".codePointAt(0)), 0x20);
  assert.equal(encodePetsciiCodePoint("@".codePointAt(0)), 0x40);
});

test("lowercase letters map to the shifted-set range 0xC1..0xDA", () => {
  assert.equal(encodePetsciiCodePoint("a".codePointAt(0)), 0xc1);
  assert.equal(encodePetsciiCodePoint("z".codePointAt(0)), 0xda);
});

test("brackets are supported but backslash/caret/underscore are not", () => {
  assert.equal(encodePetsciiCodePoint("[".codePointAt(0)), 0x5b);
  assert.equal(encodePetsciiCodePoint("]".codePointAt(0)), 0x5d);
  assert.equal(encodePetsciiCodePoint("\\".codePointAt(0)), null);
  assert.equal(encodePetsciiCodePoint("^".codePointAt(0)), null);
  assert.equal(encodePetsciiCodePoint("_".codePointAt(0)), null);
});

test("non-ASCII / Unicode code points are unsupported (no lossy conversion)", () => {
  assert.equal(encodePetsciiCodePoint("é".codePointAt(0)), null);
  assert.equal(encodePetsciiCodePoint("π".codePointAt(0)), null);
  assert.equal(encodePetsciiCodePoint("€".codePointAt(0)), null);
  assert.equal(encodePetsciiCodePoint("😀".codePointAt(0)), null);
});

test("encodePetsciiString maps a full string", () => {
  const enc = encodePetsciiString("HELLO C64");
  assert.ok(enc.ok);
  assert.deepEqual([...enc.bytes], [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x20, 0x43, 0x36, 0x34]);
});

test("encodePetsciiString reports the first unsupported character and its index", () => {
  const enc = encodePetsciiString("AB\tC");
  assert.equal(enc.ok, false);
  assert.equal(enc.badIndex, 2);
  assert.equal(enc.badChar, "\t");
});
