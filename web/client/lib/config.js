// Centralized static configuration for the c64 web client. Environment-free: this module holds
// only constants and pure path helpers so it can be imported unchanged in the browser, in the
// module worker, and in Node tests. It never reads `window`, `document`, or `localStorage`.

// Namespaced browser-storage keys (see specs/WEB-CLIENT.md). Only canonical project JSON and
// non-sensitive preferences are ever written here; binary ROM/D64 bytes are never stored.
export const AUTOSAVE_KEY = "c64.dev.v1.autosave";
export const PREFERENCES_KEY = "c64.dev.v1.preferences";

// Client-side raw decoded-source cap (distinct from the pipeline's normalized-source cap in
// specs/CODEGEN.md). Applied before allocation amplification on `?code` decode.
export const MAX_DECODED_SOURCE_BYTES = 256 * 1024;

// A `?code` share whose URL would exceed this many characters is refused with a recommendation
// to download the source instead (browsers/intermediaries truncate very long URLs).
export const MAX_SHARE_URL_CHARS = 16 * 1024;

// Expected ROM role sizes in bytes (see specs/ROM-ASSETS.md).
export const ROM_SIZES = Object.freeze({ basic: 8192, kernal: 8192, chargen: 4096 });

// Relative locations resolved against the repository-root static base (see repoRootBase below).
// The web client lives at /web/client/; these are repo-relative so the same paths work under a
// static server rooted at the repository and, later, under the Pages build.
export const WASM_LOADER_PATH = "build/wasm/c64core.mjs";
export const EMULATOR_WRAPPER_PATH = "web/emulator/c64.mjs";
export const GALLERY_PATH = "web/client/gallery.json";

// Stable UI error categories (see specs/WEB-CLIENT.md "Error handling").
export const ERROR_CATEGORIES = Object.freeze([
  "share",
  "storage",
  "build",
  "rom",
  "wasm",
  "media",
  "audio",
  "input",
  "capability",
  "gallery",
  "url",
]);

/**
 * Compute the repository-root static base URL from a module URL inside web/client/lib/. In the
 * browser and Node, `import.meta.url` for such a module is `<origin>/web/client/lib/<file>`; the
 * repository root is three path segments up. Returns a URL object ending in `/`.
 * @param {string} moduleUrl a `web/client/lib/*` module's import.meta.url
 */
export function repoRootBase(moduleUrl) {
  // lib/<file> -> lib/ -> web/client/ -> web/ -> repo root
  return new URL("../../../", moduleUrl);
}
