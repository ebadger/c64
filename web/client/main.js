// c64 browser IDE orchestrator. Wires the editor, build worker, WASM machine, presentation,
// input, ROM/media handling, URL/state contracts, autosave, gallery, downloads, and share into
// one static, serverless app. Nothing is uploaded; source is data, never evaluated. See
// specs/WEB-CLIENT.md and the layer specs it references.

import { byId, setText, setHidden, setEnabled, makeEl, replaceChildren } from "./lib/dom.js";
import { detectCapabilities } from "./lib/capabilities.js";
import { ErrorBus } from "./lib/errors.js";
import { BUNDLED_ROM_MANIFEST_PATH, WASM_LOADER_PATH } from "./lib/config.js";
import { makeProject, projectFromGalleryEntry, validateProject, canonicalProjectJson } from "./lib/projectModel.js";
import { renderDiagnostics } from "./lib/diagnosticsView.js";
import { resolveUrlState } from "./lib/urlContract.js";
import { BuildClient, createBuildWorker } from "./lib/buildClient.js";
import { BuildRunIntent, isBuildAndRunShortcut } from "./lib/buildActions.js";
import { MachineController } from "./lib/machine.js";
import { CanvasRenderer } from "./lib/video.js";
import { AudioPlayer } from "./lib/audio.js";
import { InputController } from "./lib/input.js";
import { Pacer } from "./lib/pacing.js";
import { Storage } from "./lib/storage.js";
import { RomManager } from "./lib/roms.js";
import { loadBundledRomSet } from "./lib/bundledRoms.js";
import { loadGallery, fetchSource, fetchCuratedD64 } from "./lib/gallery.js";
import { downloadBytes, downloadSource } from "./lib/downloads.js";
import { computeShare, copyToClipboard } from "./lib/share.js";
import { ROM_ROLES } from "./lib/romValidate.js";
import { KEY_HELP } from "./lib/keymap.js";
import {
  directoryEntryLabel,
  formatEntryAddress,
  isPrgEntry,
  parseEntryAddress,
  petsciiToDisplay,
} from "./lib/diskControls.js";
import { detectBasicSysRunAddress, extractPrg, parseD64 } from "../../src/index.js";

const repoBase = new URL("../../", import.meta.url); // repository root static base
const clientBase = new URL("./", import.meta.url); // web/client/
const appBaseUrl = location.origin + location.pathname; // for share links (no query/hash)

const errorBus = new ErrorBus();
const romManager = new RomManager();
const audio = new AudioPlayer();
const buildRunIntent = new BuildRunIntent();

const state = {
  project: makeProject(),
  lastBuild: null, // { ok, buildId, prg, d64, prgName, d64Name, runAddress, loadAddress }
  activeSession: null, // { kind:"basic",label } or { kind:"program",prg,runAddress,label }
  artifactsStale: false,
  pendingD64: null, // { bytes, label, metadata, selectedPrg }
  galleryById: new Map(),
  romSource: "bundled",
  romLoading: false,
};

let els = {};
let buildClient = null;
let machine = null; // MachineController (lazy)
let renderer = null;
let input = null;
let pacer = null;
let machineLoadPromise = null;
let pendingEdit = false; // an edit happened since the last build() request -> results are stale
let lastPersistedCanonical = null; // canonical JSON of the last project we saved or loaded
let appInitialized = false; // true once init() (incl. decideInitialProject) has fully completed
let romLoadGeneration = 0;
let d64SelectionGeneration = 0;
let gallerySelectionGeneration = 0;
const romFileReadGenerations = new Map(ROM_ROLES.map((role) => [role, 0]));

// ---------------------------------------------------------------------------------------------
// Startup

async function init() {
  const caps = detectCapabilities();
  if (!caps.ok) {
    showCapabilityError(caps.missing);
    return;
  }
  cacheElements();
  errorBus.subscribe(renderErrors);
  renderKeyHelp();
  wireStorage();
  wireEditor();
  wireBuild();
  wireMachineControls();
  wireRoms();
  wireMedia();
  wireArtifacts();
  wireShare();
  wireGallery();

  // Optional-capability degradation: the emulator runs without these, but the feature is disabled
  // and honestly labelled rather than silently broken (see specs/WEB-CLIENT.md).
  applyOptionalCapabilities(caps.optional);

  // Restore preferences, then decide the initial project from URL, autosave, or default.
  applyPreferences(storage.loadPreferences());
  const romLoad = selectRomSource("bundled");
  await loadGalleryList();
  await decideInitialProject();
  await romLoad;

  setText(els.statusLine, romManager.ready() ? "Ready. Bundled Pascual ROMs loaded." : "Ready. Choose custom ROM files to enable machine controls.");
  appInitialized = true; // decideInitialProject has run; the editor will not be overwritten
}

// Web Audio is optional. When it is unavailable (e.g. some headless browsers), keep the emulator
// fully functional but disable the audio control and label it, instead of blocking startup.
let audioAvailable = true;
function applyOptionalCapabilities(optional) {
  if (Array.isArray(optional) && optional.includes("Web Audio")) {
    audioAvailable = false;
    setEnabled(els.btnAudio, false);
    setText(els.audioStatus, "Audio unavailable in this browser");
  }
}

function showCapabilityError(missing) {
  const box = document.getElementById("capability-error");
  const list = document.getElementById("capability-list");
  if (list) replaceChildren(list, ...missing.map((m) => makeEl("li", { text: m })));
  if (box) setHidden(box, false);
  const status = document.getElementById("status-line");
  if (status) setText(status, "This browser cannot run the emulator.");
}

function cacheElements() {
  const ids = [
    "statusLine:status-line", "errorList:error-list",
    "projectName:project-name", "editor", "btnBuildRun:btn-build-run", "btnBuild:btn-build",
    "btnRun:btn-run", "btnBootBasic:btn-boot-basic",
    "btnStop:btn-stop", "btnReset:btn-reset", "diagSummary:diagnostics-summary",
    "diagList:diagnostics-list", "screen", "screenSurface:screen-surface", "runStatus:run-status",
    "selTiming:sel-timing", "selSid:sel-sid", "selJoyport:sel-joyport", "chkGamepad:chk-gamepad",
    "btnAudio:btn-audio", "audioStatus:audio-status", "vol", "selRomSource:sel-rom-source",
    "romStatus:rom-status", "romLegal:rom-legal", "romProvenanceLink:rom-provenance-link",
    "romLicenseLink:rom-license-link", "romBasicLicenseLink:rom-basic-license-link",
    "romLgplLink:rom-lgpl-link", "romGplLink:rom-gpl-link",
    "romChargenNoticeLink:rom-chargen-notice-link",
    "romSourceLink:rom-source-link", "romCustom:rom-custom", "romRoles:rom-roles",
    "d64File:d64-file", "d64Status:d64-status", "d64Controls:d64-controls",
    "d64Program:d64-program", "d64Entry:d64-entry", "d64EntryStatus:d64-entry-status",
    "btnRunD64:btn-run-d64", "btnEjectD64:btn-eject-d64",
    "artifactStatus:artifact-status", "buildId:build-id", "btnDlPrg:btn-dl-prg",
    "btnDlD64:btn-dl-d64", "btnDlSrc:btn-dl-src", "btnShare:btn-share", "sharePanel:share-panel",
    "shareWarning:share-warning", "shareUrl:share-url", "btnShareCopy:btn-share-copy",
    "btnShareClose:btn-share-close", "gallerySelect:gallery-select",
    "galleryList:gallery-list", "keyHelpBody:key-help-body",
  ];
  els = {};
  for (const spec of ids) {
    const [key, id] = spec.includes(":") ? spec.split(":") : [spec, spec];
    els[key] = byId(id);
  }
}

// ---------------------------------------------------------------------------------------------
// Preferences + storage

const storage = new Storage({
  onExternalProject: (project) => {
    // A newer autosave from another tab. Only adopt it when THIS tab has no diverging unsaved
    // edits, so a concurrent save cannot destroy local work.
    const currentCanonical = canonicalProjectJson(syncProjectFromUI());
    if (lastPersistedCanonical !== null && currentCanonical !== lastPersistedCanonical) {
      errorBus.notice("storage", "external-diverged", "Another tab saved a different version. Kept your local edits — reload to adopt the other version.");
      return;
    }
    loadProjectIntoUI(project, "autosave");
    errorBus.notice("storage", "external", "Loaded a newer autosave from another tab.");
  },
  onExternalPreferences: (prefs) => applyPreferences(prefs),
  onQuotaError: (e) => errorBus.error(e.category, e.code, e.message),
  onSaved: (project) => {
    lastPersistedCanonical = canonicalProjectJson(project);
  },
});

function wireStorage() {
  storage.attach();
}

function applyPreferences(prefs) {
  if (prefs.timingProfile) els.selTiming.value = prefs.timingProfile;
  if (prefs.sidModel) els.selSid.value = prefs.sidModel;
  if (prefs.joystickPort) els.selJoyport.value = String(prefs.joystickPort);
  if (typeof prefs.masterVolume === "number") {
    els.vol.value = String(prefs.masterVolume);
    audio.setVolume(prefs.masterVolume);
  }
}

function savePreferences() {
  storage.savePreferences({
    timingProfile: els.selTiming.value,
    sidModel: els.selSid.value,
    joystickPort: Number(els.selJoyport.value),
    masterVolume: Number(els.vol.value),
  });
}

// ---------------------------------------------------------------------------------------------
// Project + editor

function deriveOutputName(name) {
  let base = String(name).replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 16);
  return base.length >= 1 ? base : "program";
}

function syncProjectFromUI() {
  state.project = makeProject({
    name: els.projectName.value || "untitled",
    source: els.editor.value,
    timingProfile: els.selTiming.value,
    outputName: deriveOutputName(els.projectName.value || "program"),
  });
  return state.project;
}

function loadProjectIntoUI(project, _origin) {
  const v = validateProject(project);
  const p = v.ok ? v.project : makeProject(project);
  els.projectName.value = p.name === "untitled" ? "" : p.name;
  els.editor.value = p.source;
  els.selTiming.value = p.timingProfile;
  state.project = p;
  // A freshly loaded project is the current baseline: it is not a local divergence.
  lastPersistedCanonical = canonicalProjectJson(p);
  onEdit(0);
}

let buildTimer = 0;
function requestBuild(delayMs = 300, runAfterSuccess = false) {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    buildTimer = 0;
    const project = syncProjectFromUI();
    storage.scheduleSave(project);
    savePreferences();
    pendingEdit = false; // this build request captures the current source
    const seq = buildClient.build(project);
    if (runAfterSuccess) buildRunIntent.arm(seq);
    else buildRunIntent.cancel();
  }, delayMs);
}

// An edit invalidates artifacts synchronously (before the debounce) so Run/Download cannot use a
// stale build, and marks results in flight as stale until the next build request completes.
function onEdit(delayMs = 300) {
  buildRunIntent.cancel();
  pendingEdit = true;
  onBuildStale();
  requestBuild(delayMs);
}

function buildAndRun() {
  buildRunIntent.cancel();
  pendingEdit = true;
  onBuildStale();
  requestBuild(0, true);
}

function wireEditor() {
  els.editor.addEventListener("input", () => onEdit());
  els.editor.addEventListener("keydown", (event) => {
    if (isBuildAndRunShortcut(event)) {
      event.preventDefault();
      buildAndRun();
    }
  });
  els.projectName.addEventListener("input", () => onEdit());
  els.selTiming.addEventListener("change", () => onEdit(0));
  els.btnBuildRun.addEventListener("click", buildAndRun);
  els.btnBuild.addEventListener("click", () => onEdit(0));
}

// ---------------------------------------------------------------------------------------------
// Build worker

function wireBuild() {
  const worker = createBuildWorker(clientBase);
  buildClient = new BuildClient(worker, {
    onStale: onBuildStale,
    onResult: onBuildResult,
  });
}

function onBuildStale() {
  state.artifactsStale = true;
  setText(els.artifactStatus, "Rebuilding…");
  setEnabled(els.btnDlPrg, false);
  setEnabled(els.btnDlD64, false);
  updateRunEnabled();
}

function onBuildResult(data) {
  const runAfterSuccess = buildRunIntent.consume(data.seq);
  const diag = renderDiagnostics(data.diagnostics || []);
  setText(els.diagSummary, diag.summary);
  replaceChildren(els.diagList, ...diag.lines.map((line) => makeEl("li", { text: line })));

  // If the source changed after this build was requested, the result is already stale: show its
  // diagnostics but keep artifacts disabled. The pending rebuild will deliver a fresh result.
  if (pendingEdit) {
    state.lastBuild = null;
    state.artifactsStale = true;
    setText(els.buildId, "—");
    setText(els.artifactStatus, "Rebuilding…");
    setEnabled(els.btnDlPrg, false);
    setEnabled(els.btnDlD64, false);
    updateRunEnabled();
    return;
  }

  if (data.ok) {
    state.artifactsStale = false;
    state.lastBuild = {
      ok: true,
      buildId: data.buildId,
      prg: new Uint8Array(data.prg),
      d64: new Uint8Array(data.d64),
      prgName: data.prgName,
      d64Name: data.d64Name,
      runAddress: data.runAddress,
      loadAddress: data.loadAddress,
    };
    setText(els.buildId, data.buildId);
    setText(els.artifactStatus, `Built: PRG ${state.lastBuild.prg.length} B, D64 ${state.lastBuild.d64.length} B.`);
    setEnabled(els.btnDlPrg, true);
    setEnabled(els.btnDlD64, true);
  } else {
    state.lastBuild = null;
    setText(els.buildId, "—");
    setText(els.artifactStatus, "Build failed. Fix the diagnostics above.");
    setEnabled(els.btnDlPrg, false);
    setEnabled(els.btnDlD64, false);
    if (data.error) errorBus.error(data.error.category || "build", data.error.code || "error", data.error.message || "Build error.");
  }
  updateRunEnabled();
  if (data.ok && runAfterSuccess) void runProgram();
}

// ---------------------------------------------------------------------------------------------
// Machine controls (run/stop/reset + config)

function wireMachineControls() {
  renderer = new CanvasRenderer(els.screen);
  input = new InputController(els.screenSurface, {
    onReleaseAll: () => {
      if (machine && machine.ready) machine.releaseInput();
    },
    onFocusChange: (focused) => {
      els.screenSurface.classList.toggle("focused", focused);
    },
  });
  input.attach();

  els.btnRun.addEventListener("click", () => runProgram());
  els.btnBootBasic.addEventListener("click", () => bootBasic());
  els.btnStop.addEventListener("click", () => stopProgram());
  els.btnReset.addEventListener("click", () => resetProgram());
  els.selSid.addEventListener("change", savePreferences);
  els.selJoyport.addEventListener("change", () => {
    input.setJoystickPort(Number(els.selJoyport.value));
    savePreferences();
  });
  els.chkGamepad.addEventListener("change", () => input.setGamepadEnabled(els.chkGamepad.checked));
  els.vol.addEventListener("input", () => {
    audio.setVolume(Number(els.vol.value));
    savePreferences();
  });
  els.btnAudio.addEventListener("click", () => toggleAudio());
}

async function ensureMachine() {
  if (machine) return machine;
  if (!machineLoadPromise) {
    const url = new URL(WASM_LOADER_PATH, repoBase).href;
    machineLoadPromise = MachineController.load(url).then((m) => {
      machine = m;
      return m;
    });
  }
  return machineLoadPromise;
}

function updateRunEnabled() {
  const canRun = !!(state.lastBuild && state.lastBuild.ok) && !state.artifactsStale && romManager.ready();
  setEnabled(els.btnRun, canRun && !(pacer && pacer.running));
  setEnabled(els.btnBootBasic, romManager.ready() && !(pacer && pacer.running));
  updateD64RunEnabled();
}

async function runProgram() {
  if (!(state.lastBuild && state.lastBuild.ok)) {
    errorBus.error("build", "no-build", "Build a program before running.");
    return;
  }
  await runLoadedProgram(state.lastBuild.prg, state.lastBuild.runAddress, "built program");
}

async function runLoadedProgram(prg, runAddress, label, mediaGeneration = null) {
  const controller = await prepareMachine(mediaGeneration);
  if (!controller) return;
  const entered = controller.loadAndEnter(prg, { runAddress });
  if (!entered.ok) {
    errorBus.error(entered.error.category, entered.error.code, entered.error.message);
    return;
  }
  startMachineSession(
    controller,
    { kind: "program", prg: new Uint8Array(prg), runAddress, label },
    `Running ${label}.`,
  );
}

async function bootBasic() {
  const controller = await prepareMachine();
  if (!controller) return;
  const booted = controller.bootBasic();
  if (!booted.ok) {
    errorBus.error(booted.error.category, booted.error.code, booted.error.message);
    return;
  }
  startMachineSession(
    controller,
    { kind: "basic", label: "BASIC" },
    state.pendingD64 ? "Running BASIC with the selected disk mounted in drive 8." : "Running BASIC.",
  );
}

async function prepareMachine(mediaGeneration = null) {
  if (!romManager.ready()) {
    errorBus.error("rom", "rom-set-incomplete", "Load a complete, valid ROM set to enable machine controls.");
    return null;
  }
  const selectedRomGeneration = romLoadGeneration;
  let controller;
  try {
    controller = await ensureMachine();
  } catch (err) {
    errorBus.error("wasm", "load-failed", `The WebAssembly core could not be loaded: ${String(err && err.message ? err.message : err)}. Build the WASM artifact (see SETUP.md).`);
    return null;
  }
  if (selectedRomGeneration !== romLoadGeneration || !romManager.ready()) return null;
  if (mediaGeneration !== null && mediaGeneration !== d64SelectionGeneration) return null;
  if (pacer && pacer.running) stopProgram();
  state.activeSession = null;
  setEnabled(els.btnReset, false);

  const romSet = romManager.getRomSet();
  const cfg = controller.configure({
    timingProfile: els.selTiming.value,
    sidModel: els.selSid.value,
    roms: romSet,
  });
  if (!cfg.ok) {
    errorBus.error(cfg.error.category, cfg.error.code, cfg.error.message);
    return null;
  }

  if (state.pendingD64) {
    const mount = controller.mount(state.pendingD64.bytes);
    if (!mount.ok) {
      errorBus.error(mount.error.category, mount.error.code, mount.error.message);
      return null;
    }
    setText(els.d64Status, `Mounted ${mount.meta.diskName} (${mount.meta.fileCount} file${mount.meta.fileCount === 1 ? "" : "s"}).`);
  }

  return controller;
}

function startMachineSession(controller, activeSession, status) {
  state.activeSession = activeSession;
  input.setJoystickPort(Number(els.selJoyport.value));
  input.setGamepadEnabled(els.chkGamepad.checked);

  pacer = new Pacer(
    { machine: controller, renderer, audio, input },
    {
      timingProfile: els.selTiming.value,
      onCrash: onMachineCrash,
      onStop: onMachineStop,
      onStats: () => {},
    },
  );
  pacer.start();
  setText(els.runStatus, status);
  els.runStatus.className = "run-status running";
  setEnabled(els.btnStop, true);
  setEnabled(els.btnReset, true);
  updateRunEnabled();
  els.screenSurface.focus();
}

function stopProgram() {
  if (pacer) pacer.stop();
  if (input) input.releaseAll();
  if (machine) machine.releaseInput();
  setText(els.runStatus, "Stopped.");
  els.runStatus.className = "run-status";
  setEnabled(els.btnStop, false);
  updateRunEnabled();
}

function resetProgram() {
  if (!machine || !machine.ready) return;
  if (!state.activeSession) {
    errorBus.error("wasm", "no-session", "Nothing to reset to — Boot BASIC or run a program first.");
    return;
  }
  const wasRunning = pacer && pacer.running;
  if (pacer) pacer.stop();
  const reset = state.activeSession.kind === "basic"
    ? machine.bootBasic()
    : machine.loadAndEnter(state.activeSession.prg, { runAddress: state.activeSession.runAddress });
  if (!reset.ok) {
    errorBus.error(reset.error.category, reset.error.code, reset.error.message);
    return;
  }
  if (wasRunning) {
    pacer.start();
  } else {
    renderer.clear(0);
    setText(els.runStatus, `Reset ${state.activeSession.label}.`);
  }
}

function onMachineCrash() {
  setText(els.runStatus, "The machine stopped on a fault. Reset to restart the active session.");
  els.runStatus.className = "run-status crashed";
  setEnabled(els.btnStop, false);
  if (input) input.releaseAll();
  errorBus.error("wasm", "fault", "The emulated program hit an illegal instruction (fault). Execution stopped.");
  updateRunEnabled();
}

function onMachineStop(reason) {
  // A declared, non-fault halt (BRK or breakpoint): stop cleanly without an error banner.
  const label = reason === "brk" ? "The machine stopped (BRK). Reset to restart." : "The machine stopped. Reset to restart.";
  setText(els.runStatus, label);
  els.runStatus.className = "run-status";
  setEnabled(els.btnStop, false);
  if (input) input.releaseAll();
  if (machine) machine.releaseInput();
  updateRunEnabled();
}

async function toggleAudio() {
  if (!audioAvailable) {
    setText(els.audioStatus, "Audio unavailable in this browser");
    return;
  }
  if (audio.enabled) {
    await audio.disable();
    setText(els.audioStatus, "Audio off");
    return;
  }
  const res = await audio.enable(); // within the click gesture
  if (!res.ok) {
    errorBus.error(res.error.category, res.error.code, res.error.message);
    return;
  }
  const st = audio.state;
  setText(els.audioStatus, `Audio ${st.contextState}${st.underruns ? ` · ${st.underruns} underruns` : ""}`);
}

// ---------------------------------------------------------------------------------------------
// ROMs

function wireRoms() {
  els.selRomSource.addEventListener("change", () => {
    void selectRomSource(els.selRomSource.value);
  });
  renderRomRoles();
}

function renderRomRoles() {
  const status = romManager.status();
  const bundled = state.romSource === "bundled";
  setHidden(els.romCustom, bundled);

  if (state.romLoading) {
    setText(els.romStatus, "Loading and verifying bundled Pascual ROMs…");
    els.romStatus.className = "rom-status";
  } else if (bundled && status.ready) {
    setText(els.romStatus, "Bundled Pascual BASIC/KERNAL and PXL chargen verified. Boot BASIC is ready.");
    els.romStatus.className = "rom-status ready";
  } else if (bundled) {
    setText(els.romStatus, "Bundled Pascual ROMs are unavailable. Switch to custom ROMs and back to retry, or load a complete custom set.");
    els.romStatus.className = "rom-status error";
  } else {
    setText(els.romStatus, status.ready ? "Custom ROM set ready. Run is enabled once a build succeeds." : romStatusText(status));
    els.romStatus.className = status.ready ? "rom-status ready" : "rom-status";
  }

  const nodes = ROM_ROLES.map((role) => {
    const wrap = makeEl("div", { className: "rom-role" });
    wrap.appendChild(makeEl("h4", { text: role }));
    const desc = status.roles[role];
    const fileLabel = makeEl("label", { className: "field" });
    fileLabel.appendChild(makeEl("span", { text: `${role} ROM file` }));
    const fileInput = makeEl("input", { attrs: { type: "file", accept: ".bin,.rom", "data-role": role } });
    fileInput.addEventListener("change", (e) => onRomFile(role, e.target.files && e.target.files[0]));
    fileLabel.appendChild(fileInput);
    wrap.appendChild(fileLabel);

    if (desc) {
      wrap.appendChild(makeEl("p", { className: "digest", text: `sha256 ${desc.digest}` }));
      if (desc.requiresConfirmation && !desc.confirmed) {
        const note = makeEl("p", { className: "state needs-confirm", text: "Unknown ROM — confirm this file really is the " + role + " ROM." });
        wrap.appendChild(note);
        const confirm = makeEl("button", { text: `Confirm ${role} ROM`, attrs: { type: "button" } });
        confirm.addEventListener("click", () => {
          romManager.confirmRole(role);
          renderRomRoles();
          updateRunEnabled();
        });
        wrap.appendChild(confirm);
      } else {
        wrap.appendChild(makeEl("p", { className: "state ok", text: `Loaded (${desc.size} bytes).` }));
      }
    }
    return wrap;
  });
  replaceChildren(els.romRoles, ...nodes);
}

async function selectRomSource(source) {
  if (source !== "bundled" && source !== "custom") return;
  const generation = beginRomSourceSelection(source);

  if (source === "custom") return;

  const manifestUrl = new URL(BUNDLED_ROM_MANIFEST_PATH, repoBase);
  const loaded = await loadBundledRomSet(manifestUrl);
  if (generation !== romLoadGeneration || state.romSource !== "bundled") return;
  state.romLoading = false;
  if (!loaded.ok) {
    errorBus.error(loaded.error.category, loaded.error.code, loaded.error.message);
    renderRomRoles();
    updateRunEnabled();
    return;
  }
  const applied = romManager.setBundledSet(loaded.set);
  if (!applied.ok) {
    errorBus.error(applied.error.category, applied.error.code, applied.error.message);
  } else {
    els.romProvenanceLink.href = loaded.set.provenanceUrl;
    els.romLicenseLink.href = loaded.set.licenseUrl;
    els.romBasicLicenseLink.href = loaded.set.basicLicenseUrl;
    els.romLgplLink.href = loaded.set.lgplUrl;
    els.romGplLink.href = loaded.set.gplUrl;
    els.romChargenNoticeLink.href = loaded.set.chargenNoticeUrl;
    els.romSourceLink.href = loaded.set.sourceArchiveUrl;
    setHidden(els.romLegal, false);
  }
  renderRomRoles();
  updateRunEnabled();
}

function beginRomSourceSelection(source) {
  const generation = ++romLoadGeneration;
  state.romSource = source;
  state.romLoading = source === "bundled";
  els.selRomSource.value = source;
  setHidden(els.romLegal, true);
  invalidateMachineSession();
  romManager.clear();
  renderRomRoles();
  updateRunEnabled();
  return generation;
}

function romStatusText(status) {
  if (status.missing.length) return `Run disabled — missing ROM${status.missing.length === 1 ? "" : "s"}: ${status.missing.join(", ")}.`;
  if (status.unconfirmed.length) return `Run disabled — confirm unknown ROM${status.unconfirmed.length === 1 ? "" : "s"}: ${status.unconfirmed.join(", ")}.`;
  return "Run is disabled until a valid ROM set is loaded.";
}

async function onRomFile(role, file) {
  if (!file) return;
  const selectedRomGeneration = romLoadGeneration;
  const selectedRoleGeneration = (romFileReadGenerations.get(role) || 0) + 1;
  romFileReadGenerations.set(role, selectedRoleGeneration);
  const isCurrentSelection = () =>
    selectedRomGeneration === romLoadGeneration &&
    selectedRoleGeneration === romFileReadGenerations.get(role) &&
    state.romSource === "custom";
  invalidateMachineSession();
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    if (!isCurrentSelection()) return;
    errorBus.error("rom", "read", `Could not read the ${role} ROM file.`);
    return;
  }
  if (!isCurrentSelection()) return;
  const res = romManager.setRoleBytes(role, bytes);
  if (!res.ok) errorBus.error(res.error.category, res.error.code, res.error.message);
  renderRomRoles();
  updateRunEnabled();
}

// ---------------------------------------------------------------------------------------------
// Media (D64 import)

function wireMedia() {
  els.d64File.addEventListener("change", (e) => onD64File(e.target.files && e.target.files[0]));
  els.d64Program.addEventListener("change", selectD64Program);
  els.d64Entry.addEventListener("input", updateD64EntryStatus);
  els.btnRunD64.addEventListener("click", () => runD64Program());
  els.btnEjectD64.addEventListener("click", ejectD64);
}

async function onD64File(file) {
  if (!file) return;
  const generation = ++d64SelectionGeneration;
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    if (generation !== d64SelectionGeneration) return;
    errorBus.error("media", "read", "Could not read the D64 file.");
    return;
  }
  if (generation !== d64SelectionGeneration) return;
  if (!selectD64(bytes, file.name)) els.d64File.value = "";
}

function selectD64(bytes, label) {
  const media = new Uint8Array(bytes);
  const parsed = parseD64(media);
  if (!parsed.ok) {
    errorBus.error("media", parsed.error.code, parsed.error.message);
    return false;
  }

  if (machine && machine.ready) {
    const mount = machine.mount(media);
    if (!mount.ok) {
      errorBus.error(mount.error.category, mount.error.code, mount.error.message);
      return false;
    }
  }
  state.pendingD64 = { bytes: media, label, metadata: parsed.metadata, selectedPrg: null };
  for (const warning of parsed.warnings) errorBus.notice("media", warning.code, warning.message);
  renderD64Directory();
  return true;
}

function renderD64Directory() {
  const disk = state.pendingD64;
  if (!disk) return;
  const options = disk.metadata.entries.map((entry) => {
    const option = makeEl("option", {
      text: directoryEntryLabel(entry),
      attrs: { value: entry.index },
    });
    option.disabled = !isPrgEntry(entry);
    return option;
  });
  replaceChildren(els.d64Program, ...options);
  const firstPrg = disk.metadata.entries.find(isPrgEntry);
  els.d64Program.value = firstPrg ? String(firstPrg.index) : "";
  setHidden(els.d64Controls, false);
  setEnabled(els.d64Program, !!firstPrg);
  setEnabled(els.d64Entry, !!firstPrg);
  setText(
    els.d64Status,
    `${machine && machine.diskMounted ? "Mounted" : "Selected"} ${petsciiToDisplay(disk.metadata.diskName)} from ${disk.label} (${disk.metadata.entries.length} file${disk.metadata.entries.length === 1 ? "" : "s"}).`,
  );
  selectD64Program();
}

function selectD64Program() {
  const disk = state.pendingD64;
  const index = Number(els.d64Program.value);
  const entry = disk && disk.metadata.entries.find((candidate) => candidate.index === index);
  if (!disk || !isPrgEntry(entry)) {
    if (disk) disk.selectedPrg = null;
    els.d64Entry.value = "";
    setText(els.d64EntryStatus, "This disk has no directly runnable PRG entries.");
    updateD64RunEnabled();
    return;
  }

  const extracted = extractPrg(disk.bytes, index);
  if (!extracted.ok) {
    disk.selectedPrg = null;
    errorBus.error("media", extracted.error.code, extracted.error.message);
    updateD64RunEnabled();
    return;
  }
  const detectedRunAddress = detectBasicSysRunAddress(extracted.prg);
  disk.selectedPrg = { entry, prg: extracted.prg, detectedRunAddress };
  els.d64Entry.value = detectedRunAddress === null ? "" : formatEntryAddress(detectedRunAddress);
  updateD64EntryStatus();
}

function updateD64EntryStatus() {
  const selected = state.pendingD64 && state.pendingD64.selectedPrg;
  const address = parseEntryAddress(els.d64Entry.value);
  if (!selected) {
    setText(els.d64EntryStatus, "Select a PRG file.");
  } else if (address === null) {
    setText(
      els.d64EntryStatus,
      selected.detectedRunAddress === null
        ? "No first-line BASIC SYS target was detected. Enter a hexadecimal ($C000) or decimal (49152) entry address."
        : "Enter a valid 16-bit entry address.",
    );
  } else if (address === selected.detectedRunAddress) {
    setText(els.d64EntryStatus, `Detected first-line BASIC SYS target ${formatEntryAddress(address)}. You can edit it.`);
  } else {
    setText(els.d64EntryStatus, `Using entry ${formatEntryAddress(address)}.`);
  }
  els.d64Entry.setAttribute("aria-invalid", String(els.d64Entry.value.trim() !== "" && address === null));
  updateD64RunEnabled();
}

function updateD64RunEnabled() {
  if (!els.btnRunD64) return;
  const canRun = !!(state.pendingD64 && state.pendingD64.selectedPrg)
    && parseEntryAddress(els.d64Entry.value) !== null
    && romManager.ready()
    && !(pacer && pacer.running);
  setEnabled(els.btnRunD64, canRun);
}

async function runD64Program() {
  const disk = state.pendingD64;
  const selected = disk && disk.selectedPrg;
  const runAddress = parseEntryAddress(els.d64Entry.value);
  if (!selected) {
    errorBus.error("media", "no-prg", "Select a PRG file from the disk directory.");
    return;
  }
  if (runAddress === null) {
    errorBus.error("media", "invalid-entry", "Enter a valid 16-bit PRG entry address.");
    return;
  }
  const label = `disk PRG "${petsciiToDisplay(selected.entry.name)}"`;
  await runLoadedProgram(selected.prg, runAddress, label, d64SelectionGeneration);
}

function ejectD64() {
  d64SelectionGeneration += 1;
  if (machine && machine.diskMounted) {
    const result = machine.unmount();
    if (!result.ok) {
      errorBus.error(result.error.category, result.error.code, result.error.message);
      return;
    }
  }
  state.pendingD64 = null;
  els.d64File.value = "";
  els.d64Entry.value = "";
  replaceChildren(els.d64Program);
  setHidden(els.d64Controls, true);
  setText(els.d64EntryStatus, "");
  setText(els.d64Status, "No disk mounted.");
  updateD64RunEnabled();
}

// ---------------------------------------------------------------------------------------------
// Artifacts + share

function wireArtifacts() {
  els.btnDlPrg.addEventListener("click", () => {
    if (state.lastBuild && state.lastBuild.ok) downloadBytes(state.lastBuild.prg, state.project.outputName, "prg");
  });
  els.btnDlD64.addEventListener("click", () => {
    if (state.lastBuild && state.lastBuild.ok) downloadBytes(state.lastBuild.d64, state.project.outputName, "d64");
  });
  els.btnDlSrc.addEventListener("click", () => downloadSource(els.editor.value, state.project.name || "program"));
}

function wireShare() {
  els.btnShare.addEventListener("click", () => openShare());
  els.btnShareClose.addEventListener("click", () => setHidden(els.sharePanel, true));
  els.btnShareCopy.addEventListener("click", async () => {
    const res = await copyToClipboard(els.shareUrl.value);
    if (res.ok) errorBus.notice("share", "copied", "Share link copied to the clipboard.");
    else errorBus.error("share", "copy-failed", "Could not copy automatically — select the link and copy it manually.");
  });
}

function openShare() {
  syncProjectFromUI();
  const share = computeShare(els.editor.value, appBaseUrl);
  setHidden(els.sharePanel, false);
  if (!share.withinLimit) {
    setText(els.shareWarning, `This program is too large to share as a link (${share.urlLength} chars). Use “Download source” and send the file instead.`);
    els.shareUrl.value = "";
    setEnabled(els.btnShareCopy, false);
    return;
  }
  setEnabled(els.btnShareCopy, true);
  els.shareUrl.value = share.url;
  setText(
    els.shareWarning,
    "Heads up: a share link is public bearer data. Anyone with it can read and copy your source, intermediaries may keep it, it cannot be revoked, and edits are not shared until you Share again.",
  );
}

// ---------------------------------------------------------------------------------------------
// Gallery + initial project

function wireGallery() {
  els.gallerySelect.addEventListener("change", () => {
    const entry = state.galleryById.get(els.gallerySelect.value);
    if (entry) void openGalleryEntry(entry);
  });
}

async function loadGalleryList() {
  const result = await loadGallery(repoBase);
  state.galleryById = result.byId;
  if (result.errors.length) {
    for (const e of result.errors) errorBus.error("gallery", e.reason, `Gallery entry problem: ${e.id ?? "(unknown)"} — ${e.reason}.`);
  }
  const nodes = result.entries.map((entry) => {
    const item = makeEl("li", { className: "gallery-item" });
    item.appendChild(makeEl("h4", { text: entry.title }));
    item.appendChild(makeEl("p", { text: entry.description }));
    const actions = makeEl("div", { className: "actions" });
    const open = makeEl("button", { text: "Open & remix", attrs: { type: "button" } });
    open.addEventListener("click", () => openGalleryEntry(entry));
    actions.appendChild(open);
    item.appendChild(actions);
    return item;
  });
  const options = [
    makeEl("option", { text: "Choose sample…", attrs: { value: "" } }),
    ...result.entries.map((entry) => makeEl("option", {
      text: entry.title,
      attrs: { value: entry.id },
    })),
  ];
  replaceChildren(els.gallerySelect, ...options);
  setEnabled(els.gallerySelect, result.entries.length > 0);
  replaceChildren(els.galleryList, ...nodes);
}

async function openGalleryEntry(entry) {
  const generation = ++gallerySelectionGeneration;
  const src = await fetchSource(entry, repoBase);
  if (generation !== gallerySelectionGeneration) return;
  if (!src.ok) {
    els.gallerySelect.value = "";
    errorBus.error(src.error.category, src.error.code, src.error.message);
    return;
  }
  const project = projectFromGalleryEntry(entry, src.source);
  loadProjectIntoUI(project, "src");
  els.gallerySelect.value = entry.id;
  if (entry.curatedD64Path) await mountCuratedD64(entry.curatedD64Path);
}

async function mountCuratedD64(path) {
  const generation = ++d64SelectionGeneration;
  const res = await fetchCuratedD64(path, repoBase);
  if (generation !== d64SelectionGeneration) return;
  if (!res.ok) {
    errorBus.error(res.error.category, res.error.code, res.error.message);
    return;
  }
  if (selectD64(res.bytes, path)) els.d64File.value = "";
}

async function decideInitialProject() {
  const resolved = resolveUrlState(location.search, state.galleryById);
  for (const e of resolved.errors) errorBus.error(e.category, e.code, e.message);
  for (const n of resolved.notices) errorBus.notice("share", "info", n);

  if (resolved.sourceOrigin === "code") {
    loadProjectIntoUI(makeProject({ source: resolved.source, name: "shared remix" }), "code");
  } else if (resolved.sourceOrigin === "src" && resolved.galleryEntry) {
    await openGalleryEntry(resolved.galleryEntry);
  } else if (resolved.hadSourceParam) {
    // A source param was present but malformed/unknown: show the error (already published) and a
    // blank editor. Never silently substitute the local autosave for a bad shared link.
    loadProjectIntoUI(makeProject({ source: "", name: "untitled" }), "url-error");
  } else {
    const restored = storage.loadProject();
    if (restored) loadProjectIntoUI(restored, "autosave");
    else loadProjectIntoUI(makeProject({ source: STARTER_SOURCE, name: "hello" }), "default");
  }

  if (resolved.d64) await mountCuratedD64(resolved.d64.path);
}

// ---------------------------------------------------------------------------------------------
// Rendering helpers

function renderErrors(_item, items) {
  const nodes = (items || []).slice(-8).map((it) => {
    const li = makeEl("li", { className: it.severity === "notice" ? "notice" : "" });
    li.appendChild(makeEl("span", { className: "cat", text: it.category }));
    li.appendChild(document.createTextNode(it.message));
    return li;
  });
  replaceChildren(els.errorList, ...nodes);
}

function renderKeyHelp() {
  const rows = KEY_HELP.map((h) => {
    const tr = makeEl("tr");
    tr.appendChild(makeEl("td", { text: h.keys }));
    tr.appendChild(makeEl("td", { text: h.c64 }));
    return tr;
  });
  replaceChildren(els.keyHelpBody, ...rows);
}

const STARTER_SOURCE = `; Welcome to the c64 browser IDE.
; Edit, then choose Build & Run (Ctrl+Enter). Bundled Pascual ROMs are loaded by default.
;
; In basic-sys mode a "10 SYS ..." stub is generated for you, so just start with
; code — it is placed immediately after the stub (do NOT set * = $0801 yourself).

start
        ldx #$00
loop    lda message,x
        sta $0400,x         ; write to screen RAM
        inx
        cpx #$0d
        bne loop
halt    jmp halt

message .text "HELLO C64"
        .byte 32, 32, 32, 32
`;

// ---------------------------------------------------------------------------------------------
// Test hook (E2E only). Exposes the same public operations the UI uses (no privileged data path);
// ROM injection here is byte-for-byte equivalent to the file picker and stays memory-only.

window.__c64 = {
  setRomBytes: (role, bytes) => {
    if (state.romSource !== "custom") {
      beginRomSourceSelection("custom");
    }
    const res = romManager.setRoleBytes(role, bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
    if (res.ok) romManager.confirmRole(role);
    renderRomRoles();
    updateRunEnabled();
    return res;
  },
  selectRomSource: (source) => selectRomSource(source),
  romSource: () => state.romSource,
  romReady: () => romManager.ready(),
  runEnabled: () => !els.btnRun.disabled,
  bootBasicEnabled: () => !els.btnBootBasic.disabled,
  activeMode: () => (state.activeSession ? state.activeSession.kind : null),
  lastBuild: () => (state.lastBuild ? { buildId: state.lastBuild.buildId, prgLen: state.lastBuild.prg.length, d64Len: state.lastBuild.d64.length } : null),
  frame: () => (machine && machine.ready ? machine.copyFramebuffer() : null),
  screenText: () => {
    if (!machine || !machine.ready) return "";
    let text = "";
    for (let offset = 0; offset < 1000; offset += 1) {
      text += displayScreenCode(machine.debugReadRam(0x0400 + offset));
    }
    return text;
  },
  cpu: () => (machine && machine.ready ? machine.cpuState() : null),
  peek: (addr) => (machine && machine.ready ? machine.debugReadRam(addr) : null),
  inputSnapshot: () => (input ? input.snapshot() : null),
  running: () => !!(pacer && pacer.running),
  diskMounted: () => !!(machine && machine.diskMounted),
  audioAvailable: () => audioAvailable,
  errors: () => errorBus.items(),
  initialized: () => appInitialized,
};

function invalidateMachineSession() {
  if (pacer && pacer.running) stopProgram();
  if (machine) machine.dispose();
  state.activeSession = null;
  setEnabled(els.btnReset, false);
  setText(els.runStatus, "Stopped.");
  els.runStatus.className = "run-status";
}

function displayScreenCode(value) {
  const code = Number(value) & 0x7f;
  if (code >= 1 && code <= 26) return String.fromCharCode(64 + code);
  if (code >= 32 && code <= 63) return String.fromCharCode(code);
  return " ";
}

init().catch((err) => {
  const status = document.getElementById("status-line");
  if (status) setText(status, `Startup failed: ${String(err && err.message ? err.message : err)}`);
});
