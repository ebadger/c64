import test from "node:test";
import assert from "node:assert/strict";

import { BuildRunIntent, isBuildAndRunShortcut } from "../../web/client/lib/buildActions.js";

test("Build & Run shortcut accepts only unmodified Ctrl/Cmd+Enter", () => {
  assert.equal(isBuildAndRunShortcut({ key: "Enter", ctrlKey: true }), true);
  assert.equal(isBuildAndRunShortcut({ key: "Enter", metaKey: true }), true);
  assert.equal(isBuildAndRunShortcut({ key: "Enter", ctrlKey: true, shiftKey: true }), false);
  assert.equal(isBuildAndRunShortcut({ key: "Enter", metaKey: true, altKey: true }), false);
  assert.equal(isBuildAndRunShortcut({ key: "Enter" }), false);
  assert.equal(isBuildAndRunShortcut({ key: "NumpadEnter", ctrlKey: true }), false);
});

test("Build & Run intent starts only its exact result and is consumed once", () => {
  const intent = new BuildRunIntent();
  intent.arm(7);
  assert.equal(intent.consume(6), false, "a superseded result cannot consume the current intent");
  assert.equal(intent.consume(7), true, "the requested build result may run");
  assert.equal(intent.consume(7), false, "a duplicate result cannot run twice");
});

test("a newer request or edit replaces or cancels pending Build & Run intent", () => {
  const intent = new BuildRunIntent();
  intent.arm(3);
  intent.arm(4);
  assert.equal(intent.consume(3), false);
  assert.equal(intent.consume(4), true);

  intent.arm(5);
  intent.cancel();
  assert.equal(intent.consume(5), false);
});
