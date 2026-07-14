import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArtifacts, parseD64, extractPrg } from "../src/index.js";
import { sha256Hex } from "../src/hash.js";
import { EXAMPLES, loadExample, loadExpected } from "../examples/load-example.mjs";

// Golden-vector check: every committed example must rebuild to its committed expectations and
// round-trip byte-for-byte. This is the CI guard against silent artifact drift.
for (const name of EXAMPLES) {
  test(`example '${name}' rebuilds to its committed golden expectations`, () => {
    const project = loadExample(name);
    const expected = loadExpected(name);
    const built = buildArtifacts(project);
    assert.ok(built.ok, `example failed to build: ${JSON.stringify(built.assembly.diagnostics || built.error)}`);

    assert.equal(built.assembly.buildId, expected.buildId, "buildId drift");
    assert.equal(built.assembly.loadAddress, expected.loadAddress);
    assert.equal(built.assembly.runAddress, expected.runAddress);
    assert.equal(built.bundle.prg.length, expected.prgLength);
    assert.equal(sha256Hex(built.bundle.prg), expected.prgSha256, "PRG bytes drift");
    assert.equal(built.bundle.d64.length, expected.d64Length);
    assert.equal(sha256Hex(built.bundle.d64), expected.d64Sha256, "D64 bytes drift");
    assert.equal(built.bundle.prgName, expected.prgName);
    assert.equal(built.bundle.d64Name, expected.d64Name);
  });

  test(`example '${name}' round-trips source -> PRG -> D64 -> extracted PRG`, () => {
    const built = buildArtifacts(loadExample(name));
    const parsed = parseD64(built.bundle.d64);
    assert.ok(parsed.ok);
    const extracted = extractPrg(built.bundle.d64, 0);
    assert.ok(extracted.ok);
    assert.deepEqual([...extracted.prg], [...built.bundle.prg]);
  });
}
