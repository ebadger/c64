// Build (and optionally record) the golden expectations for every committed example.
//
//   node examples/build-example.mjs            build all examples and verify against
//                                              their committed expected.json (fails on drift)
//   node examples/build-example.mjs --write    regenerate expected.json for each example
//
// This is Node example tooling; it uses the same production pipeline from src/ that the
// browser and headless tests use.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildArtifacts } from "../src/index.js";
import { sha256Hex } from "../src/hash.js";
import { EXAMPLES, exampleDir, loadExample, loadExpected } from "./load-example.mjs";

function expectationsFor(name) {
  const project = loadExample(name);
  const result = buildArtifacts(project);
  if (!result.ok) {
    const detail = result.assembly && !result.assembly.ok ? JSON.stringify(result.assembly.diagnostics) : JSON.stringify(result.error);
    throw new Error(`Example '${name}' failed to build: ${detail}`);
  }
  const { assembly, bundle } = result;
  return {
    buildId: assembly.buildId,
    loadAddress: assembly.loadAddress,
    runAddress: assembly.runAddress,
    prgLength: bundle.prg.length,
    prgSha256: sha256Hex(bundle.prg),
    d64Length: bundle.d64.length,
    d64Sha256: sha256Hex(bundle.d64),
    prgName: bundle.prgName,
    d64Name: bundle.d64Name,
  };
}

const write = process.argv.includes("--write");
let failures = 0;

for (const name of EXAMPLES) {
  const actual = expectationsFor(name);
  if (write) {
    writeFileSync(join(exampleDir(name), "expected.json"), JSON.stringify(actual, null, 2) + "\n");
    console.log(`wrote expected.json for ${name}: buildId ${actual.buildId}`);
    continue;
  }
  const expected = loadExpected(name);
  const drift = Object.keys(actual).filter((k) => actual[k] !== expected[k]);
  if (drift.length > 0) {
    failures += 1;
    console.error(`DRIFT in ${name}: ${drift.join(", ")}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`${name}: OK (buildId ${actual.buildId}, prg ${actual.prgLength}B, d64 ${actual.d64Length}B)`);
  }
}

process.exit(failures === 0 ? 0 : 1);
