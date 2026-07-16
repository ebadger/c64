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
  { keys: "PageUp", c64: "RESTORE (NMI)" },
  { keys: "Numpad 8/2/4/6 + 0", c64: "Joystick 2 up/down/left/right + fire" },
]);

/**
 * Build the 8 active-low keyboard column bytes from a set of currently-pressed codes.
 * @param {Set<string>|Iterable<string>} pressedCodes
 * @returns {Uint8Array} length 8
 */
export function buildKeyboardColumns(pressedCodes) {
  const cols = new Uint8Array(8).fill(0xff);
  for (const code of pressedCodes) {
    const positions = KEYBOARD_MATRIX_MAP.get(code);
    if (!positions) continue;
    for (const [col, row] of positions) {
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
