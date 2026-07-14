// Diagnostic construction and deterministic ordering.
//
// Diagnostic codes are stable public contracts (see specs/CODEGEN.md and specs/MEDIA.md).
// Positions are 1-based line and column; `length` is the span in source characters.

/**
 * @param {"error"|"warning"} severity
 * @param {string} code
 * @param {string} message
 * @param {number} line
 * @param {number} column
 * @param {number} length
 */
export function makeDiagnostic(severity, code, message, line, column, length) {
  return { severity, code, message, line, column, length };
}

/** Convenience helper for an error diagnostic. */
export function error(code, message, line = 1, column = 1, length = 0) {
  return makeDiagnostic("error", code, message, line, column, length);
}

/**
 * Return a new array of diagnostics sorted by source position, then by stable code. The
 * order is independent of the order in which diagnostics were discovered or of map/object
 * iteration order, so identical source always yields an identical diagnostic sequence.
 * @param {readonly object[]} diagnostics
 */
export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
}
