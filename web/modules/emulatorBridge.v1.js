// Emulator bridge: the single documented integration point between the static client and the
// deterministic C64 core. See specs/WEB-CLIENT.md "Emulator bridge contract" and
// specs/EMULATOR.md "v0 WebAssembly boundary" (the authoritative shared contract).
//
// The bridge targets the embind v0 boundary but does NOT contain or fake an emulator. Until the
// production c64core.wasm artifact is present in the deployment, `createMachine` resolves to an
// explicit unavailable result. It never fabricates a framebuffer, cycle count, or memory read.
// All wall-clock pacing (requestAnimationFrame, Web Audio) and the 16-colour palette -> RGBA
// mapping live in the client, outside this module and outside the core.
//
// v0 ROM policy (per specs/EMULATOR.md): the v0 core runs DIRECT-mode PRGs with NO ROM
// (loadPrg -> setPC(runAddress) -> runFrame/runCycles -> framebuffer). BASIC-SYS boot needs
// KERNAL/CHARGEN ROMs and stays gated until a ROM decision lands; that per-project gate is the
// client's Run logic, not this factory. So `createMachine` availability reflects only the core,
// and `romMissing` is reserved for the client's basic-sys gate.

/**
 * C64 display geometry and framebuffer format for the v0 boundary. framebuffer() returns a
 * FRESH Uint8Array copy in "c64-indexed-8" format: one byte per pixel, a 4-bit colour index
 * (0..15) that the client maps to RGBA through its own C64 palette. Dimensions are 384x272
 * (visible area including border).
 */
export const C64_DISPLAY = Object.freeze({
  frameWidth: 384,
  frameHeight: 272,
  framebufferFormat: "c64-indexed-8",
  colorCount: 16,
  pixelAspect: 1,
});

/** Timing profiles accepted by the Machine constructor. */
export const TIMING_PROFILES = Object.freeze(["pal-6569", "ntsc-6567r8"]);

/** The embind Machine methods the bridge requires of a real v0 module. */
export const MACHINE_METHODS = Object.freeze([
  "reset",
  "setPC",
  "loadPrg",
  "runCycles",
  "runFrame",
  "framebuffer",
  "frameWidth",
  "frameHeight",
  "readMem",
  "writeMem",
  "delete",
]);

/** Stable reasons the emulator can be unavailable. */
export const UNAVAILABLE_REASONS = Object.freeze({
  coreMissing: "emulator-core-missing",
  romMissing: "rom-set-missing",
  moduleError: "wasm-module-error",
  incompatible: "machine-interface-incompatible",
});

/**
 * @typedef {object} MachineResult
 * @property {boolean} available
 * @property {string|null} reason      one of UNAVAILABLE_REASONS when unavailable
 * @property {string} message          human-readable explanation
 * @property {object|null} machine      the constructed embind Machine when available
 * @property {typeof C64_DISPLAY} display
 */

/** @returns {MachineResult} */
function unavailable(reason, message) {
  return { available: false, reason, message, machine: null, display: C64_DISPLAY };
}

/** Best-effort release of an embind-owned C++ instance so a failed construction never leaks. */
function safeDelete(instance) {
  if (instance && typeof instance.delete === "function") {
    try {
      instance.delete();
    } catch {
      // Nothing to recover if the native delete throws.
    }
  }
}

/**
 * Map an unavailable reason to the stable UI error category the client should surface.
 * @param {string|null} reason
 * @returns {"wasm"|"rom"}
 */
export function categoryForReason(reason) {
  return reason === UNAVAILABLE_REASONS.romMissing ? "rom" : "wasm";
}

/**
 * Attempt to construct a Machine against the embind v0 boundary. The module factory is injected
 * so this module holds no emulator bytes. With no factory — the current state, because
 * c64core.wasm is not present in the deployment — it resolves to
 * `{ available: false, reason: "emulator-core-missing" }`.
 *
 * The v0 core needs no ROM to run direct-mode PRGs, so availability depends only on the core and
 * a well-formed Machine. Whether a specific project may Run (direct-mode: yes; basic-sys: needs a
 * ROM decision) is decided by the client's Run logic, not here.
 *
 * @param {object} [options]
 * @param {() => Promise<{ Machine: new (timingProfile: string) => object }>} [options.createCore]
 *        the c64core.js DEFAULT-export Emscripten factory (`import createC64Core from '.../c64core.js'`)
 * @param {"pal-6569"|"ntsc-6567r8"} [options.timingProfile]  passed to `new Machine(timingProfile)`
 * @returns {Promise<MachineResult>}
 */
export async function createMachine(options = {}) {
  const { createCore } = options;
  // Pass the requested profile through unchanged; the core validates it via ok()/configError().
  // Only an entirely absent profile defaults to PAL. We do not silently coerce an invalid value,
  // which would risk reporting the wrong machine as available.
  const timingProfile = options.timingProfile ?? "pal-6569";

  if (typeof createCore !== "function") {
    return unavailable(
      UNAVAILABLE_REASONS.coreMissing,
      "The C64 emulator core is not available yet. Build and Download work; Run is pending the c64core.wasm artifact.",
    );
  }

  let module;
  try {
    module = await createCore();
  } catch (cause) {
    return unavailable(
      UNAVAILABLE_REASONS.moduleError,
      `The emulator WASM module failed to load: ${cause?.message ?? cause}.`,
    );
  }

  const MachineCtor = module?.Machine;
  if (typeof MachineCtor !== "function") {
    return unavailable(
      UNAVAILABLE_REASONS.incompatible,
      "The emulator module does not expose a Machine class.",
    );
  }

  let instance;
  try {
    instance = new MachineCtor(timingProfile);
  } catch (cause) {
    return unavailable(
      UNAVAILABLE_REASONS.moduleError,
      `The Machine failed to initialize: ${cause?.message ?? cause}.`,
    );
  }

  const missing = MACHINE_METHODS.filter((name) => typeof instance[name] !== "function");
  if (missing.length > 0) {
    safeDelete(instance);
    return unavailable(
      UNAVAILABLE_REASONS.incompatible,
      `The Machine is missing required methods: ${missing.join(", ")}.`,
    );
  }

  // v0 construction-validity check: the core reports an invalid timing profile (or other config
  // fault) via ok()/configError() rather than throwing across embind. Surface it explicitly and
  // release the instance instead of reporting a broken machine as available.
  if (typeof instance.ok === "function" && !instance.ok()) {
    const detail = typeof instance.configError === "function" ? instance.configError() : "invalid-config";
    safeDelete(instance);
    return unavailable(
      UNAVAILABLE_REASONS.moduleError,
      `The Machine reported an invalid configuration: ${detail}.`,
    );
  }

  return {
    available: true,
    reason: null,
    message: "Emulator core ready.",
    machine: instance,
    display: C64_DISPLAY,
  };
}
