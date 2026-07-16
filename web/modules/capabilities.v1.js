// Capability detection. See specs/WEB-CLIENT.md "Browser and security boundaries". Missing
// core capabilities are reported before the IDE initializes so the client shows an explicit
// unsupported state instead of failing mid-build. WASM and workers are reported as feature
// flags: WASM gates only the (already unavailable) emulator, and a missing worker degrades to
// the main-thread build path rather than blocking the shell.

// The minimum required to edit, assemble, and download artifacts.
const REQUIRED = ["typedArrays", "blobUrls", "textCodec"];

function detectLocalStorage(env) {
  try {
    const probe = "c64.dev.v1.__probe__";
    env.localStorage.setItem(probe, "1");
    env.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the capabilities the client cares about.
 * @param {typeof globalThis} [env]
 * @returns {{ supported: boolean, missing: string[], features: Record<string, boolean> }}
 */
export function detectCapabilities(env = globalThis) {
  const features = {
    webAssembly:
      typeof env.WebAssembly === "object" && typeof env.WebAssembly.instantiate === "function",
    workers: typeof env.Worker === "function",
    typedArrays:
      typeof env.Uint8Array === "function" && typeof env.Uint8Array.prototype.subarray === "function",
    blobUrls:
      typeof env.Blob === "function" &&
      typeof env.URL === "function" &&
      typeof env.URL.createObjectURL === "function",
    textCodec: typeof env.TextEncoder === "function" && typeof env.TextDecoder === "function",
    localStorage: detectLocalStorage(env),
  };

  const missing = REQUIRED.filter((name) => !features[name]);
  return { supported: missing.length === 0, missing, features };
}
