import test from "node:test";
import assert from "node:assert/strict";

import { isCurrentCuratedMediaRequest } from "../../web/client/lib/galleryActions.js";

test("curated media applies only while both its disk and gallery selections are current", () => {
  const current = { mediaGeneration: 8, galleryGeneration: 5 };
  assert.equal(
    isCurrentCuratedMediaRequest(
      { mediaGeneration: 8, galleryGeneration: 5 },
      current,
    ),
    true,
  );
  assert.equal(
    isCurrentCuratedMediaRequest(
      { mediaGeneration: 8, galleryGeneration: 4 },
      current,
    ),
    false,
    "a newer source selection invalidates an older sample disk",
  );
  assert.equal(
    isCurrentCuratedMediaRequest(
      { mediaGeneration: 7, galleryGeneration: 5 },
      current,
    ),
    false,
    "a newer explicit disk action wins",
  );
});

test("an independent ?d64 request is gated only by the disk generation", () => {
  assert.equal(
    isCurrentCuratedMediaRequest(
      { mediaGeneration: 3, galleryGeneration: null },
      { mediaGeneration: 3, galleryGeneration: 99 },
    ),
    true,
  );
});
