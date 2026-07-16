// Canvas renderer: maps the core's indexed framebuffer through the declared palette into RGBA and
// paints it at the framebuffer resolution; CSS provides crisp, aspect-correct scaling
// (image-rendering: pixelated). Presentation only — never touches machine state (see
// specs/VIC-II.md, specs/WEB-CLIENT.md). Old completed frames are simply not drawn: the caller
// passes the latest frame each time.

import { indexedToRgba } from "./palette.js";

export class CanvasRenderer {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d", { alpha: false });
    this._width = 0;
    this._height = 0;
    this._image = null;
    this._lastSequence = -1;
  }

  _ensureSize(width, height) {
    if (width === this._width && height === this._height && this._image) return;
    this._width = width;
    this._height = height;
    this._canvas.width = width;
    this._canvas.height = height;
    // Preserve the framebuffer aspect; CSS keeps pixels crisp.
    this._canvas.style.aspectRatio = `${width} / ${height}`;
    this._image = this._ctx.createImageData(width, height);
  }

  /**
   * Draw a framebuffer. Returns true if it painted, false if the frame was a duplicate of the
   * last drawn sequence (so the caller can skip redundant work).
   * @param {{ width:number, height:number, sequence:number, pixels:Uint8Array }} frame
   */
  draw(frame) {
    if (!frame || !frame.pixels || frame.width <= 0 || frame.height <= 0) return false;
    if (frame.sequence === this._lastSequence) return false;
    this._ensureSize(frame.width, frame.height);
    indexedToRgba(frame.pixels, this._image.data);
    this._ctx.putImageData(this._image, 0, 0);
    this._lastSequence = frame.sequence;
    return true;
  }

  /** Paint a solid palette-indexed colour (e.g., black) to indicate stopped/blank state. */
  clear(colorIndex = 0) {
    if (!this._image) this._ensureSize(this._canvas.width || 384, this._canvas.height || 284);
    const filled = new Uint8Array(this._width * this._height).fill(colorIndex & 0x0f);
    indexedToRgba(filled, this._image.data);
    this._ctx.putImageData(this._image, 0, 0);
    this._lastSequence = -1;
  }
}
