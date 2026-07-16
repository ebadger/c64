// Node tests for the environment-free base64url + UTF-8 share codec (web/client/lib/base64url.js).
import test from "node:test";
import assert from "node:assert/strict";

import {
  bytesToBase64url,
  base64urlToBytes,
  encodeSourceToCode,
  decodeCodeToSource,
} from "../../web/client/lib/base64url.js";

test("round-trips ASCII and Unicode source (UTF-8)", () => {
  for (const s of ["", "hello", "lda #$00 ; ok", "café ☕ 日本語 😀", "\n\ttabs\nand\nlines\n"]) {
    const code = encodeSourceToCode(s);
    const back = decodeCodeToSource(code);
    assert.equal(back.ok, true, `decode failed for ${JSON.stringify(s)}`);
    assert.equal(back.source, s);
  }
});

test("produces url-safe alphabet without padding", () => {
  const code = encodeSourceToCode("????>>>>"); // bytes that map to + and / in std base64
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.ok(!code.includes("="));
});

test("accepts optional trailing padding but rejects standard base64", () => {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const url = bytesToBase64url(bytes);
  // Add optional '=' padding to a multiple of 4.
  const padded = url + "=".repeat((4 - (url.length % 4)) % 4);
  assert.deepEqual(base64urlToBytes(padded).bytes, bytes);
  // A '+' or '/' (standard base64) is rejected with a stable reason.
  assert.deepEqual(base64urlToBytes("ab+d"), { ok: false, reason: "standard-base64" });
  assert.deepEqual(base64urlToBytes("ab/d"), { ok: false, reason: "standard-base64" });
});

test("rejects invalid characters, empty, and impossible lengths", () => {
  assert.equal(base64urlToBytes("").ok, false);
  assert.equal(base64urlToBytes("A").ok, false); // len % 4 === 1
  assert.equal(base64urlToBytes("a*b").ok, false);
  assert.equal(base64urlToBytes("a b").ok, false);
});

test("enforces the decoded-byte cap before allocation", () => {
  // 8 base64 chars decode to 6 bytes; cap at 5 must reject as too-large.
  const code = bytesToBase64url(new Uint8Array(6).fill(0x41));
  assert.deepEqual(base64urlToBytes(code, 5), { ok: false, reason: "too-large" });
  assert.equal(base64urlToBytes(code, 6).ok, true);
});

test("rejects malformed UTF-8 payloads with fatal decoding", () => {
  // 0xFF is not valid UTF-8; encode raw bytes and decode as source.
  const code = bytesToBase64url(Uint8Array.from([0xff, 0xfe, 0xfd]));
  assert.deepEqual(decodeCodeToSource(code), { ok: false, reason: "invalid-utf8" });
});

test("decodeCodeToSource enforces the byte cap and reports too-large", () => {
  const code = encodeSourceToCode("x".repeat(100));
  assert.deepEqual(decodeCodeToSource(code, 50), { ok: false, reason: "too-large" });
});
