// Safe textual rendering of structured diagnostics. Environment-free. The UI renders the returned
// strings with textContent only (never innerHTML), so source-derived text in a message can never
// become markup. This module additionally normalizes control characters for a clean text panel.

/** Replace C0/C1 control characters (except none — all) with a visible placeholder. */
function sanitizeText(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, "\uFFFD");
}

/**
 * Format one diagnostic as `line:col: severity code: message`.
 * @param {{severity:string, code:string, message:string, line:number, column:number}} d
 */
export function formatDiagnostic(d) {
  const line = Number.isInteger(d.line) ? d.line : 1;
  const column = Number.isInteger(d.column) ? d.column : 1;
  const severity = d.severity === "warning" ? "warning" : "error";
  return `${line}:${column}: ${severity} ${sanitizeText(d.code)}: ${sanitizeText(d.message)}`;
}

/**
 * Build a text view of a diagnostics list plus a one-line summary.
 * @param {readonly object[]} diagnostics
 * @returns {{ summary: string, lines: string[], errorCount: number, warningCount: number }}
 */
export function renderDiagnostics(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  let errorCount = 0;
  let warningCount = 0;
  const lines = [];
  for (const d of list) {
    if (d && d.severity === "warning") warningCount++;
    else errorCount++;
    lines.push(formatDiagnostic(d ?? {}));
  }
  let summary;
  if (list.length === 0) summary = "No diagnostics.";
  else summary = `${errorCount} error${errorCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"}.`;
  return { summary, lines, errorCount, warningCount };
}
