import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKeyboardColumns,
  C64_VIRTUAL_KEYBOARD,
  C64_VIRTUAL_KEY_MAP,
} from "../../web/client/lib/keymap.js";
import { InputController, shouldHandlePhysicalEvent } from "../../web/client/lib/input.js";
import { VirtualKeyboard, isPointerActivation } from "../../web/client/lib/virtualKeyboard.js";

const layoutToken = (key) => {
  if (key.spacer) return "<gap>";
  return key.label;
};

test("virtual keyboard declares the original 66-key C64 physical layout", () => {
  assert.deepEqual(C64_VIRTUAL_KEYBOARD.rows.map((row) => row.map(layoutToken)), [
    ["←", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "+", "-", "£", "HOME", "DEL"],
    ["CTRL", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "@", "*", "↑", "RESTORE"],
    ["RUN/STOP", "SHIFT LOCK", "A", "S", "D", "F", "G", "H", "J", "K", "L", ":", ";", "=", "RETURN"],
    ["C=", "SHIFT", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "SHIFT", "↓", "→"],
    ["<gap>", "SPACE", "<gap>"],
  ]);
  assert.deepEqual(C64_VIRTUAL_KEYBOARD.functionKeys.map(layoutToken), ["F1", "F3", "F5", "F7"]);
  assert.deepEqual(
    C64_VIRTUAL_KEYBOARD.functionKeys.map((key) => key.shiftedLabel),
    ["F2", "F4", "F6", "F8"],
  );
  assert.equal(C64_VIRTUAL_KEY_MAP.size, 66);

  for (const key of C64_VIRTUAL_KEY_MAP.values()) {
    if (key.restore) continue;
    assert.equal(key.matrix.length, 1, `${key.id} has one physical matrix position`);
    const [column, row] = key.matrix[0];
    assert.ok(column >= 0 && column < 8, `${key.id} column is valid`);
    assert.ok(row >= 0 && row < 8, `${key.id} row is valid`);
  }
});

test("virtual keys merge into the same active-low columns as physical keys", () => {
  const columns = buildKeyboardColumns(
    new Set(["KeyA"]),
    new Set(["cursor-vertical", "shift-lock", "f1"]),
  );
  assert.equal(columns[0], 0xff & ~(1 << 7) & ~(1 << 4));
  assert.equal(columns[1], 0xff & ~(1 << 2) & ~(1 << 7));
  assert.deepEqual(
    [...buildKeyboardColumns(new Set(), new Set(["restore"]))],
    [255, 255, 255, 255, 255, 255, 255, 255],
  );
});

test("input controller reference-counts virtual matrix and RESTORE presses", () => {
  const input = new InputController({});

  assert.equal(input.pressVirtualKey("key-a"), true);
  assert.equal(input.pressVirtualKey("key-a"), true);
  assert.equal(input.snapshot().keyboardColumns[1], 0xff & ~(1 << 2));
  assert.equal(input.releaseVirtualKey("key-a"), true);
  assert.equal(input.snapshot().keyboardColumns[1], 0xff & ~(1 << 2));
  assert.equal(input.releaseVirtualKey("key-a"), true);
  assert.equal(input.snapshot().keyboardColumns[1], 0xff);

  input.pressVirtualKey("restore");
  input.pressVirtualKey("restore");
  assert.equal(input.snapshot().restorePressed, true);
  input.releaseVirtualKey("restore");
  assert.equal(input.snapshot().restorePressed, true);
  input.releaseVirtualKey("restore");
  assert.equal(input.snapshot().restorePressed, false);
  assert.equal(input.pressVirtualKey("not-a-c64-key"), false);
});

test("physical Shift+Tab remains browser focus navigation", () => {
  const base = { code: "Tab", metaKey: false, altKey: false, ctrlKey: false };
  assert.equal(shouldHandlePhysicalEvent({ ...base, shiftKey: true }), false);
  assert.equal(shouldHandlePhysicalEvent({ ...base, shiftKey: false }), true);
});

class FakeEventTarget {
  constructor() {
    this.listeners = {};
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((candidate) => candidate !== listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }
}

test("display blur keeps virtual latches only while focus stays in the input region", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const fakeWindow = new FakeEventTarget();
  const fakeDocument = new FakeEventTarget();
  const surface = new FakeEventTarget();
  const virtualButton = {};
  const outsideButton = {};
  let releasePhysicalCount = 0;
  let releaseAllCount = 0;
  const inputRegion = {
    contains(target) {
      return target === surface || target === virtualButton;
    },
  };

  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  try {
    const input = new InputController(surface, {
      inputRegion,
      onReleasePhysical() {
        releasePhysicalCount++;
      },
      onReleaseAll() {
        releaseAllCount++;
      },
    });
    input.attach();
    surface.dispatch("focus");
    fakeWindow.dispatch("keydown", {
      code: "KeyA",
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      preventDefault() {},
    });
    input.pressVirtualKey("shift-lock");

    fakeDocument.activeElement = virtualButton;
    surface.dispatch("blur", { relatedTarget: null });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(input.snapshot().keyboardColumns[1], 0xff & ~(1 << 7), "physical A released; SHIFT LOCK remains");
    assert.equal(releasePhysicalCount, 1);
    assert.equal(releaseAllCount, 0);

    surface.dispatch("focus");
    fakeDocument.activeElement = outsideButton;
    surface.dispatch("blur", { relatedTarget: null });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual([...input.snapshot().keyboardColumns], new Array(8).fill(255));
    assert.equal(releaseAllCount, 1);
    input.dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  toggle(name, force) {
    const on = force === undefined ? !this.names.has(name) : force;
    if (on) this.names.add(name);
    else this.names.delete(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.classList = new FakeClassList();
    this.listeners = {};
    this.attributes = {};
    this.open = false;
    this.textContent = "";
    this.type = "";
    this.className = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  replaceChildren(...children) {
    this.children = children.flatMap((child) => child.children || [child]);
  }

  activate(detail = 0) {
    this.dispatch("click", { detail });
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }
}

class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

test("virtual keyboard applies one-shot chords, SHIFT LOCK, RESTORE, and focus rules", async () => {
  const document = new FakeDocument();
  const root = new FakeElement(document);
  const details = new FakeElement(document);
  const summary = new FakeElement(document);
  const input = new InputController({});
  let focusCount = 0;
  const keyboard = new VirtualKeyboard(root, input, {
    details,
    summary,
    pulseMs: 5,
    focusTarget: {
      focus(options) {
        assert.deepEqual(options, { preventScroll: true });
        focusCount++;
      },
    },
  });
  keyboard.mount();

  const buttons = new Map(
    descendants(root)
      .filter((node) => node.getAttribute("data-key-id"))
      .map((node) => [node.getAttribute("data-key-id"), node]),
  );
  assert.equal(buttons.size, 66);

  buttons.get("left-shift").activate(1);
  assert.equal(buttons.get("left-shift").getAttribute("aria-pressed"), "true");
  assert.deepEqual([...input.snapshot().keyboardColumns], new Array(8).fill(255));

  buttons.get("key-a").activate(1);
  let snapshot = input.snapshot();
  assert.equal(snapshot.keyboardColumns[1], 0xff & ~(1 << 7) & ~(1 << 2));
  assert.equal(buttons.get("left-shift").getAttribute("aria-pressed"), "false");
  assert.equal(focusCount, 2);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual([...input.snapshot().keyboardColumns], new Array(8).fill(255));

  buttons.get("shift-lock").activate(0);
  assert.equal(buttons.get("shift-lock").getAttribute("aria-pressed"), "true");
  assert.equal(input.snapshot().keyboardColumns[1], 0xff & ~(1 << 7));
  buttons.get("key-a").activate(0);
  snapshot = input.snapshot();
  assert.equal(snapshot.keyboardColumns[1], 0xff & ~(1 << 7) & ~(1 << 2));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(input.snapshot().keyboardColumns[1], 0xff & ~(1 << 7));

  buttons.get("restore").activate(0);
  assert.equal(input.snapshot().restorePressed, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(input.snapshot().restorePressed, false);

  details.open = false;
  details.dispatch("toggle");
  assert.deepEqual([...input.snapshot().keyboardColumns], new Array(8).fill(255));
  assert.equal(buttons.get("shift-lock").getAttribute("aria-pressed"), "false");
  assert.equal(isPointerActivation({ detail: 1 }), true);
  assert.equal(isPointerActivation({ detail: 0 }), false);
});
