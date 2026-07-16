import { test } from "node:test";
import assert from "node:assert/strict";

import {
  directoryEntryLabel,
  formatEntryAddress,
  isPrgEntry,
  parseEntryAddress,
  petsciiToDisplay,
} from "../../web/client/lib/diskControls.js";

test("disk entries identify runnable PRGs and render bounded text labels", () => {
  const entry = { fileType: 0x82, name: [0x50, 0x52, 0x47], blocks: 1 };
  assert.equal(isPrgEntry(entry), true);
  assert.equal(isPrgEntry({ ...entry, fileType: 0x02 }), true);
  assert.equal(isPrgEntry({ ...entry, fileType: 0x81 }), false);
  assert.equal(isPrgEntry(null), false);
  assert.equal(directoryEntryLabel(entry), '"PRG" PRG — 1 block');
  assert.equal(directoryEntryLabel({ ...entry, fileType: 0x81, blocks: 2 }), '"PRG" SEQ — 2 blocks');
});

test("PETSCII disk names are converted to display text without markup", () => {
  assert.equal(petsciiToDisplay([0x54, 0x45, 0x53, 0x54]), "TEST");
  assert.equal(petsciiToDisplay([0xc1, 0xda, 0x00]), "az?");
  assert.equal(petsciiToDisplay([]), "(unnamed)");
});

test("entry addresses accept documented hexadecimal and decimal forms", () => {
  for (const value of ["$C000", "0xC000", "C000"]) {
    assert.equal(parseEntryAddress(value), 0xc000);
  }
  assert.equal(parseEntryAddress("49152"), 0xc000);
  assert.equal(parseEntryAddress("  $080D  "), 0x080d);
  assert.equal(parseEntryAddress("0"), 0);
  assert.equal(parseEntryAddress("65535"), 0xffff);
  assert.equal(formatEntryAddress(0x080d), "$080D");
});

test("entry addresses reject empty, malformed, and out-of-range input", () => {
  for (const value of ["", "$", "0x", "-1", "$10000", "65536", "G000", "12.5"]) {
    assert.equal(parseEntryAddress(value), null, value);
  }
});
