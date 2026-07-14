import { assemble } from "../src/index.js";

/**
 * Assemble a snippet in direct mode at a fixed load address and return the emitted code bytes
 * (the PRG with its two-byte load-address header removed). Throws if assembly failed.
 */
export function assembleCode(source, load = 0x1000) {
  const result = assemble({ schema: 1, source, runMode: "direct", loadAddress: load, runAddress: load });
  if (!result.ok) {
    throw new Error(`assembly failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return [...result.prg.slice(2)];
}

/** Assemble and return the full result (used for diagnostic assertions). */
export function assembleDirect(source, load = 0x1000) {
  return assemble({ schema: 1, source, runMode: "direct", loadAddress: load, runAddress: load });
}
