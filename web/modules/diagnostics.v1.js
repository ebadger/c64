// Diagnostics rendering. See specs/CODEGEN.md for the stable Diagnostic shape. Source text is
// treated strictly as data: diagnostics are written with textContent only, never innerHTML.

/**
 * Format one diagnostic as a single stable line. Pure and testable.
 * @param {{severity:string, code:string, message:string, line:number, column:number}} d
 * @returns {string}
 */
export function formatDiagnostic(d) {
  return `${d.severity} [${d.code}] line ${d.line}, col ${d.column}: ${d.message}`;
}

/**
 * Render diagnostics into a container using textContent only.
 * @param {HTMLElement} container
 * @param {readonly object[]} diagnostics
 * @param {Document} [doc]
 */
export function renderDiagnostics(container, diagnostics, doc = document) {
  container.textContent = "";
  const items = Array.isArray(diagnostics) ? diagnostics : [];
  if (items.length === 0) {
    const ok = doc.createElement("p");
    ok.className = "diag-empty";
    ok.textContent = "No diagnostics.";
    container.appendChild(ok);
    return;
  }
  const list = doc.createElement("ul");
  list.className = "diag-list";
  for (const d of items) {
    const li = doc.createElement("li");
    li.className = `diag diag-${d.severity === "warning" ? "warning" : "error"}`;
    li.textContent = formatDiagnostic(d);
    list.appendChild(li);
  }
  container.appendChild(list);
}
