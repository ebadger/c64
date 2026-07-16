// Application bootstrap: wires the DOM to the pipeline build worker, downloads, share/remix,
// autosave, gallery, and the emulator bridge. See specs/WEB-CLIENT.md. Source is treated
// strictly as data (textarea value + textContent only); nothing here uses innerHTML or eval.

import { DEFAULT_PROJECT } from "../../src/index.js";
import { detectCapabilities } from "./capabilities.v1.js";
import { BuildClient } from "./buildClient.v1.js";
import { renderDiagnostics } from "./diagnostics.v1.js";
import { encodeShareSource, decodeShareCode } from "./share.v1.js";
import {
  loadAutosave,
  saveAutosave,
  loadPreferences,
  savePreferences,
} from "./storage.v1.js";
import {
  loadGallery,
  findEntry,
  projectFromSource,
  projectFromGalleryEntry,
  assertSafeAssetPath,
} from "./gallery.v1.js";
import { downloadBytes } from "./download.v1.js";
import { createMachine, categoryForReason } from "./emulatorBridge.v1.js";
import { AppError, appError } from "./errors.v1.js";
import { parseAddress, formatAddress } from "./addresses.v1.js";
import { readEditorParams } from "./urlparams.v1.js";

const $ = (id) => document.getElementById(id);

// Resolution bases: gallery.json sits beside index.html (web/); gallery source paths are
// repository-relative to the served root (repo root), one level above web/.
const GALLERY_URL = new URL("../gallery.json", import.meta.url);
const SITE_ROOT = new URL("../../", import.meta.url);

const state = {
  storage: null,
  autosaveEnabled: false,
  autosaveTimer: 0,
  buildClient: null,
  galleryEntries: [],
  lastBundle: null, // { prg, prgName, d64, d64Name } of the latest successful build
  editRevision: 0, // bumped on every build-relevant edit; guards against stale artifacts
  hasBuilt: false,
};

// ---------------------------------------------------------------------------
// Status and error surfaces (never destroy editable source)
// ---------------------------------------------------------------------------

function setStatus(message, kind = "") {
  const el = $("global-status");
  el.textContent = message;
  el.className = `global-status${kind ? ` ${kind}` : ""}`;
}

function showError(err) {
  const category = err instanceof AppError ? err.category : "build";
  const message = err?.message ? String(err.message) : "Unexpected error.";
  setStatus(`[${category}] ${message}`, "error");
}

// ---------------------------------------------------------------------------
// Project <-> form mapping (address parsing/formatting live in addresses.v1.js)
// ---------------------------------------------------------------------------

/** Read the current project from the editor and settings form. */
function readProjectFromForm() {
  const loadAddr = parseAddress($("opt-loadAddress").value);
  const runAddr = parseAddress($("opt-runAddress").value);
  return {
    schema: 1,
    name: $("opt-name").value,
    source: $("source").value,
    target: "nmos-6510",
    // Pass NaN through as the raw string so the pipeline reports a clear invalid-project
    // diagnostic instead of the UI silently substituting a value.
    loadAddress: Number.isNaN(loadAddr) ? $("opt-loadAddress").value : loadAddr,
    runMode: $("opt-runMode").value,
    runAddress: Number.isNaN(runAddr) ? $("opt-runAddress").value : runAddr,
    timingProfile: $("opt-timingProfile").value,
    diskName: $("opt-diskName").value,
    diskId: $("opt-diskId").value,
    outputName: $("opt-outputName").value,
  };
}

/** Fill the editor and settings form from a project, applying documented defaults. */
function writeProjectToForm(project) {
  const p = { ...DEFAULT_PROJECT, ...project };
  $("source").value = p.source ?? "";
  $("opt-name").value = p.name ?? "";
  $("opt-outputName").value = p.outputName ?? "";
  $("opt-runMode").value = p.runMode ?? "basic-sys";
  $("opt-timingProfile").value = p.timingProfile ?? "pal-6569";
  $("opt-loadAddress").value = formatAddress(p.loadAddress ?? 0x0801);
  $("opt-runAddress").value = formatAddress(p.runAddress ?? 0x0801);
  $("opt-diskName").value = p.diskName ?? "";
  $("opt-diskId").value = p.diskId ?? "";
}

// ---------------------------------------------------------------------------
// Edit handling: autosave + artifact invalidation
// ---------------------------------------------------------------------------

function scheduleAutosave() {
  if (!state.autosaveEnabled || !state.storage) return;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    try {
      saveAutosave(state.storage, readProjectFromForm());
    } catch (err) {
      state.autosaveEnabled = false; // Disable on quota/permission failure and warn once.
      showError(err);
    }
  }, 400);
}

/**
 * Handle any build-relevant edit: bump the edit revision, invalidate stale artifacts so the
 * user cannot download bytes that no longer match the editor, and schedule autosave.
 */
function onEditorChange() {
  state.editRevision += 1;
  if (state.lastBundle || state.hasBuilt) {
    markArtifactsStale();
    $("build-status").textContent = "Stale — Build to refresh";
    $("build-id").textContent = "—";
    $("build-load").textContent = "—";
    $("build-run").textContent = "—";
  }
  scheduleAutosave();
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function markArtifactsStale() {
  state.lastBundle = null;
  $("btn-download-prg").disabled = true;
  $("btn-download-d64").disabled = true;
}

async function doBuild() {
  const project = readProjectFromForm();
  const builtRevision = state.editRevision;
  setStatus("Building…");
  $("btn-build").disabled = true;
  try {
    const outcome = await state.buildClient.build(project);
    // If the editor changed while the build ran, the result is stale: show diagnostics but do
    // not offer downloads that no longer match the current source.
    if (state.editRevision !== builtRevision) {
      renderDiagnostics($("diagnostics"), outcome.diagnostics);
      markArtifactsStale();
      $("build-status").textContent = "Stale — Build to refresh";
      setStatus("Source changed during build — Build again to refresh artifacts.", "");
      return;
    }
    state.hasBuilt = true;
    renderDiagnostics($("diagnostics"), outcome.diagnostics);
    if (outcome.ok) {
      state.lastBundle = {
        prg: outcome.prg,
        prgName: outcome.prgName,
        d64: outcome.d64,
        d64Name: outcome.d64Name,
      };
      $("btn-download-prg").disabled = false;
      $("btn-download-d64").disabled = false;
      $("build-status").textContent = "Succeeded";
      $("build-id").textContent = outcome.buildId;
      $("build-load").textContent = formatAddress(outcome.loadAddress);
      $("build-run").textContent = formatAddress(outcome.runAddress);
      setStatus("Build succeeded.", "ok");
    } else {
      markArtifactsStale();
      $("build-status").textContent = outcome.internal ? "Internal error" : "Failed";
      $("build-id").textContent = "—";
      $("build-load").textContent = "—";
      $("build-run").textContent = "—";
      if (outcome.internal) {
        setStatus(`[build] ${outcome.message}`, "error");
      } else if (outcome.error) {
        setStatus(`[media] ${outcome.error.code}: ${outcome.error.message}`, "error");
      } else {
        setStatus("Build failed — see diagnostics.", "error");
      }
    }
  } catch (err) {
    markArtifactsStale();
    showError(err instanceof AppError ? err : appError("build", "Build failed to run.", { cause: err }));
  } finally {
    $("btn-build").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function downloadArtifact(kind) {
  const bundle = state.lastBundle;
  if (!bundle) return;
  try {
    if (kind === "prg") downloadBytes(bundle.prg, bundle.prgName);
    else downloadBytes(bundle.d64, bundle.d64Name);
  } catch (err) {
    showError(appError("media", "Download failed.", { cause: err }));
  }
}

// ---------------------------------------------------------------------------
// Share / remix
// ---------------------------------------------------------------------------

function openSharePanel() {
  try {
    const code = encodeShareSource($("source").value);
    const url = `${location.origin}${location.pathname}?code=${code}`;
    $("share-url").value = url;
    $("share-panel").hidden = false;
    $("share-url").focus();
    $("share-url").select();
    setStatus("Review the share warning before copying.", "");
  } catch (err) {
    showError(err instanceof AppError ? err : appError("share", "Could not build a share link.", { cause: err }));
  }
}

async function copyShareUrl() {
  const url = $("share-url").value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      setStatus("Share link copied.", "ok");
    } else {
      $("share-url").focus();
      $("share-url").select();
      setStatus("Copy the selected link manually (clipboard unavailable).", "");
    }
  } catch (err) {
    showError(appError("share", "Could not copy the link; copy it manually.", { cause: err }));
  }
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

async function fetchText(url) {
  let response;
  try {
    response = await fetch(String(url));
  } catch (cause) {
    throw appError("media", "Could not fetch gallery source.", { cause });
  }
  if (!response.ok) {
    throw appError("media", `Gallery source request failed (${response.status}).`);
  }
  return response.text();
}

async function initGallery() {
  const select = $("gallery-select");
  try {
    state.galleryEntries = await loadGallery(fetch, GALLERY_URL);
    select.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an example…";
    select.appendChild(placeholder);
    for (const entry of state.galleryEntries) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.title;
      select.appendChild(option);
    }
  } catch (err) {
    select.textContent = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Gallery unavailable";
    select.appendChild(option);
    showError(err);
  }
}

/** Resolve a gallery entry id into a project by fetching its source. */
async function projectForGalleryId(id) {
  const entry = findEntry(state.galleryEntries, id);
  assertSafeAssetPath(entry.sourcePath, "sourcePath");
  const source = await fetchText(new URL(entry.sourcePath, SITE_ROOT));
  return projectFromGalleryEntry(entry, source);
}

async function loadSelectedGalleryEntry() {
  const id = $("gallery-select").value;
  if (!id) return;
  try {
    const project = await projectForGalleryId(id);
    writeProjectToForm(project);
    state.editRevision += 1; // Loading a new project invalidates any in-flight build.
    state.hasBuilt = false;
    markArtifactsStale();
    $("build-status").textContent = "Not built";
    $("build-id").textContent = "—";
    $("build-load").textContent = "—";
    $("build-run").textContent = "—";
    renderDiagnostics($("diagnostics"), []);
    scheduleAutosave();
    setStatus(`Loaded example '${id}'. This is a remix — edit and Build freely.`, "ok");
  } catch (err) {
    showError(err);
  }
}

// ---------------------------------------------------------------------------
// Emulator (explicit unavailable state until the WASM core + ROM set land)
// ---------------------------------------------------------------------------

function drawEmulatorPlaceholder(lines) {
  const canvas = $("screen");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#9aa1b5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = canvas.width / 2;
  let y = canvas.height / 2 - (lines.length - 1) * 12;
  for (let i = 0; i < lines.length; i += 1) {
    ctx.font = i === 0 ? "bold 18px monospace" : "12px monospace";
    ctx.fillText(lines[i], cx, y);
    y += 24;
  }
}

async function initEmulator() {
  // No core factory is provided: the production c64core.wasm does not exist yet, so the bridge
  // resolves to an explicit unavailable result. We never fabricate a framebuffer.
  const result = await createMachine({ timingProfile: $("opt-timingProfile").value });
  $("btn-run").disabled = true;
  $("btn-reset").disabled = true;
  if (!result.available) {
    drawEmulatorPlaceholder(["EMULATOR UNAVAILABLE", result.message]);
    $("emulator-status").textContent = `Emulator unavailable — ${result.message}`;
    const category = categoryForReason(result.reason);
    $("rom-status").textContent =
      category === "rom" ? "ROM set: none installed." : "ROM set: not applicable until the core loads.";
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function showUnsupported(missing) {
  $("unsupported-detail").textContent = `Missing required capabilities: ${missing.join(", ")}.`;
  $("unsupported").hidden = false;
  $("app").setAttribute("aria-hidden", "true");
}

function wireEvents() {
  $("btn-build").addEventListener("click", doBuild);
  $("btn-download-prg").addEventListener("click", () => downloadArtifact("prg"));
  $("btn-download-d64").addEventListener("click", () => downloadArtifact("d64"));
  $("btn-share").addEventListener("click", openSharePanel);
  $("btn-share-copy").addEventListener("click", copyShareUrl);
  $("btn-share-close").addEventListener("click", () => {
    $("share-panel").hidden = true;
  });
  $("btn-gallery-load").addEventListener("click", loadSelectedGalleryEntry);

  const inputs = [
    "source", "opt-name", "opt-outputName", "opt-runMode", "opt-timingProfile",
    "opt-loadAddress", "opt-runAddress", "opt-diskName", "opt-diskId",
  ];
  for (const id of inputs) {
    $(id).addEventListener("input", onEditorChange);
  }
  $("opt-timingProfile").addEventListener("change", () => {
    if (state.autosaveEnabled && state.storage) {
      try {
        savePreferences(state.storage, { timingProfile: $("opt-timingProfile").value });
      } catch {
        /* preferences are best-effort */
      }
    }
  });
}

async function chooseInitialProject(caps) {
  let params;
  try {
    params = readEditorParams(location.search);
  } catch (err) {
    // Duplicate ?code/?src: visible error, start from defaults rather than guessing.
    showError(err);
    return { ...DEFAULT_PROJECT };
  }
  const hasCode = params.code !== null;
  const hasSrc = params.src !== null;
  let project = null;

  // `code` takes precedence over `src`. A provided-but-invalid URL parameter surfaces a visible
  // error and does not silently fall back to another project.
  try {
    if (hasCode) {
      project = projectFromSource(decodeShareCode(params.code));
    } else if (hasSrc) {
      project = await projectForGalleryId(params.src);
    }
  } catch (err) {
    showError(err);
    return { ...DEFAULT_PROJECT };
  }

  if (!project && !hasCode && !hasSrc && caps.features.localStorage && state.storage) {
    const saved = loadAutosave(state.storage);
    if (saved) {
      project = saved;
      setStatus("Restored your autosaved source.", "");
    }
  }
  return project ?? { ...DEFAULT_PROJECT };
}

async function boot() {
  const caps = detectCapabilities();
  if (!caps.supported) {
    showUnsupported(caps.missing);
    return;
  }

  if (caps.features.localStorage) {
    state.storage = window.localStorage;
    state.autosaveEnabled = true;
  } else {
    // Storage blocked or full at startup: continue, but warn that autosave is off so the user
    // does not assume their edits are being saved (specs/WEB-CLIENT.md error handling).
    setStatus("[storage] Autosave is off — local storage is blocked or full. Your edits will not be saved.", "error");
  }
  state.buildClient = new BuildClient({ useWorker: caps.features.workers });

  wireEvents();

  // Gallery must be loaded before a ?src parameter can resolve.
  await initGallery();

  // Apply a stored timing preference as a soft default before the project loads.
  if (state.storage) {
    const prefs = loadPreferences(state.storage);
    if (prefs.timingProfile === "pal-6569" || prefs.timingProfile === "ntsc-6567r8") {
      $("opt-timingProfile").value = prefs.timingProfile;
    }
  }

  const project = await chooseInitialProject(caps);
  writeProjectToForm(project);
  renderDiagnostics($("diagnostics"), []);

  await initEmulator();

  if (!$("global-status").textContent) {
    setStatus("Ready. Edit source and press Build.", "");
  }
}

boot().catch((err) => {
  showError(err instanceof AppError ? err : appError("build", "The IDE failed to start.", { cause: err }));
});
