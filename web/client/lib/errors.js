// Stable UI error surface. Errors carry one of the fixed categories (see specs/WEB-CLIENT.md) so
// the UI can render explicit, categorized states and never a fabricated success. This is a tiny
// pub/sub bus; the browser client renders subscribed messages into the status/error region.

import { ERROR_CATEGORIES } from "./config.js";

const CATEGORY_SET = new Set(ERROR_CATEGORIES);

/** Construct a categorized UI error/notice record. */
export function uiError(category, code, message, severity = "error") {
  if (!CATEGORY_SET.has(category)) category = "capability";
  return { category, code, message: String(message), severity };
}

/** A minimal listener bus for UI errors/notices. */
export class ErrorBus {
  constructor() {
    this._listeners = new Set();
    this._items = [];
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Publish one categorized item and notify listeners. */
  publish(item) {
    this._items.push(item);
    for (const fn of this._listeners) fn(item, this._items);
  }

  error(category, code, message) {
    this.publish(uiError(category, code, message, "error"));
  }

  notice(category, code, message) {
    this.publish(uiError(category, code, message, "notice"));
  }

  clear() {
    this._items = [];
    for (const fn of this._listeners) fn(null, this._items);
  }

  items() {
    return [...this._items];
  }
}
