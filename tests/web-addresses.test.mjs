import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddress, formatAddress } from "../web/modules/addresses.v1.js";

test("parseAddress accepts full hex and decimal in range", () => {
  assert.equal(parseAddress("$0801"), 0x0801);
  assert.equal(parseAddress("$c000"), 0xc000);
  assert.equal(parseAddress("2049"), 2049);
  assert.equal(parseAddress("  $ffff "), 0xffff);
  assert.equal(parseAddress("0"), 0);
});

test("parseAddress rejects partial/invalid hex rather than silently truncating", () => {
  assert.ok(Number.isNaN(parseAddress("$C00O")), "trailing junk must not parse to 0xC00");
  assert.ok(Number.isNaN(parseAddress("abc")));
  assert.ok(Number.isNaN(parseAddress("$")));
  assert.ok(Number.isNaN(parseAddress("")));
  assert.ok(Number.isNaN(parseAddress("0x10")));
});

test("parseAddress rejects out-of-range values", () => {
  assert.ok(Number.isNaN(parseAddress("$10000")));
  assert.ok(Number.isNaN(parseAddress("65536")));
});

test("formatAddress formats numbers and passes non-numbers through verbatim", () => {
  assert.equal(formatAddress(0x0801), "$0801");
  assert.equal(formatAddress(0), "$0000");
  // Blank/invalid must not coerce to $0000 or $0NaN.
  assert.equal(formatAddress(""), "");
  assert.equal(formatAddress("$C00O"), "$C00O");
  assert.equal(formatAddress(NaN), "NaN");
  assert.equal(formatAddress(undefined), "");
});
