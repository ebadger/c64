// Thin standards-based ES-module wrapper around the production WebAssembly core.
//
// This wrapper is dependency-light and runs unchanged in modern browsers and Node.js. It never
// exposes a writable view into WebAssembly memory: byte inputs are copied into the module by
// embind (convertJSArrayToNumberVector), and every result is a plain JS value or object copy.
// A WebAssembly memory growth therefore can never invalidate a handle held by JavaScript.
//
// The Emscripten loader (c64core.mjs) and its c64core.wasm are build outputs (see SETUP.md);
// this hand-written wrapper is the stable, committed API the browser client and tests use.

/**
 * Load the core. `loader` may be the Emscripten factory function (its default export) or a
 * module specifier / URL string to import it from.
 * @param {Function|string} loader
 * @returns {Promise<Emulator>}
 */
export async function createEmulator(loader) {
  let factory = loader;
  if (typeof loader === "string") {
    const mod = await import(loader);
    factory = mod.default;
  }
  if (typeof factory !== "function") {
    throw new TypeError("createEmulator requires the Emscripten factory function or its path.");
  }
  const module = await factory();
  return new Emulator(module);
}

/** Top-level core: scenario suite access and machine construction. */
export class Emulator {
  constructor(module) {
    this._m = module;
  }

  /** Canonical JSON for one deterministic scenario, parsed. */
  scenario(id) {
    return JSON.parse(this._m.scenarioJson(String(id)));
  }

  /** Canonical JSON for every scenario, parsed (array of { id, result }). */
  allScenarios() {
    return JSON.parse(this._m.allScenariosJson());
  }

  /** Raw canonical JSON string for every scenario (used for byte-exact parity checks). */
  allScenariosJson() {
    return this._m.allScenariosJson();
  }

  /** List of scenario ids. */
  scenarioIds() {
    const arr = this._m.scenarioIds();
    return arr;
  }

  /**
   * Create a machine handle. When `config` is supplied the machine is configured (and powered
   * on) atomically per the specs/EMULATOR.md `create(config)` contract; read
   * `machine.configureError` ("none" on success). Call machine.dispose() when done.
   */
  createMachine(config) {
    const machine = new Machine(this._m);
    if (config !== undefined) {
      machine.configureError = machine.configure(config);
    }
    return machine;
  }
}

function toUint8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  return Uint8Array.from(bytes ?? []);
}

/** A single C64 machine instance. Wraps the embind Machine handle. */
export class Machine {
  constructor(module) {
    this._m = module;
    this._h = new module.Machine();
  }

  /**
   * Configure and power on. ROM byte arrays are copied into the module.
   * @returns {string} error code id ("none" on success)
   */
  configure({ timingProfile = "pal-6569", sidModel = "6581", basic, kernal, chargen, powerOnSeed = 0 }) {
    return this._h.configure(
      timingProfile,
      sidModel,
      toUint8(basic),
      toUint8(kernal),
      toUint8(chargen),
      powerOnSeed | 0,
    );
  }

  ready() {
    return this._h.ready();
  }

  romSetId() {
    return this._h.romSetId();
  }

  reset(kind = "power-on") {
    // Pass the kind through unchanged; the core rejects unknown kinds with "invalid-state"
    // rather than performing a destructive default reset.
    return this._h.reset(String(kind));
  }

  loadPrg(bytes) {
    return this._h.loadPrg(toUint8(bytes));
  }

  setProgramCounter(pc) {
    return this._h.setProgramCounter(pc & 0xffff);
  }

  runCycles(maxCycles) {
    return this._h.runCycles(Number(maxCycles));
  }

  cpuState() {
    return this._h.cpuState();
  }

  debugPeek(addr) {
    return this._h.debugPeek(addr & 0xffff);
  }

  debugReadRam(addr) {
    return this._h.debugReadRam(addr & 0xffff);
  }

  debugWriteRam(addr, value) {
    this._h.debugWriteRam(addr & 0xffff, value & 0xff);
  }

  regionOf(addr) {
    return this._h.regionOf(addr & 0xffff);
  }

  processorPort() {
    return this._h.processorPort();
  }

  setIrqLine(asserted) {
    this._h.setIrqLine(Boolean(asserted));
  }

  triggerNmi() {
    this._h.triggerNmi();
  }

  addBreakpoint(addr) {
    this._h.addBreakpoint(addr & 0xffff);
  }

  clearBreakpoints() {
    this._h.clearBreakpoints();
  }

  deviceStatus() {
    return {
      vic: this._h.vicImplemented(),
      sid: this._h.sidImplemented(),
      cia1: this._h.cia1Implemented(),
      cia2: this._h.cia2Implemented(),
    };
  }

  mountD64(bytes) {
    return this._h.mountD64(toUint8(bytes));
  }

  copyFramebuffer() {
    return this._h.copyFramebuffer();
  }

  drainAudio() {
    return this._h.drainAudio();
  }

  setInput() {
    return this._h.setInput();
  }

  /** Release the underlying WASM handle. */
  dispose() {
    if (this._h) {
      this._h.delete();
      this._h = null;
    }
  }
}
