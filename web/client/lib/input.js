// Input controller: physical KeyboardEvent.code mapping into the C64 matrix, active-low joysticks
// (keys + optional Gamepad), RESTORE (NMI), and unconditional release-all on blur/visibility loss
// so no key can stick (see specs/IO.md, specs/WEB-CLIENT.md). Browser defaults are suppressed only
// while the emulator surface holds focus and only for mapped, unmodified keys.

import { buildKeyboardColumns, buildJoystick, JOYSTICK2_MAP, RESTORE_CODES, isMappedCode } from "./keymap.js";

export class InputController {
  /**
   * @param {HTMLElement} surface focusable element that owns emulator input focus
   * @param {{ onReleaseAll?: () => void, onFocusChange?: (focused:boolean)=>void }} [handlers]
   */
  constructor(surface, handlers = {}) {
    this._surface = surface;
    this._pressed = new Set();
    this._restore = false;
    this._focused = false;
    this._joystickPort = 2;
    this._gamepadEnabled = true;
    this._onReleaseAll = handlers.onReleaseAll || (() => {});
    this._onFocusChange = handlers.onFocusChange || (() => {});
    this._disposers = [];
  }

  get focused() {
    return this._focused;
  }

  setJoystickPort(port) {
    this._joystickPort = port === 1 ? 1 : 2;
  }

  setGamepadEnabled(on) {
    this._gamepadEnabled = !!on;
  }

  attach() {
    const add = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._disposers.push(() => target.removeEventListener(type, fn, opts));
    };
    add(this._surface, "focus", () => this._setFocused(true));
    add(this._surface, "blur", () => {
      this._setFocused(false);
      this.releaseAll();
    });
    add(window, "keydown", (e) => this._onKeyDown(e));
    add(window, "keyup", (e) => this._onKeyUp(e));
    add(window, "blur", () => this.releaseAll());
    add(document, "visibilitychange", () => {
      if (document.visibilityState !== "visible") this.releaseAll();
    });
  }

  dispose() {
    for (const d of this._disposers) d();
    this._disposers = [];
  }

  _setFocused(focused) {
    if (this._focused === focused) return;
    this._focused = focused;
    this._onFocusChange(focused);
  }

  _shouldHandle(e) {
    // Let genuine browser shortcuts through (Cmd/Alt, or Ctrl combined with a non-Ctrl key).
    if (e.metaKey || e.altKey) return false;
    if (e.ctrlKey && e.code !== "ControlLeft" && e.code !== "ControlRight") return false;
    return true;
  }

  _onKeyDown(e) {
    if (!this._focused || !this._shouldHandle(e)) return;
    if (!isMappedCode(e.code, JOYSTICK2_MAP)) return;
    e.preventDefault(); // suppress browser default only for mapped keys while focused
    this._pressed.add(e.code);
    if (RESTORE_CODES.has(e.code)) this._restore = true;
  }

  _onKeyUp(e) {
    if (!this._pressed.has(e.code) && !RESTORE_CODES.has(e.code)) return;
    if (this._focused && isMappedCode(e.code, JOYSTICK2_MAP)) e.preventDefault();
    this._pressed.delete(e.code);
    if (RESTORE_CODES.has(e.code)) this._restore = false;
  }

  /** Clear all held input immediately. Called on blur/visibility loss. */
  releaseAll() {
    const had = this._pressed.size > 0 || this._restore;
    this._pressed.clear();
    this._restore = false;
    if (had) this._onReleaseAll();
  }

  _readGamepad() {
    if (!this._gamepadEnabled || typeof navigator === "undefined" || !navigator.getGamepads) return 0xff;
    const pads = navigator.getGamepads();
    let value = 0xff;
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes || [];
      const bt = pad.buttons || [];
      const pressed = (i) => bt[i] && (bt[i].pressed || bt[i].value > 0.5);
      if ((ax[1] ?? 0) < -0.5 || pressed(12)) value &= ~(1 << 0) & 0xff; // up
      if ((ax[1] ?? 0) > 0.5 || pressed(13)) value &= ~(1 << 1) & 0xff; // down
      if ((ax[0] ?? 0) < -0.5 || pressed(14)) value &= ~(1 << 2) & 0xff; // left
      if ((ax[0] ?? 0) > 0.5 || pressed(15)) value &= ~(1 << 3) & 0xff; // right
      if (pressed(0) || pressed(1)) value &= ~(1 << 4) & 0xff; // fire
      break; // first connected pad only
    }
    return value;
  }

  /** Build the current InputSnapshot for the core. */
  snapshot() {
    const keyboardColumns = buildKeyboardColumns(this._pressed);
    const keyJoy = buildJoystick(this._pressed, JOYSTICK2_MAP);
    const joy = keyJoy & this._readGamepad() & 0xff;
    const snap = { keyboardColumns, joystick1: 0xff, joystick2: 0xff, restorePressed: this._restore };
    if (this._joystickPort === 1) snap.joystick1 = joy;
    else snap.joystick2 = joy;
    return snap;
  }
}
