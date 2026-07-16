// Address parsing/formatting for the settings form. Pure and Node-testable so the strict
// validation is covered by tests. See specs/CODEGEN.md (loadAddress/runAddress are uint16).
//
// Parsing is strict: the ENTIRE string must be a well-formed "$hhhh" hex or decimal value in
// 0..65535. A partially valid string (e.g. "$C00O") is rejected rather than silently truncated,
// so the pipeline never receives a fabricated address.

/**
 * Parse "$hhhh" (hex) or a plain decimal into a uint16, or NaN when the whole string is not a
 * valid in-range address.
 * @param {string} text
 * @returns {number}
 */
export function parseAddress(text) {
  const t = String(text).trim();
  if (t === "") return NaN;
  let value;
  if (t.startsWith("$")) {
    const hex = t.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return NaN;
    value = parseInt(hex, 16);
  } else if (/^[0-9]+$/.test(t)) {
    value = parseInt(t, 10);
  } else {
    return NaN;
  }
  return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : NaN;
}

/**
 * Format a uint16 as "$hhhh". Non-numeric or non-finite input is returned verbatim (as a
 * string) so a blank or invalid field round-trips the user's exact text instead of being
 * coerced to "$0000".
 * @param {number|string} n
 * @returns {string}
 */
export function formatAddress(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return n === undefined || n === null ? "" : String(n);
  }
  return `$${n.toString(16).padStart(4, "0")}`;
}
