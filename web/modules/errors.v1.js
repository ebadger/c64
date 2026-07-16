// Stable UI error categories for the web client. See specs/WEB-CLIENT.md "Error handling".
//
// Categories are a stable public contract: UI code keys off these exact strings. Every error
// path preserves the user's editable source; nothing here clears, mutates, or fabricates
// project content.

/** @typedef {"share"|"storage"|"build"|"rom"|"wasm"|"media"|"audio"|"input"} ErrorCategory */

/** The complete, ordered set of stable UI error categories. */
export const ERROR_CATEGORIES = Object.freeze([
  "share",
  "storage",
  "build",
  "rom",
  "wasm",
  "media",
  "audio",
  "input",
]);

const CATEGORY_SET = new Set(ERROR_CATEGORIES);

/** True when `category` is one of the stable UI error categories. */
export function isErrorCategory(category) {
  return CATEGORY_SET.has(category);
}

/**
 * An application error carrying a stable UI category plus a human-readable message. The
 * category — never the message — is the contract UI branches on.
 */
export class AppError extends Error {
  /**
   * @param {ErrorCategory} category
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(category, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.category = isErrorCategory(category) ? category : "build";
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Construct an AppError; convenience over `new AppError(...)`. */
export function appError(category, message, options) {
  return new AppError(category, message, options);
}
