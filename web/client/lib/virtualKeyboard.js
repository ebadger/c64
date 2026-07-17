import { C64_VIRTUAL_KEYBOARD } from "./keymap.js";

export const VIRTUAL_KEY_PULSE_MS = 100;

export function isPointerActivation(event) {
  return !!event && typeof event.detail === "number" && event.detail > 0;
}

export class VirtualKeyboard {
  /**
   * @param {HTMLElement} element key-rendering mount point
   * @param {{
   *   pressVirtualKey:(id:string)=>boolean,
   *   releaseVirtualKey:(id:string)=>boolean,
   *   releaseAll:()=>void
   * }} input
   * @param {{
   *   details?: HTMLDetailsElement,
   *   summary?: HTMLElement,
   *   focusTarget?: HTMLElement,
   *   pulseMs?: number
   * }} [options]
   */
  constructor(element, input, options = {}) {
    if (!element || !element.ownerDocument) {
      throw new TypeError("virtual keyboard mount point must be a DOM element");
    }
    if (!input
        || typeof input.pressVirtualKey !== "function"
        || typeof input.releaseVirtualKey !== "function"
        || typeof input.releaseAll !== "function") {
      throw new TypeError("virtual keyboard requires a matrix input controller");
    }
    this._element = element;
    this._input = input;
    this._details = options.details || null;
    this._summary = options.summary || null;
    this._focusTarget = options.focusTarget || null;
    this._pulseMs = Number.isFinite(options.pulseMs)
      ? Math.max(0, options.pulseMs)
      : VIRTUAL_KEY_PULSE_MS;
    this._latched = new Set();
    this._locked = new Set();
    this._buttons = new Map();
    this._pressedCounts = new Map();
    this._timers = new Map();
  }

  mount() {
    const document = this._element.ownerDocument;
    const layout = document.createElement("div");
    layout.className = "vk-layout";
    const body = document.createElement("div");
    body.className = "vk-keyboard-body";

    const main = document.createElement("div");
    main.className = "vk-main";
    const mainRows = C64_VIRTUAL_KEYBOARD.rows.slice(0, -1);
    for (let index = 0; index < mainRows.length; index++) {
      const row = document.createElement("div");
      row.className = `vk-row vk-row-${index}`;
      for (const key of mainRows[index]) {
        row.appendChild(key.spacer ? this._makeSpacer(document, key) : this._makeButton(document, key));
      }
      main.appendChild(row);
    }

    const functions = document.createElement("div");
    functions.className = "vk-function-column";
    functions.setAttribute("aria-label", "Function keys");
    for (const key of C64_VIRTUAL_KEYBOARD.functionKeys) {
      functions.appendChild(this._makeButton(document, key));
    }

    body.append(main, functions);
    const spaceRow = document.createElement("div");
    spaceRow.className = "vk-row vk-space-row";
    for (const key of C64_VIRTUAL_KEYBOARD.rows.at(-1)) {
      spaceRow.appendChild(key.spacer ? this._makeSpacer(document, key) : this._makeButton(document, key));
    }
    layout.append(body, spaceRow);
    this._element.replaceChildren(layout);
    this._updateButtons();

    if (this._details) {
      this._details.addEventListener("toggle", () => {
        if (!this._details.open) {
          this._input.releaseAll();
          this.reset();
        }
      });
    }
    if (this._summary) {
      this._summary.addEventListener("click", (event) => {
        if (!isPointerActivation(event)) return;
        setTimeout(() => this._focus({ preventScroll: true }), 0);
      });
    }
  }

  _makeSpacer(document, key) {
    const gap = document.createElement("span");
    gap.className = `vk-spacer${key.className ? ` ${key.className}` : ""}`;
    gap.setAttribute("aria-hidden", "true");
    return gap;
  }

  _makeButton(document, key) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vk-key${key.className ? ` ${key.className}` : ""}`;
    button.setAttribute("data-key-id", key.id);
    button.setAttribute("aria-label", key.ariaLabel);
    if (key.modifier || key.lock) button.setAttribute("aria-pressed", "false");

    if (key.shiftedLabel) {
      const shifted = document.createElement("span");
      shifted.className = "vk-shifted";
      shifted.textContent = key.shiftedLabel;
      const primary = document.createElement("span");
      primary.className = "vk-primary";
      primary.textContent = key.label;
      button.append(shifted, primary);
    } else {
      button.textContent = key.label;
    }

    button.addEventListener("click", (event) => this._activate(key, event));
    this._buttons.set(key.id, button);
    return button;
  }

  _activate(key, event) {
    if (key.lock) {
      if (this._locked.has(key.id)) {
        this._locked.delete(key.id);
        this._input.releaseVirtualKey(key.id);
      } else if (this._input.pressVirtualKey(key.id)) {
        this._locked.add(key.id);
      }
      this._updateButtons();
      this._restorePointerFocus(event);
      return;
    }

    if (key.modifier === "one-shot") {
      if (this._latched.has(key.id)) this._latched.delete(key.id);
      else this._latched.add(key.id);
      this._updateButtons();
      this._restorePointerFocus(event);
      return;
    }

    const chord = [...this._latched, key.id];
    this._latched.clear();
    this._updateButtons();
    this._pulse(chord);
    this._restorePointerFocus(event);
  }

  _pulse(ids) {
    const pressed = [];
    for (const id of ids) {
      if (!this._input.pressVirtualKey(id)) continue;
      pressed.push(id);
      this._setPressed(id, 1);
    }
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      for (const id of pressed) {
        this._input.releaseVirtualKey(id);
        this._setPressed(id, -1);
      }
    }, this._pulseMs);
    this._timers.set(timer, pressed);
  }

  _setPressed(id, delta) {
    const count = (this._pressedCounts.get(id) || 0) + delta;
    if (count > 0) this._pressedCounts.set(id, count);
    else this._pressedCounts.delete(id);
    this._buttons.get(id)?.classList.toggle("is-pressed", count > 0);
  }

  _updateButtons() {
    for (const [id, button] of this._buttons) {
      const active = this._latched.has(id) || this._locked.has(id);
      button.classList.toggle("is-latched", active);
      if (button.getAttribute("aria-pressed") !== null) {
        button.setAttribute("aria-pressed", String(active));
      }
    }
    this._element.classList.toggle(
      "vk-shift-active",
      this._latched.has("left-shift")
        || this._latched.has("right-shift")
        || this._locked.has("shift-lock"),
    );
  }

  _restorePointerFocus(event) {
    if (isPointerActivation(event)) this._focus({ preventScroll: true });
  }

  _focus(options) {
    if (this._focusTarget && typeof this._focusTarget.focus === "function") {
      this._focusTarget.focus(options);
    }
  }

  reset() {
    for (const [timer, ids] of this._timers) {
      clearTimeout(timer);
      for (const id of ids) this._input.releaseVirtualKey(id);
    }
    this._timers.clear();
    this._pressedCounts.clear();
    for (const button of this._buttons.values()) button.classList.remove("is-pressed");
    for (const id of this._locked) this._input.releaseVirtualKey(id);
    this._locked.clear();
    this._latched.clear();
    this._updateButtons();
  }
}
