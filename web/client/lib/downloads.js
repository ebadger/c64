// Client-side downloads (browser). Creates a Blob for exact bytes, clicks a sanitized filename,
// and revokes the object URL after use. No server round-trip and no metadata is prepended to the
// artifact bytes (see specs/MEDIA.md, specs/WEB-CLIENT.md).

import { downloadFilename, sourceFilename } from "./downloadsCore.js";

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the click has been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Download an artifact byte stream (PRG or D64) with an exact-bytes Blob. */
export function downloadBytes(bytes, outputName, ext) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  triggerDownload(blob, downloadFilename(outputName, ext));
}

/** Download the source as a `.asm` text file (share fallback for oversized programs). */
export function downloadSource(source, name) {
  const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, sourceFilename(name));
}
