import test from "node:test";
import assert from "node:assert/strict";

import { FullscreenController } from "../../web/client/lib/fullscreen.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

class FakeButton extends FakeEventTarget {
  constructor() {
    super();
    this.disabled = false;
    this.textContent = "";
    this.title = "";
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

function fullscreenFixture() {
  const document = new FakeEventTarget();
  const target = {};
  const button = new FakeButton();
  document.fullscreenEnabled = true;
  document.fullscreenElement = null;
  target.requestFullscreen = async () => {
    document.fullscreenElement = target;
    document.dispatch("fullscreenchange");
  };
  document.exitFullscreen = async () => {
    document.fullscreenElement = null;
    document.dispatch("fullscreenchange");
  };
  return { document, target, button };
}

test("fullscreen toggle tracks enter, browser exit, and explicit exit", async () => {
  const { document, target, button } = fullscreenFixture();
  const controller = new FullscreenController(target, button, { document });
  controller.mount();

  assert.equal(button.textContent, "Full screen");
  assert.equal(button.getAttribute("aria-pressed"), "false");

  assert.equal(await controller.toggle(), true);
  assert.equal(document.fullscreenElement, target);
  assert.equal(button.textContent, "Exit full screen");
  assert.equal(button.getAttribute("aria-pressed"), "true");

  document.fullscreenElement = null;
  document.dispatch("fullscreenchange");
  assert.equal(button.textContent, "Full screen");
  assert.equal(button.getAttribute("aria-pressed"), "false");

  document.fullscreenElement = target;
  document.dispatch("fullscreenchange");
  assert.equal(await controller.toggle(), true);
  assert.equal(document.fullscreenElement, null);
});

test("fullscreen toggle disables and labels unsupported browsers", () => {
  const document = new FakeEventTarget();
  const button = new FakeButton();
  document.fullscreenEnabled = false;
  const controller = new FullscreenController({}, button, { document });

  controller.mount();

  assert.equal(controller.supported, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Full screen unavailable");
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("fullscreen request rejection is surfaced and restores the control", async () => {
  const { document, target, button } = fullscreenFixture();
  const errors = [];
  target.requestFullscreen = async () => {
    throw new Error("permission denied");
  };
  const controller = new FullscreenController(target, button, {
    document,
    onError: (message) => errors.push(message),
  });
  controller.mount();

  assert.equal(await controller.toggle(), false);
  assert.deepEqual(errors, ["Could not enter full screen: permission denied"]);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Full screen");
  assert.equal(button.getAttribute("aria-pressed"), "false");
});
