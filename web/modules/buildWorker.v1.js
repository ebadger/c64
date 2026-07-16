// Build worker: runs the deterministic pipeline off the main thread so the editor stays
// responsive. It is a module worker that imports the same `src/` pipeline used by Node tests,
// via the pure buildCore entry point. See specs/WEB-CLIENT.md.

import { runBuild } from "./buildCore.v1.js";

self.onmessage = (event) => {
  const { id, project } = event.data ?? {};
  let outcome;
  try {
    outcome = runBuild(project);
  } catch (err) {
    // An unexpected fault is surfaced as a build-category internal error, never as a
    // fabricated successful artifact. Source is preserved on the main thread regardless.
    outcome = {
      ok: false,
      internal: true,
      message: err?.message ? String(err.message) : "Internal build error.",
      diagnostics: [],
      error: null,
      buildId: null,
      loadAddress: null,
      runAddress: null,
      prg: null,
      prgName: null,
      d64: null,
      d64Name: null,
    };
  }
  self.postMessage({ id, outcome });
};
