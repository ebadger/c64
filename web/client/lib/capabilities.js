// Browser capability detection. Run before initializing the emulator (see specs/WEB-CLIENT.md
// "Browser and security boundaries").
//
// Capabilities are split into REQUIRED and OPTIONAL. A missing required capability means the
// emulator cannot run at all, so the app reports an explicit `capability` error state and does not
// pretend to be ready. A missing OPTIONAL capability degrades gracefully: the app still loads,
// builds, runs video, accepts input, and downloads artifacts, but the affected feature is disabled
// and honestly labelled. Web Audio is optional — sound is gesture-gated and never required to run
// a program, and some environments (e.g. headless WebKit) do not provide it.

/**
 * @returns {{ ok: boolean, missing: string[], optional: string[] }}
 *   `missing` lists absent REQUIRED capabilities (empty => ok). `optional` lists absent OPTIONAL
 *   capabilities (the app runs, but degrades those features).
 */
export function detectCapabilities() {
  const missing = [];
  const optional = [];
  const req = (cond, name) => {
    if (!cond) missing.push(name);
  };
  const opt = (cond, name) => {
    if (!cond) optional.push(name);
  };

  req(typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function", "WebAssembly");
  req(typeof Worker === "function", "Web Workers");
  req(typeof Uint8Array === "function" && typeof Float32Array === "function", "typed arrays");
  req(typeof TextEncoder === "function" && typeof TextDecoder === "function", "TextEncoder/TextDecoder");
  req(typeof document !== "undefined" && typeof document.createElement === "function", "DOM");
  // Canvas 2D (required for video presentation).
  try {
    const c = document.createElement("canvas");
    req(!!(c.getContext && c.getContext("2d")), "Canvas 2D");
  } catch {
    missing.push("Canvas 2D");
  }
  req(typeof URL === "function" && typeof URLSearchParams === "function", "URL APIs");
  req("localStorage" in globalThis, "localStorage");

  // OPTIONAL: Web Audio. The emulator runs (video/input/build/download) without it; only sound is
  // unavailable. Missing here degrades the audio control instead of blocking the whole app.
  opt(typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function", "Web Audio");

  return { ok: missing.length === 0, missing, optional };
}
