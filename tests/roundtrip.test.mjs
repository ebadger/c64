import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble, buildArtifacts, parseD64, extractPrg } from "../src/index.js";

// The critical path: source -> PRG -> D64 -> extracted PRG must be byte-identical.
function roundTrip(project) {
  const built = buildArtifacts(project);
  assert.ok(built.ok, `build failed: ${JSON.stringify(built.assembly.diagnostics || built.error)}`);
  const parsed = parseD64(built.bundle.d64);
  assert.ok(parsed.ok, `parseD64 failed: ${JSON.stringify(parsed.error)}`);
  const extracted = extractPrg(built.bundle.d64, 0);
  assert.ok(extracted.ok, `extract failed: ${JSON.stringify(extracted.error)}`);
  assert.deepEqual([...extracted.prg], [...built.bundle.prg], "extracted PRG differs from assembled PRG");
  return built;
}

test("basic-sys program round-trips through PRG and D64 with byte equality", () => {
  roundTrip({
    schema: 1,
    source: "ldx #$00\nloop inc $d020\ninx\ncpx #$10\nbne loop\nrts",
    runMode: "basic-sys",
    loadAddress: 0x0801,
    outputName: "FLASH",
    diskName: "DISK",
    diskId: "01",
  });
});

test("direct-mode program round-trips through PRG and D64 with byte equality", () => {
  roundTrip({
    schema: 1,
    source: "* = $c000\nlda #$07\nsta $d020\nrts",
    runMode: "direct",
    loadAddress: 0xc000,
    runAddress: 0xc000,
    outputName: "DIRECT",
    diskName: "DISK",
    diskId: "01",
  });
});

test("a multi-sector program round-trips (exercises the D64 sector chain)", () => {
  const built = roundTrip({
    schema: 1,
    source: "* = $c000\n.fill 600, $ea\nrts",
    runMode: "direct",
    loadAddress: 0xc000,
    runAddress: 0xc000,
    outputName: "BIG",
    diskName: "DISK",
    diskId: "01",
  });
  // 2 header + 601 data = 603 PRG bytes -> ceil(603/254) = 3 sectors.
  assert.equal(built.bundle.prg.length, 603);
  const parsed = parseD64(built.bundle.d64);
  assert.equal(parsed.metadata.entries[0].blocks, 3);
});

test("the ArtifactBundle carries matching build id and sanitized names", () => {
  const project = {
    schema: 1,
    source: "rts",
    runMode: "basic-sys",
    loadAddress: 0x0801,
    outputName: "NAME",
    diskName: "DISK",
    diskId: "01",
  };
  const asm = assemble(project);
  const built = buildArtifacts(project);
  assert.equal(built.bundle.buildId, asm.buildId);
  assert.equal(built.bundle.prgName, "name.prg");
  assert.equal(built.bundle.d64Name, "name.d64");
  assert.equal(built.bundle.loadAddress, 0x0801);
});
