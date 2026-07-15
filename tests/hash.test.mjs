import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "../src/hash.js";

const utf8 = (s) => new TextEncoder().encode(s);

test("sha256 of empty input matches the FIPS 180-4 vector", () => {
  assert.equal(
    sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("sha256 of 'abc' matches the FIPS 180-4 vector", () => {
  assert.equal(
    sha256Hex(utf8("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("sha256 of the 448-bit boundary vector", () => {
  assert.equal(
    sha256Hex(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("sha256 handles a multi-block message longer than 64 bytes", () => {
  const million = "a".repeat(1000);
  // Known digest of 1000 'a' characters.
  assert.equal(
    sha256Hex(utf8(million)),
    "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
  );
});

test("sha256 output is always 64 lowercase hex characters", () => {
  const digest = sha256Hex(utf8("c64"));
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("sha256 matches node:crypto across padding boundary lengths", () => {
  // Lengths that stress the 56/64-byte padding boundaries and multi-block handling.
  for (const len of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 255, 256, 300]) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
    const reference = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256Hex(bytes), reference, `length ${len}`);
  }
});
