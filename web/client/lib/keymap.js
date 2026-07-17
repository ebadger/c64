// Physical keyboard/joystick mapping to the C64 matrix. Environment-free and pure so the matrix
// assembly is Node-testable. Uses KeyboardEvent.code values (physical positions, layout- and
// repeat-independent). Matrix orientation matches the core: keyboardColumns[col], bit r = row
// line, active-low (0 = pressed). See specs/IO.md and core/src/cia.cpp.
//
// C64 matrix reference (column = CIA1 PRA line, row = CIA1 PRB line):
//   col0: DEL RET CRSR-LR F7 F1 F3 F5 CRSR-UD
//   col1: 3 W A 4 Z S E LSHIFT
//   col2: 5 R D 6 C F T X
//   col3: 7 Y G 8 B H U V
//   col4: 9 I J 0 M K O N
//   col5: + P L - . : @ ,
//   col6: £ * ; HOME RSHIFT = UP/ARROW /
//   col7: 1 LEFT-ARROW CTRL 2 SPACE C= Q RUN/STOP

const LSHIFT = [1, 7];
const HOST_SHIFT_CODES = new Set(["ShiftLeft", "ShiftRight"]);

// Common host punctuation chords whose C64 keys are at different physical positions.
const SHIFTED_HOST_ALIASES = new Map([
  ["Quote", { positions: [[7, 3]], consumeShift: false }], // " = C64 Shift+2
  ["Digit8", { positions: [[6, 1]], consumeShift: true }], // * = dedicated C64 key
]);

function virtualKey(id, label, column, row, options = {}) {
  return Object.freeze({
    id,
    label,
    matrix: Object.freeze([Object.freeze([column, row])]),
    shiftedLabel: options.shiftedLabel || "",
    ariaLabel: options.ariaLabel || label,
    className: options.className || "",
    modifier: options.modifier || "",
    lock: options.lock === true,
  });
}

function restoreKey() {
  return Object.freeze({
    id: "restore",
    label: "RESTORE",
    shiftedLabel: "",
    ariaLabel: "RESTORE (NMI)",
    className: "restore",
    modifier: "",
    lock: false,
    restore: true,
  });
}

function spacer(className) {
  return Object.freeze({ spacer: true, className });
}

// Original C64 physical key order. Function keys are a separate vertical column; F2/F4/F6/F8
// and the up/left cursor directions are the shifted legends on the same physical keycaps.
export const C64_VIRTUAL_KEYBOARD = Object.freeze({
  rows: Object.freeze([
    Object.freeze([
      virtualKey("left-arrow", "←", 7, 1, { ariaLabel: "Left arrow" }),
      virtualKey("digit-1", "1", 7, 0),
      virtualKey("digit-2", "2", 7, 3),
      virtualKey("digit-3", "3", 1, 0),
      virtualKey("digit-4", "4", 1, 3),
      virtualKey("digit-5", "5", 2, 0),
      virtualKey("digit-6", "6", 2, 3),
      virtualKey("digit-7", "7", 3, 0),
      virtualKey("digit-8", "8", 3, 3),
      virtualKey("digit-9", "9", 4, 0),
      virtualKey("digit-0", "0", 4, 3),
      virtualKey("plus", "+", 5, 0),
      virtualKey("minus", "-", 5, 3),
      virtualKey("pound", "£", 6, 0, { ariaLabel: "Pound sign" }),
      virtualKey("home", "HOME", 6, 3, {
        shiftedLabel: "CLR",
        ariaLabel: "HOME; Shift CLR",
        className: "compact",
      }),
      virtualKey("delete", "DEL", 0, 0, {
        shiftedLabel: "INST",
        ariaLabel: "Delete; Shift Insert",
        className: "compact",
      }),
    ]),
    Object.freeze([
      virtualKey("control", "CTRL", 7, 2, {
        ariaLabel: "Control",
        className: "wide modifier",
        modifier: "one-shot",
      }),
      virtualKey("key-q", "Q", 7, 6),
      virtualKey("key-w", "W", 1, 1),
      virtualKey("key-e", "E", 1, 6),
      virtualKey("key-r", "R", 2, 1),
      virtualKey("key-t", "T", 2, 6),
      virtualKey("key-y", "Y", 3, 1),
      virtualKey("key-u", "U", 3, 6),
      virtualKey("key-i", "I", 4, 1),
      virtualKey("key-o", "O", 4, 6),
      virtualKey("key-p", "P", 5, 1),
      virtualKey("at", "@", 5, 6, { ariaLabel: "At sign" }),
      virtualKey("asterisk", "*", 6, 1, { ariaLabel: "Asterisk" }),
      virtualKey("up-arrow", "↑", 6, 6, { ariaLabel: "Up arrow" }),
      restoreKey(),
    ]),
    Object.freeze([
      virtualKey("run-stop", "RUN/STOP", 7, 7, { className: "wide compact" }),
      virtualKey("shift-lock", "SHIFT LOCK", 1, 7, {
        ariaLabel: "Shift Lock",
        className: "wide compact modifier",
        lock: true,
      }),
      virtualKey("key-a", "A", 1, 2),
      virtualKey("key-s", "S", 1, 5),
      virtualKey("key-d", "D", 2, 2),
      virtualKey("key-f", "F", 2, 5),
      virtualKey("key-g", "G", 3, 2),
      virtualKey("key-h", "H", 3, 5),
      virtualKey("key-j", "J", 4, 2),
      virtualKey("key-k", "K", 4, 5),
      virtualKey("key-l", "L", 5, 2),
      virtualKey("colon", ":", 5, 5, { ariaLabel: "Colon" }),
      virtualKey("semicolon", ";", 6, 2, { ariaLabel: "Semicolon" }),
      virtualKey("equal", "=", 6, 5, { ariaLabel: "Equals" }),
      virtualKey("return", "RETURN", 0, 1, { className: "wide compact" }),
    ]),
    Object.freeze([
      virtualKey("commodore", "C=", 7, 5, {
        ariaLabel: "Commodore",
        className: "wide modifier",
        modifier: "one-shot",
      }),
      virtualKey("left-shift", "SHIFT", 1, 7, {
        ariaLabel: "Left Shift",
        className: "wide modifier",
        modifier: "one-shot",
      }),
      virtualKey("key-z", "Z", 1, 4),
      virtualKey("key-x", "X", 2, 7),
      virtualKey("key-c", "C", 2, 4),
      virtualKey("key-v", "V", 3, 7),
      virtualKey("key-b", "B", 3, 4),
      virtualKey("key-n", "N", 4, 7),
      virtualKey("key-m", "M", 4, 4),
      virtualKey("comma", ",", 5, 7, { ariaLabel: "Comma" }),
      virtualKey("period", ".", 5, 4, { ariaLabel: "Period" }),
      virtualKey("slash", "/", 6, 7, { ariaLabel: "Slash" }),
      virtualKey("right-shift", "SHIFT", 6, 4, {
        ariaLabel: "Right Shift",
        className: "wide modifier",
        modifier: "one-shot",
      }),
      virtualKey("cursor-vertical", "↓", 0, 7, {
        shiftedLabel: "↑",
        ariaLabel: "Cursor down; Shift cursor up",
        className: "cursor",
      }),
      virtualKey("cursor-horizontal", "→", 0, 2, {
        shiftedLabel: "←",
        ariaLabel: "Cursor right; Shift cursor left",
        className: "cursor",
      }),
    ]),
    Object.freeze([
      spacer("space-side"),
      virtualKey("space", "SPACE", 7, 4, { className: "space" }),
      spacer("space-side"),
    ]),
  ]),
  functionKeys: Object.freeze([
    virtualKey("f1", "F1", 0, 4, { shiftedLabel: "F2", ariaLabel: "F1; Shift F2" }),
    virtualKey("f3", "F3", 0, 5, { shiftedLabel: "F4", ariaLabel: "F3; Shift F4" }),
    virtualKey("f5", "F5", 0, 6, { shiftedLabel: "F6", ariaLabel: "F5; Shift F6" }),
    virtualKey("f7", "F7", 0, 3, { shiftedLabel: "F8", ariaLabel: "F7; Shift F8" }),
  ]),
});

const virtualKeys = [
  ...C64_VIRTUAL_KEYBOARD.rows.flat().filter((key) => !key.spacer),
  ...C64_VIRTUAL_KEYBOARD.functionKeys,
];

export const C64_VIRTUAL_KEY_MAP = new Map(virtualKeys.map((key) => [key.id, key]));

// code -> one or more [column, row] matrix positions. A few keys inject LEFT SHIFT so a single
// modern key reaches a shifted C64 position (e.g. the two extra cursor directions).
export const KEYBOARD_MATRIX_MAP = new Map([
  // Letters
  ["KeyA", [[1, 2]]], ["KeyB", [[3, 4]]], ["KeyC", [[2, 4]]], ["KeyD", [[2, 2]]],
  ["KeyE", [[1, 6]]], ["KeyF", [[2, 5]]], ["KeyG", [[3, 2]]], ["KeyH", [[3, 5]]],
  ["KeyI", [[4, 1]]], ["KeyJ", [[4, 2]]], ["KeyK", [[4, 5]]], ["KeyL", [[5, 2]]],
  ["KeyM", [[4, 4]]], ["KeyN", [[4, 7]]], ["KeyO", [[4, 6]]], ["KeyP", [[5, 1]]],
  ["KeyQ", [[7, 6]]], ["KeyR", [[2, 1]]], ["KeyS", [[1, 5]]], ["KeyT", [[2, 6]]],
  ["KeyU", [[3, 6]]], ["KeyV", [[3, 7]]], ["KeyW", [[1, 1]]], ["KeyX", [[2, 7]]],
  ["KeyY", [[3, 1]]], ["KeyZ", [[1, 4]]],
  // Digits
  ["Digit1", [[7, 0]]], ["Digit2", [[7, 3]]], ["Digit3", [[1, 0]]], ["Digit4", [[1, 3]]],
  ["Digit5", [[2, 0]]], ["Digit6", [[2, 3]]], ["Digit7", [[3, 0]]], ["Digit8", [[3, 3]]],
  ["Digit9", [[4, 0]]], ["Digit0", [[4, 3]]],
  // Control / whitespace
  ["Enter", [[0, 1]]], ["Space", [[7, 4]]], ["Backspace", [[0, 0]]],
  ["ShiftLeft", [LSHIFT]], ["ShiftRight", [[6, 4]]], ["ControlLeft", [[7, 2]]],
  ["Escape", [[7, 7]]], ["Tab", [[7, 5]]], ["Home", [[6, 3]]],
  // Cursor keys: C64 has two physical cursor keys; the other two directions are shifted.
  ["ArrowRight", [[0, 2]]], ["ArrowLeft", [[0, 2], LSHIFT]],
  ["ArrowDown", [[0, 7]]], ["ArrowUp", [[0, 7], LSHIFT]],
  // Function keys (F2/F4/F6/F8 are shifted on a real C64; mapped keys here are the base set).
  ["F1", [[0, 4]]], ["F3", [[0, 5]]], ["F5", [[0, 6]]], ["F7", [[0, 3]]],
  // Punctuation (physical positions mapped to the nearest C64 key)
  ["Minus", [[5, 3]]], ["Equal", [[6, 5]]], ["Comma", [[5, 7]]], ["Period", [[5, 4]]],
  ["Slash", [[6, 7]]], ["Semicolon", [[6, 2]]], ["Quote", [[5, 5]]],
  ["BracketLeft", [[5, 6]]], ["BracketRight", [[6, 1]]], ["Backslash", [[6, 6]]],
  ["Backquote", [[7, 1]]],
]);

// RESTORE is the NMI input, not a matrix key.
export const RESTORE_CODES = new Set(["PageUp"]);

// Joystick (default port 2). code -> active-low bit: 0 up, 1 down, 2 left, 3 right, 4 fire.
export const JOYSTICK2_MAP = new Map([
  ["Numpad8", 0], ["Numpad2", 1], ["Numpad4", 2], ["Numpad6", 3],
  ["Numpad0", 4], ["NumpadEnter", 4],
]);

// Human-readable help rows for the UI (physical key -> C64 function).
export const KEY_HELP = Object.freeze([
  { keys: "A–Z, 0–9", c64: "Letters and digits" },
  { keys: "Enter", c64: "RETURN" },
  { keys: "Backspace", c64: "INST/DEL" },
  { keys: "Arrow keys", c64: "CRSR (←/↑ are shifted)" },
  { keys: "Left Shift / Right Shift", c64: "SHIFT" },
  { keys: "Left Ctrl", c64: "CTRL" },
  { keys: "Tab", c64: "Commodore (C=) key" },
  { keys: "Esc", c64: "RUN/STOP" },
  { keys: "Home", c64: "CLR/HOME" },
  { keys: "F1 F3 F5 F7", c64: "Function keys" },
  { keys: "Shift+Quote / Shift+8", c64: "\" / *" },
  { keys: "PageUp", c64: "RESTORE (NMI)" },
  { keys: "Numpad 8/2/4/6 + 0", c64: "Joystick 2 up/down/left/right + fire" },
]);

/**
 * Build the 8 active-low keyboard column bytes from a set of currently-pressed codes.
 * @param {Set<string>|Iterable<string>} pressedCodes
 * @param {Set<string>|Iterable<string>} [pressedVirtualKeys]
 * @returns {Uint8Array} length 8
 */
export function buildKeyboardColumns(pressedCodes, pressedVirtualKeys = []) {
  const cols = new Uint8Array(8).fill(0xff);
  const pressed = new Set(pressedCodes);
  const shifted = [...HOST_SHIFT_CODES].some((code) => pressed.has(code));
  const activeAliases = shifted
    ? [...SHIFTED_HOST_ALIASES.entries()].filter(([code]) => pressed.has(code))
    : [];
  const consumeShift = activeAliases.some(([, alias]) => alias.consumeShift);
  const aliases = new Map(activeAliases);

  for (const code of pressed) {
    if (consumeShift && HOST_SHIFT_CODES.has(code)) continue;
    const positions = aliases.get(code)?.positions || KEYBOARD_MATRIX_MAP.get(code);
    if (!positions) continue;
    for (const [col, row] of positions) {
      cols[col] &= ~(1 << row) & 0xff;
    }
  }
  for (const id of pressedVirtualKeys) {
    const key = C64_VIRTUAL_KEY_MAP.get(id);
    if (!key || !key.matrix) continue;
    for (const [col, row] of key.matrix) {
      cols[col] &= ~(1 << row) & 0xff;
    }
  }
  return cols;
}

/**
 * Build one active-low joystick byte from pressed codes using the given map.
 * @param {Set<string>|Iterable<string>} pressedCodes
 * @param {Map<string, number>} map
 * @returns {number} active-low joystick byte (bits 5..7 read 1)
 */
export function buildJoystick(pressedCodes, map) {
  let value = 0xff;
  for (const code of pressedCodes) {
    const bit = map.get(code);
    if (bit !== undefined) value &= ~(1 << bit) & 0xff;
  }
  return value;
}

/** True when a code is mapped to any C64 input (matrix, joystick, or RESTORE). */
export function isMappedCode(code, joystickMap = JOYSTICK2_MAP) {
  return KEYBOARD_MATRIX_MAP.has(code) || joystickMap.has(code) || RESTORE_CODES.has(code);
}
