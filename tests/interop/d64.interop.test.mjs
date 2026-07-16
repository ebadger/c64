// External PRG/D64 interoperability verification.
//
// Independently confirms that a D64 produced by our deterministic media pipeline is a valid,
// standard 1541 image by round-tripping it through a reputable third-party C64 disk tool — VICE's
// `c1541` — rather than trusting only our own reader. It verifies:
//   1. the 35-track geometry and directory metadata (disk name/id, the file entry, PRG type,
//      block size, and total blocks-free), and
//   2. that the file extracted BY THE EXTERNAL TOOL is byte-for-byte identical to the PRG we
//      generated (including the two-byte load address).
//
// Provisioning (no binary is committed): on the release path CI installs VICE from the distro
// package (`c1541` on PATH); provenance is recorded in tests/interop/PROVENANCE.md. Locally the
// test SKIPS when `c1541` is absent, unless C64_INTEROP_REQUIRE is set (release gate), in which
// case a missing tool FAILS. Point the test at a specific binary with C64_C1541=/path/to/c1541.
//
// This exercises SOFTWARE tooling only; it makes no physical-hardware claim (see specs/MEDIA.md).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildArtifacts } from "../../src/index.js";
import { makeProject } from "../../web/client/lib/projectModel.js";

const TOTAL_BLOCKS_FREE_35_TRACK = 664; // standard empty 1541 (35 tracks, track 18 reserved)

function findC1541() {
  const explicit = process.env.C64_C1541;
  if (explicit && existsSync(explicit)) return explicit;
  for (const cand of [explicit, "c1541"].filter(Boolean)) {
    try {
      execFileSync(cand, ["-help"], { stdio: "ignore" });
      return cand;
    } catch {
      /* not here */
    }
  }
  return null;
}

function required() {
  const v = (process.env.C64_INTEROP_REQUIRE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "all";
}

test("VICE c1541 verifies generated D64 directory + extracted PRG bytes", (t) => {
  const tool = findC1541();
  if (!tool) {
    if (required()) assert.fail("C64_INTEROP_REQUIRE is set but the external c1541 tool is not available on PATH or C64_C1541");
    t.skip("c1541 (VICE) not available — install VICE or set C64_C1541 (see tests/interop/PROVENANCE.md)");
    return;
  }

  // Deterministically build a known PRG + D64. An UPPERCASE outputName keeps the CBM filename
  // ASCII-identical under PETSCII, so c1541's directory name and -read argument are unambiguous.
  const project = makeProject({
    source: "start\n        lda #$07\n        sta $d020\n        rts\n",
    name: "HELLO",
    outputName: "HELLO",
    diskName: "TESTDISK",
    diskId: "01",
  });
  const result = buildArtifacts(project);
  assert.equal(result.ok, true, "pipeline produced a PRG + D64");
  const prg = result.bundle.prg;
  const d64 = result.bundle.d64;
  assert.equal(d64.length, 174848, "standard 35-track D64 size");

  const dir = mkdtempSync(join(tmpdir(), "c64-interop-"));
  try {
    const imagePath = join(dir, "disk.d64");
    writeFileSync(imagePath, Buffer.from(d64));

    // Record tool provenance for the run log.
    let banner = "";
    try {
      banner = execFileSync(tool, ["-help"], { encoding: "utf8" }).split("\n")[0];
    } catch {
      /* banner is best-effort */
    }
    console.log(`interop: using external tool '${tool}'${banner ? ` (${banner.trim()})` : ""}`);

    // 1) Directory listing through the external tool.
    const listing = execFileSync(tool, [imagePath, "-dir"], { encoding: "utf8" });
    console.log("interop c1541 -dir:\n" + listing);
    assert.match(listing, /"TESTDISK/i, "disk name appears in the external directory");
    const fileLine = listing.split("\n").find((l) => /"HELLO"/i.test(l));
    assert.ok(fileLine, "the HELLO file entry appears in the external directory");
    assert.match(fileLine, /\bPRG\b/i, "file is reported as a PRG by the external tool");
    const fileBlocks = Number((fileLine.match(/^\s*(\d+)/) || [])[1]);
    assert.ok(fileBlocks >= 1, "file has at least one allocated block");
    const freeMatch = listing.match(/(\d+)\s+BLOCKS FREE/i);
    assert.ok(freeMatch, "blocks-free line present");
    const blocksFree = Number(freeMatch[1]);
    assert.equal(
      blocksFree + fileBlocks,
      TOTAL_BLOCKS_FREE_35_TRACK,
      "35-track geometry: free + file blocks equals the standard 664",
    );

    // 2) Extract the file WITH THE EXTERNAL TOOL and compare bytes exactly. Use the CBM name exactly
    // as the tool renders it in the directory (c1541 maps stored PETSCII to lowercase ASCII), so
    // the -read argument round-trips to the same stored bytes regardless of case convention.
    const cbmName = (fileLine.match(/"([^"]+)"/) || [])[1].trim();
    const outPath = join(dir, "extracted.prg");
    execFileSync(tool, [imagePath, "-read", cbmName, outPath], { encoding: "utf8" });
    const extracted = readFileSync(outPath);
    assert.deepEqual(
      new Uint8Array(extracted),
      new Uint8Array(prg),
      "externally-extracted PRG is byte-identical to the generated PRG (incl. load address)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
