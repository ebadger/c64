// Client-side artifact download. See specs/WEB-CLIENT.md. Bytes are exactly the assembler
// output; the client prepends no metadata. A fresh Blob URL is created, clicked with a
// sanitized filename, and revoked after use.

/**
 * Trigger a browser download of raw bytes under `filename`.
 * @param {Uint8Array} bytes
 * @param {string} filename  already sanitized (use the pipeline's downloadFilename)
 * @param {Document} [doc]
 * @param {typeof URL} [urlApi]
 */
export function downloadBytes(bytes, filename, doc = document, urlApi = URL) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = urlApi.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick: some browsers cancel an in-flight download if the object URL is
  // revoked synchronously in the same frame as the click.
  setTimeout(() => urlApi.revokeObjectURL(url), 0);
}
