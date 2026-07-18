import test from "node:test";
import assert from "node:assert/strict";

import {
  C64_PRESENTATION_SIZE,
  CanvasRenderer,
} from "../../web/client/lib/video.js";

function fakeCanvas() {
  const created = [];
  const painted = [];
  const context = {
    createImageData(width, height) {
      const image = {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
      created.push(image);
      return image;
    },
    putImageData(image, x, y) {
      painted.push({ image, x, y });
    },
  };
  return {
    canvas: {
      width: 384,
      height: 235,
      style: {},
      getContext: () => context,
    },
    created,
    painted,
  };
}

test("PAL and NTSC frames keep one viewport while using their native backing sizes", () => {
  const { canvas, created, painted } = fakeCanvas();
  const renderer = new CanvasRenderer(canvas);
  const aspect = `${C64_PRESENTATION_SIZE.width} / ${C64_PRESENTATION_SIZE.height}`;

  assert.equal(canvas.style.aspectRatio, aspect);
  assert.equal(renderer.draw({
    width: 384,
    height: 284,
    sequence: 7,
    pixels: new Uint8Array(384 * 284),
  }), true);
  assert.equal(canvas.width, 384);
  assert.equal(canvas.height, 284);

  assert.equal(renderer.draw({
    width: 384,
    height: 235,
    sequence: 7,
    pixels: new Uint8Array(384 * 235),
  }), true, "a reconfigured machine may restart at the same frame sequence");
  assert.equal(canvas.width, 384);
  assert.equal(canvas.height, 235);
  assert.equal(canvas.style.aspectRatio, aspect);
  assert.equal(created.length, 2);
  assert.equal(painted.length, 2);
});
