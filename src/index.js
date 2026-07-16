// Public API for the deterministic source-to-artifact pipeline. One ES module implementation
// runs unchanged in modern browsers and Node.js; there are no runtime dependencies and no
// environment-specific globals.

export { ASSEMBLER_VERSION } from "./version.js";
export { sha256Hex } from "./hash.js";
export { encodePetsciiCodePoint, encodePetsciiString } from "./petscii.js";
export {
  DEFAULT_PROJECT,
  validateProject,
  normalizeLineEndings,
  canonicalJson,
  buildIdPreimage,
  computeBuildId,
} from "./project.js";
export { OPCODES, isMnemonic } from "./opcodes.js";
export { assemble } from "./assembler.js";
export {
  buildBasicSysStub,
  basicSysStubLength,
  detectBasicSysRunAddress,
  defaultBasicCodeOrigin,
  BASIC_LOAD_ADDRESS,
} from "./basicStub.js";
export { parsePrg, downloadFilename } from "./prg.js";
export {
  buildD64,
  parseD64,
  extractPrg,
  mountD64,
  sectorsInTrack,
  sectorOffset,
  D64_SIZE,
  D64_SIZE_WITH_ERRORS,
} from "./d64.js";

import { assemble } from "./assembler.js";
import { validateProject } from "./project.js";
import { buildD64 } from "./d64.js";
import { downloadFilename } from "./prg.js";

/**
 * Assemble a project and build both artifacts, returning an ArtifactBundle-shaped result.
 * Returns `{ ok: false, diagnostics|error }` when assembly or D64 construction fails; a
 * failure never yields partial or fabricated artifacts.
 * @param {object} rawProject
 * @returns {{ ok: boolean, bundle: object|null, assembly: object, error: object|null }}
 */
export function buildArtifacts(rawProject) {
  const assembly = assemble(rawProject);
  if (!assembly.ok) {
    return { ok: false, bundle: null, assembly, error: null };
  }
  const validation = validateProject(rawProject);
  // assemble already validated successfully, so this cannot fail here.
  const project = validation.project;
  const disk = buildD64(project, assembly.prg);
  if (!disk.ok) {
    return { ok: false, bundle: null, assembly, error: disk.error };
  }
  return {
    ok: true,
    assembly,
    error: null,
    bundle: {
      schema: 1,
      buildId: assembly.buildId,
      prgName: downloadFilename(project.outputName, "prg"),
      prg: assembly.prg,
      d64Name: downloadFilename(project.outputName, "d64"),
      d64: disk.d64,
      loadAddress: assembly.loadAddress,
      runAddress: assembly.runAddress,
    },
  };
}
