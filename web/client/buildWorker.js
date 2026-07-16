// Build worker (module worker). Imports the SAME production assembler/media modules that the Node
// tests use, so a browser build is byte-identical to a headless build (see specs/CODEGEN.md,
// specs/MEDIA.md). It runs off the UI thread and returns structured results by sequence number so
// the client can drop stale results. Source is data only; nothing here is evaluated as code.

import { buildArtifacts } from "../../src/index.js";

self.onmessage = (event) => {
  const data = event.data || {};
  const seq = data.seq | 0;
  const project = data.project;
  try {
    const result = buildArtifacts(project);
    if (!result.ok) {
      // Assembly failure -> diagnostics; D64 failure -> a media error. No partial/fabricated bytes.
      const diagnostics = result.assembly && !result.assembly.ok ? result.assembly.diagnostics : [];
      self.postMessage({
        seq,
        ok: false,
        diagnostics,
        error: result.error,
      });
      return;
    }
    const { assembly, bundle } = result;
    const prg = bundle.prg.buffer.slice(bundle.prg.byteOffset, bundle.prg.byteOffset + bundle.prg.byteLength);
    const d64 = bundle.d64.buffer.slice(bundle.d64.byteOffset, bundle.d64.byteOffset + bundle.d64.byteLength);
    self.postMessage(
      {
        seq,
        ok: true,
        buildId: assembly.buildId,
        loadAddress: assembly.loadAddress,
        runAddress: assembly.runAddress,
        diagnostics: assembly.diagnostics,
        prgName: bundle.prgName,
        d64Name: bundle.d64Name,
        prg,
        d64,
      },
      [prg, d64],
    );
  } catch (err) {
    // Unexpected exception rejects the build as internal; it is never a success-shaped result.
    self.postMessage({
      seq,
      ok: false,
      diagnostics: [],
      error: { category: "build", code: "internal", message: String(err && err.message ? err.message : err) },
    });
  }
};
