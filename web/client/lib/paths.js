// Path-safety validation for repository-relative, same-origin static asset references used by
// the gallery and `?d64` routes. Environment-free. See specs/WEB-CLIENT.md.
//
// A safe path is a plain repository-relative POSIX path with no way to escape the static root or
// reach another origin: no `..` segment, no leading slash, no backslash, no scheme (`:`), no
// protocol-relative `//`, and no `%` escape (which could smuggle an encoded traversal past a
// naive check). It must be non-empty and consist of conservative characters.

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * @param {unknown} path
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function validateRepoRelativePath(path) {
  if (typeof path !== "string" || path.length === 0) return { ok: false, reason: "empty" };
  if (path.includes("\\")) return { ok: false, reason: "backslash" };
  if (path.includes(":")) return { ok: false, reason: "scheme-or-colon" };
  if (path.includes("%")) return { ok: false, reason: "percent-escape" };
  if (path.startsWith("/")) return { ok: false, reason: "leading-slash" };
  if (path.includes("//")) return { ok: false, reason: "double-slash" };
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return { ok: false, reason: "bad-segment" };
    if (!SAFE_SEGMENT.test(seg)) return { ok: false, reason: "invalid-character" };
  }
  return { ok: true, path };
}

/**
 * Resolve a validated repo-relative path against the static base URL and confirm the result
 * stays same-origin and within the base directory (defense in depth beyond the string checks).
 * @param {string} path already validated by validateRepoRelativePath
 * @param {URL} baseUrl repository-root static base (ends in '/')
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function resolveWithinBase(path, baseUrl) {
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin) return { ok: false, reason: "cross-origin" };
  if (!url.pathname.startsWith(baseUrl.pathname)) return { ok: false, reason: "escapes-base" };
  return { ok: true, url };
}
