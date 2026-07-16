import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeShareSource,
  decodeShareCode,
  MAX_DECODED_SOURCE_BYTES,
} from "../web/modules/share.v1.js";

test("share code round-trips ASCII source", () => {
  const source = "  lda #$00\n  sta $d020\n  rts\n";
  assert.equal(decodeShareCode(encodeShareSource(source)), source);
});

test("share code round-trips multibyte UTF-8 source", () => {
  const source = "café 🎮 ; ünïcödé label\n.text \"HELLO\"\n";
  assert.equal(decodeShareCode(encodeShareSource(source)), source);
});

test("share code is unpadded base64url and tolerates padding on decode", () => {
  const code = encodeShareSource("x");
  assert.ok(!code.includes("="), "encoded code should be unpadded");
  assert.ok(!/[+/]/.test(code), "encoded code must not use standard base64 + or /");
  // Adding standard padding back must still decode.
  const padded = code + "=".repeat((4 - (code.length % 4)) % 4);
  assert.equal(decodeShareCode(padded), "x");
});

test("standard base64 '+' and '/' are rejected", () => {
  assert.throws(() => decodeShareCode("AAAA+BBB"), (err) => err.category === "share");
  assert.throws(() => decodeShareCode("AAAA/BBB"), (err) => err.category === "share");
});

test("oversize payloads are rejected before decoding", () => {
  const overLimit = "A".repeat(Math.ceil((MAX_DECODED_SOURCE_BYTES * 4) / 3) + 8);
  assert.throws(() => decodeShareCode(overLimit), (err) => err.category === "share");
});

test("encoding oversize source is rejected (no dead share links)", () => {
  const big = "a".repeat(MAX_DECODED_SOURCE_BYTES + 1);
  assert.throws(() => encodeShareSource(big), (err) => err.category === "share");
  // At-limit source still encodes and round-trips.
  const atLimit = "b".repeat(MAX_DECODED_SOURCE_BYTES);
  assert.equal(decodeShareCode(encodeShareSource(atLimit)), atLimit);
});

test("invalid UTF-8 is rejected", () => {
  // "_w" is base64url for the single byte 0xFF, which is not valid standalone UTF-8.
  assert.throws(() => decodeShareCode("_w"), (err) => err.category === "share");
});

test("empty share code is rejected", () => {
  assert.throws(() => decodeShareCode(""), (err) => err.category === "share");
});
