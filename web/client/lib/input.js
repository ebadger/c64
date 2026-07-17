// Input controller: physical KeyboardEvent.code mapping into the C64 matrix, active-low joysticks
// (keys + optional Gamepad), RESTORE (NMI), and release guarantees across display/external focus
// changes so no key can stick (see specs/IO.md, specs/WEB-CLIENT.md). Browser defaults are
// suppressed only while the emulator surface holds focus and only for mapped, unmodified keys.

import {
  buildKeyboardColumns,
  buildJoystick,
  C64_VIRTUAL_KEY_MAP,
  JOYSTICK2_MAP,
  RESTORE_CODES,
  isMappedCode,
} from "./keymap.js";

export function shouldHandlePhysicalEvent(event) {
  if (event.metaKey || event.altKey) return false;
  if (event.ctrlKey && event.code !== "ControlLeft" && event.code !== "ControlRight") return false;
  if (event.code === "Tab" && event.shiftKey) return false;
  return true;
}

export class InputController {
  /**
   * @param {HTMLElement} surface focusable element that owns emulator input focus
   * @param {{
   *   inputRegion?: HTMLElement,
   *   onReleasePhysical?: () => void,
   *   onReleaseAll?: () => void,
   *   onFocusChange?: (focused:boolean)=>void
   * }} [handlers]
   */
  constructor(surface, handlers = {}) {
    this._surface = surface;
    this._inputRegion = handlers.inputRegion || surface;
    this._pressed = new Set();
    this._virtualPressed = new Map();
    this._physicalRestore = false;
    this._virtualRestoreCount = 0;
    this._focused = false;
    this._joystickPort = 2;
    this._gamepadEnabled = true;
    this._onReleasePhysical = handlers.onReleasePhysical || (() => {});
    this._onReleaseAll = handlers.onReleaseAll || (() => {});
    this._onFocusChange = handlers.onFocusChange || (() => {});
    this._disposers = [];
    this._blurTimer = 0;
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
    add(this._surface, "blur", (event) => {
      this._setFocused(false);
      const relatedTarget = event.relatedTarget;
      if (this._blurTimer) clearTimeout(this._blurTimer);
      // Pointer focus can settle after the blur event, and WebKit may omit relatedTarget.
      // Defer once so virtual-key clicks within the emulator region do not consume a latch.
      this._blurTimer = setTimeout(() => {
        this._blurTimer = 0;
        const activeTarget = document.activeElement || relatedTarget;
        if (activeTarget && this._inputRegion.contains(activeTarget)) this.releasePhysical();
        else this.releaseAll();
      }, 0);
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
    if (this._blurTimer) clearTimeout(this._blurTimer);
    this._blurTimer = 0;
  }

  _setFocused(focused) {
    if (this._focused === focused) return;
    this._focused = focused;
    this._onFocusChange(focused);
  }

  _shouldHandle(e) {
    return shouldHandlePhysicalEvent(e);
  }

  _onKeyDown(e) {
    if (!this._focused || !this._shouldHandle(e)) return;
    if (!isMappedCode(e.code, JOYSTICK2_MAP)) return;
    e.preventDefault(); // suppress browser default only for mapped keys while focused
    this._pressed.add(e.code);
    if (RESTORE_CODES.has(e.code)) this._physicalRestore = true;
  }

  _onKeyUp(e) {
    if (!this._pressed.has(e.code) && !RESTORE_CODES.has(e.code)) return;
    if (this._focused && isMappedCode(e.code, JOYSTICK2_MAP)) e.preventDefault();
    this._pressed.delete(e.code);
    if (RESTORE_CODES.has(e.code)) this._physicalRestore = false;
  }

  /** Press a named key from C64_VIRTUAL_KEYBOARD. Reference-counted for overlapping pulses. */
  pressVirtualKey(id) {
    const key = C64_VIRTUAL_KEY_MAP.get(id);
    if (!key) return false;
    if (key.restore) {
      this._virtualRestoreCount++;
    } else if (key.matrix) {
      this._virtualPressed.set(id, (this._virtualPressed.get(id) || 0) + 1);
    } else {
      return false;
    }
    return true;
  }

  /** Release one matching virtual-key press without disturbing another active source. */
  releaseVirtualKey(id) {
    const key = C64_VIRTUAL_KEY_MAP.get(id);
    if (!key) return false;
    if (key.restore) {
      if (this._virtualRestoreCount === 0) return false;
      this._virtualRestoreCount--;
      return true;
    }
    const count = this._virtualPressed.get(id) || 0;
    if (count === 0) return false;
    if (count === 1) this._virtualPressed.delete(id);
    else this._virtualPressed.set(id, count - 1);
    return true;
  }

  /** Clear physical keys when display focus moves within the emulator input region. */
  releasePhysical() {
    const had = this._pressed.size > 0 || this._physicalRestore;
    this._pressed.clear();
    this._physicalRestore = false;
    if (had) this._onReleasePhysical();
  }

  /** Clear all held input immediately. Called on blur/visibility loss, Stop, and panel close. */
  releaseAll() {
    const had = this._pressed.size > 0
      || this._physicalRestore
      || this._virtualPressed.size > 0
      || this._virtualRestoreCount > 0;
    this._pressed.clear();
    this._virtualPressed.clear();
    this._physicalRestore = false;
    this._virtualRestoreCount = 0;
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
    const keyboardColumns = buildKeyboardColumns(this._pressed, this._virtualPressed.keys());
    const keyJoy = buildJoystick(this._pressed, JOYSTICK2_MAP);
    const joy = keyJoy & this._readGamepad() & 0xff;
    const snap = {
      keyboardColumns,
      joystick1: 0xff,
      joystick2: 0xff,
      restorePressed: this._physicalRestore || this._virtualRestoreCount > 0,
    };
    if (this._joystickPort === 1) snap.joystick1 = joy;
    else snap.joystick2 = joy;
    return snap;
  }
}
