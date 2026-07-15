import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProject } from "../src/project.js";
import {
  buildD64,
  parseD64,
  extractPrg,
  mountD64,
  sectorsInTrack,
  sectorOffset,
  D64_SIZE,
  D64_SIZE_WITH_ERRORS,
} from "../src/d64.js";

function project(extra = {}) {
  return validateProject({ source: "", outputName: "TEST", diskName: "TESTDISK", diskId: "01", ...extra }).project;
}

// Build a synthetic PRG of a given data length (>=1). First two bytes are a load address.
function makePrg(dataLength) {
  const prg = new Uint8Array(2 + dataLength);
  prg[0] = 0x01;
  prg[1] = 0x08;
  for (let i = 0; i < dataLength; i++) prg[2 + i] = (i * 7 + 3) & 0xff;
  return prg;
}

test("track geometry matches the standard 35-track layout (683 sectors)", () => {
  let total = 0;
  for (let t = 1; t <= 35; t++) total += sectorsInTrack(t);
  assert.equal(total, 683);
  assert.equal(sectorsInTrack(1), 21);
  assert.equal(sectorsInTrack(18), 19);
  assert.equal(sectorsInTrack(25), 18);
  assert.equal(sectorsInTrack(35), 17);
});

test("buildD64 produces exactly 174848 bytes", () => {
  const r = buildD64(project(), makePrg(10));
  assert.ok(r.ok);
  assert.equal(r.d64.length, D64_SIZE);
});

test("BAM header records DOS version, directory link, and DOS type", () => {
  const image = buildD64(project(), makePrg(10)).d64;
  const bam = sectorOffset(18, 0);
  assert.equal(image[bam], 18); // first directory track
  assert.equal(image[bam + 1], 1); // first directory sector
  assert.equal(image[bam + 2], 0x41); // DOS version 'A'
  assert.equal(image[bam + 0xa5], 0x32); // '2'
  assert.equal(image[bam + 0xa6], 0x41); // 'A'
  // Disk name "TESTDISK" then shift-space padding.
  assert.deepEqual([...image.slice(bam + 0x90, bam + 0x98)], [0x54, 0x45, 0x53, 0x54, 0x44, 0x49, 0x53, 0x4b]);
  assert.equal(image[bam + 0x98], 0xa0);
  // Disk ID "01".
  assert.deepEqual([...image.slice(bam + 0xa2, bam + 0xa4)], [0x30, 0x31]);
});

test("BAM free counts reserve BAM and directory sectors and allocate file sectors", () => {
  const image = buildD64(project(), makePrg(10)).d64; // one data sector at 1/0
  const bam = sectorOffset(18, 0);
  const track1Free = image[bam + 4 + (1 - 1) * 4];
  const track18Free = image[bam + 4 + (18 - 1) * 4];
  assert.equal(track1Free, 20); // 21 - 1 file sector
  assert.equal(track18Free, 17); // 19 - BAM - directory
});

test("directory entry describes a closed PRG file", () => {
  const image = buildD64(project(), makePrg(10)).d64;
  const dir = sectorOffset(18, 1);
  assert.equal(image[dir], 0x00); // no next directory sector
  assert.equal(image[dir + 1], 0xff);
  assert.equal(image[dir + 2], 0x82); // closed PRG
  assert.equal(image[dir + 3], 1); // first data track
  assert.equal(image[dir + 4], 0); // first data sector
  assert.deepEqual([...image.slice(dir + 5, dir + 9)], [0x54, 0x45, 0x53, 0x54]); // "TEST"
  assert.equal(image[dir + 5 + 4], 0xa0); // padding
  assert.equal(image[dir + 30] | (image[dir + 31] << 8), 1); // block count
});

test("parseD64 validates a generated image and lists its entry", () => {
  const image = buildD64(project(), makePrg(300)).d64;
  const parsed = parseD64(image);
  assert.ok(parsed.ok);
  assert.equal(parsed.metadata.entries.length, 1);
  assert.equal(parsed.metadata.entries[0].fileType, 0x82);
  assert.equal(parsed.metadata.entries[0].blocks, 2); // 300 bytes -> 2 sectors
  assert.deepEqual(parsed.metadata.entries[0].name, [0x54, 0x45, 0x53, 0x54]);
});

test("extractPrg returns exactly the stored PRG bytes across sector counts", () => {
  for (const len of [1, 100, 254, 255, 508, 600, 2000]) {
    const prg = makePrg(len);
    const image = buildD64(project(), prg).d64;
    const ex = extractPrg(image, 0);
    assert.ok(ex.ok, `extract failed for len ${len}`);
    assert.equal(ex.prg.length, prg.length, `length mismatch for len ${len}`);
    assert.deepEqual([...ex.prg], [...prg], `byte mismatch for len ${len}`);
  }
});

test("rebuilding the same project and PRG yields byte-identical D64 images", () => {
  const a = buildD64(project(), makePrg(300)).d64;
  const b = buildD64(project(), makePrg(300)).d64;
  assert.deepEqual([...a], [...b]);
});

test("a wrapping PRG is rejected by buildD64 as invalid-prg (shared with parsePrg)", () => {
  // A load address + length that wraps past $FFFF is invalid; buildD64 must not package it.
  const wrapping = Uint8Array.of(0xff, 0xff, 0x00, 0x00);
  const r = buildD64(project(), wrapping);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "invalid-prg");
});

test("a maximal valid PRG still fits on a 35-track disk (disk-full is defensive)", () => {
  // The largest valid PRG (load $0000, ~64 KiB) needs ~259 sectors, well under the 681
  // available, so a single-file 35-track build never reports disk-full; the guard is
  // defensive. Verify the boundary builds successfully.
  const big = new Uint8Array(0x10000);
  big[0] = 0x00;
  big[1] = 0x00;
  const r = buildD64(project(), big);
  assert.ok(r.ok);
  assert.equal(r.d64.length, D64_SIZE);
});

test("wrong image size is unsupported-geometry", () => {
  assert.equal(parseD64(new Uint8Array(1000)).error.code, "unsupported-geometry");
});

test("a 175531-byte image with an error table parses with a warning", () => {
  const base = buildD64(project(), makePrg(10)).d64;
  const withErrors = new Uint8Array(D64_SIZE_WITH_ERRORS);
  withErrors.set(base);
  const parsed = parseD64(withErrors);
  assert.ok(parsed.ok);
  assert.ok(parsed.warnings.some((w) => w.code === "error-table-ignored"));
});

test("a corrupt BAM directory link is invalid-bam", () => {
  const image = buildD64(project(), makePrg(10)).d64;
  image[sectorOffset(18, 0)] = 5; // directory link no longer points to track 18
  assert.equal(parseD64(image).error.code, "invalid-bam");
});

test("a file link outside the image is invalid-track-sector", () => {
  const image = buildD64(project(), makePrg(300)).d64;
  const firstData = sectorOffset(1, 0);
  image[firstData] = 40; // link to a non-existent track
  assert.equal(parseD64(image).error.code, "invalid-track-sector");
});

test("a self-referential file chain is a chain-cycle", () => {
  const image = buildD64(project(), makePrg(300)).d64;
  const firstData = sectorOffset(1, 0);
  image[firstData] = 1; // link back to 1/0
  image[firstData + 1] = 0;
  assert.equal(parseD64(image).error.code, "chain-cycle");
});

test("mountD64 returns an immutable copy and rejects malformed media", () => {
  const image = buildD64(project(), makePrg(10)).d64;
  const mounted = mountD64(image);
  assert.ok(mounted.ok);
  assert.equal(mounted.media.length, D64_SIZE);
  assert.notEqual(mounted.media, image); // a copy, not the same reference
  assert.equal(mountD64(new Uint8Array(10)).error.code, "unsupported-geometry");
});

test("extractPrg rejects a non-PRG directory entry", () => {
  const image = buildD64(project(), makePrg(20)).d64;
  image[sectorOffset(18, 1) + 2] = 0x81; // SEQ instead of closed PRG
  const ex = extractPrg(image, 0);
  assert.equal(ex.ok, false);
  assert.equal(ex.error.code, "invalid-prg");
});

test("extractPrg rejects a corrupt final-sector length that yields too few bytes", () => {
  const image = buildD64(project(), makePrg(20)).d64;
  image[sectorOffset(1, 0) + 1] = 1; // final-sector byte 1 = 1 -> empty payload
  const ex = extractPrg(image, 0);
  assert.equal(ex.ok, false);
  assert.equal(ex.error.code, "invalid-prg");
});
