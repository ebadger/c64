// Browser capability detection. Run before initializing the emulator: missing capabilities are
// reported as an explicit `capability` error state and the app does not pretend to be ready
// (see specs/WEB-CLIENT.md "Browser and security boundaries").

/**
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function detectCapabilities() {
  const missing = [];
  const has = (cond, name) => {
    if (!cond) missing.push(name);
  };

  has(typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function", "WebAssembly");
  has(typeof Worker === "function", "Web Workers");
  has(typeof Uint8Array === "function" && typeof Float32Array === "function", "typed arrays");
  has(typeof TextEncoder === "function" && typeof TextDecoder === "function", "TextEncoder/TextDecoder");
  has(typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function", "Web Audio");
  has(typeof document !== "undefined" && typeof document.createElement === "function", "DOM");
  // Canvas 2D
  try {
    const c = document.createElement("canvas");
    has(!!(c.getContext && c.getContext("2d")), "Canvas 2D");
  } catch {
    missing.push("Canvas 2D");
  }
  has(typeof URL === "function" && typeof URLSearchParams === "function", "URL APIs");
  has("localStorage" in globalThis, "localStorage");

  return { ok: missing.length === 0, missing };
}
