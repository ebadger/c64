import { test } from "node:test";
import assert from "node:assert/strict";
import { readEditorParams } from "../web/modules/urlparams.v1.js";

test("returns single code/src values and null when absent", () => {
  assert.deepEqual(readEditorParams(""), { code: null, src: null });
  assert.deepEqual(readEditorParams("?code=YQ"), { code: "YQ", src: null });
  assert.deepEqual(readEditorParams("?src=border-flash"), { code: null, src: "border-flash" });
});

test("both code and src may be present (precedence is resolved by the caller)", () => {
  assert.deepEqual(readEditorParams("?code=YQ&src=border-flash"), { code: "YQ", src: "border-flash" });
});

test("duplicate code is a share-category error", () => {
  assert.throws(() => readEditorParams("?code=YQ&code=Yg"), (e) => e.category === "share");
});

test("duplicate src is a media-category error", () => {
  assert.throws(() => readEditorParams("?src=a&src=b"), (e) => e.category === "media");
});
