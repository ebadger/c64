// Pure build entry point shared by the Web Worker and headless Node tests. It runs the merged
// deterministic pipeline (specs/CODEGEN.md, specs/MEDIA.md) and returns a plain, structured-
// cloneable result. It never fabricates artifacts: a failed assembly yields diagnostics and
// null artifacts, exactly like the pipeline.

import { buildArtifacts } from "../../src/index.js";

/**
 * @typedef {object} BuildOutcome
 * @property {boolean} ok
 * @property {readonly object[]} diagnostics    stable-coded, position-sorted diagnostics
 * @property {object|null} error                media/D64 error, when assembly succeeded but the disk failed
 * @property {string|null} buildId
 * @property {number|null} loadAddress
 * @property {number|null} runAddress
 * @property {Uint8Array|null} prg
 * @property {string|null} prgName
 * @property {Uint8Array|null} d64
 * @property {string|null} d64Name
 */

/**
 * Assemble a raw project and build both artifacts.
 * @param {object} project
 * @returns {BuildOutcome}
 */
export function runBuild(project) {
  const result = buildArtifacts(project);
  const diagnostics = result.assembly?.diagnostics ?? [];

  if (!result.ok) {
    return {
      ok: false,
      diagnostics,
      error: result.error,
      buildId: null,
      loadAddress: null,
      runAddress: null,
      prg: null,
      prgName: null,
      d64: null,
      d64Name: null,
    };
  }

  const bundle = result.bundle;
  return {
    ok: true,
    diagnostics,
    error: null,
    buildId: bundle.buildId,
    loadAddress: bundle.loadAddress,
    runAddress: bundle.runAddress,
    prg: bundle.prg,
    prgName: bundle.prgName,
    d64: bundle.d64,
    d64Name: bundle.d64Name,
  };
}
