// Assembler and pipeline version. Part of the deterministic build identity: the same
// version + canonical project + output bytes must always hash to the same buildId, so this
// constant is bumped only when a change alters emitted bytes or the build-id preimage.
export const ASSEMBLER_VERSION = "0.1.0";
