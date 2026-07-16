// Tiny DOM helpers. Text is always assigned via textContent (never innerHTML), so no source- or
// URL-derived data can become markup (see specs/WEB-CLIENT.md "Source is treated as data").

/** Get an element by id or throw (fail fast on a wiring bug). */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Set text content safely. */
export function setText(el, text) {
  el.textContent = text == null ? "" : String(text);
}

/** Toggle a `hidden` attribute. */
export function setHidden(el, hidden) {
  if (hidden) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
}

/** Enable/disable a control and reflect it in aria-disabled. */
export function setEnabled(el, enabled) {
  el.disabled = !enabled;
  el.setAttribute("aria-disabled", enabled ? "false" : "true");
}

/** Add an event listener and return a disposer. */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** Create an element with text content and optional attributes. */
export function makeEl(tag, { text, className, attrs } = {}) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = String(text);
  if (className) el.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Replace all children of `el` with the provided nodes. */
export function replaceChildren(el, ...nodes) {
  el.replaceChildren(...nodes);
}
