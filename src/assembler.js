// NMOS 6502/6510 assembler: lexer, parser, deterministic multi-pass resolver, and PRG
// serialization. See specs/CODEGEN.md for the language and PRG/entry contracts.
//
// Expression grammar (deliberately small and unambiguous):
//   expression := [ '<' | '>' ] additive          '<' = low byte, '>' = high byte of result
//   additive   := primary ( ('+' | '-') primary )*
//   primary    := number | charLiteral | identifier | '*'   ('*' = current program counter)
// Parentheses are reserved for indirect addressing and are not expression grouping.

import { OPCODES, isMnemonic } from "./opcodes.js";
import { encodePetsciiCodePoint, encodePetsciiString } from "./petscii.js";
import { error, sortDiagnostics } from "./diagnostics.js";
import { validateProject, computeBuildId } from "./project.js";
import {
  buildBasicSysStub,
  basicSysStubLength,
  defaultBasicCodeOrigin,
  BASIC_LOAD_ADDRESS,
} from "./basicStub.js";

const MEMORY_TOP = 0x10000;

const DIRECTIVES = new Set([".org", ".byte", ".word", ".text", ".fill", ".align"]);

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}
function isIdentPart(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Tokenize a single source line.
 * @returns {{ tokens: object[], diagnostic: object|null }}
 */
function lexLine(text, lineNumber) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const col = i + 1;
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === ";") {
      break; // comment to end of line
    }
    if (ch === ".") {
      // directive token: '.' followed by identifier characters
      let j = i + 1;
      while (j < n && isIdentPart(text[j])) j += 1;
      const word = text.slice(i, j).toLowerCase();
      tokens.push({ type: "directive", value: word, col });
      i = j;
      continue;
    }
    if (ch === "$") {
      let j = i + 1;
      while (j < n && /[0-9A-Fa-f]/.test(text[j])) j += 1;
      if (j === i + 1) {
        return { tokens, diagnostic: error("syntax", "Malformed hexadecimal literal.", lineNumber, col, 1) };
      }
      tokens.push({ type: "number", value: parseInt(text.slice(i + 1, j), 16), col });
      i = j;
      continue;
    }
    if (ch === "%") {
      let j = i + 1;
      while (j < n && /[01]/.test(text[j])) j += 1;
      if (j === i + 1) {
        return { tokens, diagnostic: error("syntax", "Malformed binary literal.", lineNumber, col, 1) };
      }
      tokens.push({ type: "number", value: parseInt(text.slice(i + 1, j), 2), col });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9]/.test(text[j])) j += 1;
      tokens.push({ type: "number", value: parseInt(text.slice(i, j), 10), col });
      i = j;
      continue;
    }
    if (ch === "'") {
      // Character literal: exactly one Unicode code point between single quotes. A code point
      // may occupy two UTF-16 units (a surrogate pair), so measure by code point rather than
      // assuming a single unit; PETSCII validation then decides supported vs unsupported so
      // an astral character reports `unsupported-character`, not a lexer `syntax` error.
      const codePoint = text.codePointAt(i + 1);
      if (codePoint === undefined || text[i + 1] === "'") {
        return { tokens, diagnostic: error("syntax", "Malformed character literal.", lineNumber, col, 1) };
      }
      const charStr = String.fromCodePoint(codePoint);
      const closeIndex = i + 1 + charStr.length;
      if (text[closeIndex] !== "'") {
        return { tokens, diagnostic: error("syntax", "Malformed character literal.", lineNumber, col, 1) };
      }
      tokens.push({ type: "char", ch: charStr, col });
      i = closeIndex + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += 1;
      if (j >= n) {
        return { tokens, diagnostic: error("syntax", "Unterminated string literal.", lineNumber, col, 1) };
      }
      tokens.push({ type: "string", value: text.slice(i + 1, j), col });
      i = j + 1;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isIdentPart(text[j])) j += 1;
      tokens.push({ type: "ident", value: text.slice(i, j), col });
      i = j;
      continue;
    }
    const single = {
      "#": "hash",
      ",": "comma",
      "(": "lparen",
      ")": "rparen",
      "*": "star",
      "=": "equals",
      "<": "lt",
      ">": "gt",
      "+": "plus",
      "-": "minus",
      ":": "colon",
    }[ch];
    if (single) {
      tokens.push({ type: single, value: ch, col });
      i += 1;
      continue;
    }
    return { tokens, diagnostic: error("syntax", `Unexpected character '${ch}'.`, lineNumber, col, 1) };
  }
  return { tokens, diagnostic: null };
}

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------

// Parse a token slice into an expression AST: { lohi, terms:[{sign, primary}] }.
function parseExpression(tokens, lineNumber) {
  let idx = 0;
  let lohi = null;
  if (tokens[idx] && (tokens[idx].type === "lt" || tokens[idx].type === "gt")) {
    lohi = tokens[idx].type === "lt" ? "lo" : "hi";
    idx += 1;
  }
  const terms = [];
  const parsePrimary = () => {
    const tok = tokens[idx];
    if (!tok) return null;
    if (tok.type === "number") {
      idx += 1;
      return { type: "num", value: tok.value, col: tok.col };
    }
    if (tok.type === "char") {
      idx += 1;
      return { type: "char", ch: tok.ch, col: tok.col };
    }
    if (tok.type === "ident") {
      idx += 1;
      return { type: "sym", name: tok.value, col: tok.col };
    }
    if (tok.type === "star") {
      idx += 1;
      return { type: "pc", col: tok.col };
    }
    return null;
  };
  const first = parsePrimary();
  if (!first) {
    const col = tokens[0] ? tokens[0].col : 1;
    return { expr: null, diagnostic: error("syntax", "Expected an expression.", lineNumber, col, 1) };
  }
  terms.push({ sign: 1, primary: first });
  while (idx < tokens.length) {
    const op = tokens[idx];
    if (op.type !== "plus" && op.type !== "minus") {
      return {
        expr: null,
        diagnostic: error("syntax", "Unexpected token in expression.", lineNumber, op.col, 1),
      };
    }
    idx += 1;
    const primary = parsePrimary();
    if (!primary) {
      const col = tokens[idx] ? tokens[idx].col : op.col;
      return { expr: null, diagnostic: error("syntax", "Expected an operand after operator.", lineNumber, col, 1) };
    }
    terms.push({ sign: op.type === "plus" ? 1 : -1, primary });
  }
  return { expr: { lohi, terms }, diagnostic: null };
}

// Evaluate an expression AST. Returns { value, undefined: name|null, diagnostic|null }.
// `undefined` is set when a referenced symbol is not (yet) defined.
function evaluateExpression(expr, ctx, lineNumber) {
  let sum = 0;
  let undefinedName = null;
  for (const term of expr.terms) {
    const p = term.primary;
    let value = 0;
    if (p.type === "num") {
      value = p.value;
    } else if (p.type === "char") {
      const byte = encodePetsciiCodePoint(p.ch.codePointAt(0));
      if (byte === null) {
        return {
          value: 0,
          undefined: null,
          diagnostic: error(
            "unsupported-character",
            `Character '${p.ch}' has no PETSCII representation.`,
            lineNumber,
            p.col,
            1,
          ),
        };
      }
      value = byte;
    } else if (p.type === "pc") {
      value = ctx.pc;
    } else if (p.type === "sym") {
      const entry = ctx.symbols.get(p.name.toLowerCase());
      if (!entry || entry.value === undefined) {
        undefinedName = { name: p.name, col: p.col };
        value = 0;
      } else {
        value = entry.value;
      }
    }
    sum += term.sign * value;
  }
  if (expr.lohi === "lo") sum = sum & 0xff;
  else if (expr.lohi === "hi") sum = (sum >> 8) & 0xff;
  return { value: sum, undefined: undefinedName, diagnostic: null };
}

// ---------------------------------------------------------------------------
// Line parser
// ---------------------------------------------------------------------------

function parseOperand(tokens, mnemonic, lineNumber) {
  if (tokens.length === 0) {
    return { operand: { form: "none" }, diagnostic: null };
  }
  const mnem = mnemonic.toUpperCase();
  const hasAcc = OPCODES[mnem] && OPCODES[mnem].acc !== undefined;
  if (hasAcc && tokens.length === 1 && tokens[0].type === "ident" && tokens[0].value.toUpperCase() === "A") {
    return { operand: { form: "acc" }, diagnostic: null };
  }
  if (tokens[0].type === "hash") {
    const { expr, diagnostic } = parseExpression(tokens.slice(1), lineNumber);
    if (diagnostic) return { operand: null, diagnostic };
    return { operand: { form: "imm", expr }, diagnostic: null };
  }
  if (tokens[0].type === "lparen") {
    // (expr) | (expr),Y | (expr,X)
    // Find the closing paren scanning for ',X)' or ')' patterns at the token level.
    const inner = [];
    let idx = 1;
    let sawComma = false;
    while (idx < tokens.length && tokens[idx].type !== "rparen" && tokens[idx].type !== "comma") {
      inner.push(tokens[idx]);
      idx += 1;
    }
    if (idx < tokens.length && tokens[idx].type === "comma") {
      // (expr,X)
      sawComma = true;
      idx += 1;
      const reg = tokens[idx];
      if (!reg || reg.type !== "ident" || reg.value.toUpperCase() !== "X") {
        return { operand: null, diagnostic: error("syntax", "Expected 'X' in indexed indirect operand.", lineNumber, reg ? reg.col : tokens[0].col, 1) };
      }
      idx += 1;
      if (!tokens[idx] || tokens[idx].type !== "rparen" || tokens[idx + 1]) {
        return { operand: null, diagnostic: error("syntax", "Malformed indexed indirect operand.", lineNumber, tokens[0].col, 1) };
      }
      const { expr, diagnostic } = parseExpression(inner, lineNumber);
      if (diagnostic) return { operand: null, diagnostic };
      return { operand: { form: "indX", expr }, diagnostic: null };
    }
    if (idx < tokens.length && tokens[idx].type === "rparen") {
      idx += 1;
      if (!tokens[idx]) {
        const { expr, diagnostic } = parseExpression(inner, lineNumber);
        if (diagnostic) return { operand: null, diagnostic };
        return { operand: { form: "indirect", expr }, diagnostic: null };
      }
      // (expr),Y
      if (tokens[idx].type === "comma" && tokens[idx + 1] && tokens[idx + 1].type === "ident" && tokens[idx + 1].value.toUpperCase() === "Y" && !tokens[idx + 2]) {
        const { expr, diagnostic } = parseExpression(inner, lineNumber);
        if (diagnostic) return { operand: null, diagnostic };
        return { operand: { form: "indY", expr }, diagnostic: null };
      }
      return { operand: null, diagnostic: error("syntax", "Malformed indirect operand.", lineNumber, tokens[0].col, 1) };
    }
    return { operand: null, diagnostic: error("syntax", "Unterminated indirect operand.", lineNumber, tokens[0].col, 1) };
  }
  // Plain or indexed absolute/zero page: check trailing ,X or ,Y
  const last = tokens[tokens.length - 1];
  const secondLast = tokens[tokens.length - 2];
  if (tokens.length >= 2 && secondLast.type === "comma" && last.type === "ident") {
    const reg = last.value.toUpperCase();
    if (reg === "X" || reg === "Y") {
      const { expr, diagnostic } = parseExpression(tokens.slice(0, tokens.length - 2), lineNumber);
      if (diagnostic) return { operand: null, diagnostic };
      return { operand: { form: reg === "X" ? "indexX" : "indexY", expr }, diagnostic: null };
    }
  }
  const { expr, diagnostic } = parseExpression(tokens, lineNumber);
  if (diagnostic) return { operand: null, diagnostic };
  return { operand: { form: "plain", expr }, diagnostic: null };
}

function parseDirectiveArgs(name, tokens, lineNumber) {
  // Split tokens on top-level commas into argument token slices.
  const args = [];
  let current = [];
  let depth = 0;
  for (const tok of tokens) {
    if (tok.type === "lparen") depth += 1;
    if (tok.type === "rparen") depth -= 1;
    if (tok.type === "comma" && depth === 0) {
      args.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  if (current.length > 0 || args.length > 0) {
    args.push(current);
  }
  return args;
}

/**
 * Parse one line into a statement. Returns { statement, diagnostics }.
 * A statement may carry a `label` and is one of: empty, setpc, assign, instr, data.
 */
function parseLine(text, lineNumber) {
  const { tokens, diagnostic } = lexLine(text, lineNumber);
  if (diagnostic) {
    return { statement: null, diagnostics: [diagnostic] };
  }
  if (tokens.length === 0) {
    return { statement: { kind: "empty", line: lineNumber }, diagnostics: [] };
  }

  let idx = 0;
  let label = null;

  // '* =' sets the program counter.
  if (tokens[0].type === "star" && tokens[1] && tokens[1].type === "equals") {
    const { expr, diagnostic: d } = parseExpression(tokens.slice(2), lineNumber);
    if (d) return { statement: null, diagnostics: [d] };
    return { statement: { kind: "setpc", expr, line: lineNumber, col: tokens[0].col }, diagnostics: [] };
  }

  if (tokens[0].type === "ident") {
    const name = tokens[0].value;
    if (isMnemonic(name)) {
      // instruction without a label
    } else if (tokens[1] && tokens[1].type === "equals") {
      const { expr, diagnostic: d } = parseExpression(tokens.slice(2), lineNumber);
      if (d) return { statement: null, diagnostics: [d] };
      return {
        statement: { kind: "assign", name, nameCol: tokens[0].col, expr, line: lineNumber },
        diagnostics: [],
      };
    } else {
      // A leading identifier that is not a mnemonic is a label only when what follows can
      // begin a statement: end of line, a ':' , a directive, or a mnemonic. Otherwise it is
      // most likely a misspelled/unsupported instruction (e.g. `bra target`, `lax $10`) and
      // is reported as an unknown opcode against that identifier rather than being silently
      // absorbed as a label with a confusing downstream diagnostic.
      const next = tokens[1];
      const beginsStatement =
        !next ||
        next.type === "colon" ||
        next.type === "directive" ||
        (next.type === "ident" && isMnemonic(next.value));
      if (!beginsStatement) {
        return {
          statement: null,
          diagnostics: [error("unknown-opcode", `Unknown instruction '${name}'.`, lineNumber, tokens[0].col, name.length)],
        };
      }
      label = { name, col: tokens[0].col };
      idx = 1;
      if (tokens[idx] && tokens[idx].type === "colon") {
        idx += 1;
      }
    }
  }

  const rest = tokens.slice(idx);
  if (rest.length === 0) {
    return { statement: { kind: "empty", label, line: lineNumber }, diagnostics: [] };
  }

  const head = rest[0];
  if (head.type === "directive") {
    if (!DIRECTIVES.has(head.value)) {
      return { statement: null, diagnostics: [error("syntax", `Unknown directive '${head.value}'.`, lineNumber, head.col, head.value.length)] };
    }
    if (head.value === ".org") {
      const { expr, diagnostic: d } = parseExpression(rest.slice(1), lineNumber);
      if (d) return { statement: null, diagnostics: [d] };
      return { statement: { kind: "setpc", label, expr, line: lineNumber, col: head.col }, diagnostics: [] };
    }
    const args = parseDirectiveArgs(head.value, rest.slice(1), lineNumber);
    return {
      statement: { kind: "data", label, directive: head.value, argTokens: args, line: lineNumber, col: head.col },
      diagnostics: [],
    };
  }

  if (head.type === "ident") {
    if (!isMnemonic(head.value)) {
      return { statement: null, diagnostics: [error("unknown-opcode", `Unknown instruction '${head.value}'.`, lineNumber, head.col, head.value.length)] };
    }
    const { operand, diagnostic: d } = parseOperand(rest.slice(1), head.value, lineNumber);
    if (d) return { statement: null, diagnostics: [d] };
    return {
      statement: { kind: "instr", label, mnemonic: head.value, mnemCol: head.col, operand, line: lineNumber },
      diagnostics: [],
    };
  }

  return { statement: null, diagnostics: [error("syntax", "Expected an instruction or directive.", lineNumber, head.col, 1)] };
}

// ---------------------------------------------------------------------------
// Sizing and encoding helpers
// ---------------------------------------------------------------------------

function zeroPageForm(form) {
  return { plain: "zp", indexX: "zpx", indexY: "zpy" }[form];
}
function absoluteForm(form) {
  return { plain: "abs", indexX: "abx", indexY: "aby" }[form];
}

const BRANCH_MNEMONICS = new Set(["BPL", "BMI", "BVC", "BVS", "BCC", "BCS", "BNE", "BEQ"]);

// Determine the current size of an instruction, applying grow-only zero-page/absolute logic.
function instructionSize(stmt, ctx) {
  const mnem = stmt.mnemonic.toUpperCase();
  const table = OPCODES[mnem];
  const form = stmt.operand.form;
  if (form === "none" || form === "acc") return 1;
  if (form === "imm") return 2;
  if (form === "indX" || form === "indY") return 2;
  if (form === "indirect") return 3;
  if (BRANCH_MNEMONICS.has(mnem) && form === "plain") return 2;

  const zpMode = zeroPageForm(form);
  const absMode = absoluteForm(form);
  const hasZp = zpMode && table[zpMode] !== undefined;
  const hasAbs = absMode && table[absMode] !== undefined;
  if (!hasZp && !hasAbs) return 3; // invalid mode; reported during emit
  if (!hasZp) return 3;
  if (!hasAbs) return 2;

  if (stmt._forcedAbs) return 3;
  const evaluated = evaluateExpression(stmt.operand.expr, ctx, stmt.line);
  if (evaluated.diagnostic) return 2; // character error reported during emit
  if (evaluated.undefined) return 2; // unknown yet: assume zero page, may grow later
  if (evaluated.value > 0xff || evaluated.value < 0) {
    stmt._forcedAbs = true;
    return 3;
  }
  return 2;
}

function dataSize(stmt, ctx, diagnostics, requireDefined) {
  const dir = stmt.directive;
  if (dir === ".byte") {
    return stmt.argTokens.length;
  }
  if (dir === ".word") {
    return stmt.argTokens.length * 2;
  }
  if (dir === ".text") {
    let total = 0;
    for (const arg of stmt.argTokens) {
      if (arg.length === 1 && arg[0].type === "string") {
        const enc = encodePetsciiString(arg[0].value);
        total += enc.bytes.length;
      }
    }
    return total;
  }
  if (dir === ".fill") {
    const countEval = evaluateArg(stmt.argTokens[0], ctx, stmt.line, diagnostics, requireDefined);
    return Math.max(0, countEval);
  }
  if (dir === ".align") {
    const nEval = evaluateArg(stmt.argTokens[0], ctx, stmt.line, diagnostics, requireDefined);
    if (!Number.isInteger(nEval) || nEval < 1) return 0;
    const aligned = Math.ceil(ctx.pc / nEval) * nEval;
    return aligned - ctx.pc;
  }
  return 0;
}

function evaluateArg(argTokens, ctx, lineNumber, diagnostics, requireDefined) {
  if (!argTokens || argTokens.length === 0) return 0;
  const { expr, diagnostic } = parseExpression(argTokens, lineNumber);
  if (diagnostic) {
    if (requireDefined && diagnostics) diagnostics.push(diagnostic);
    return 0;
  }
  const evaluated = evaluateExpression(expr, ctx, lineNumber);
  if (evaluated.diagnostic) {
    if (requireDefined && diagnostics) diagnostics.push(evaluated.diagnostic);
    return 0;
  }
  if (evaluated.undefined && requireDefined && diagnostics) {
    diagnostics.push(error("undefined-symbol", `Undefined symbol '${evaluated.undefined.name}'.`, lineNumber, evaluated.undefined.col, evaluated.undefined.name.length));
  }
  return evaluated.value;
}

// ---------------------------------------------------------------------------
// Resolver + emitter
// ---------------------------------------------------------------------------

function assembleBody(source, initialPc) {
  const lines = source.split("\n");
  const statements = [];
  const parseDiagnostics = [];
  for (let i = 0; i < lines.length; i++) {
    const { statement, diagnostics } = parseLine(lines[i], i + 1);
    for (const d of diagnostics) parseDiagnostics.push(d);
    if (statement) statements.push(statement);
  }
  if (parseDiagnostics.length > 0) {
    return { ok: false, segments: [], symbols: [], diagnostics: parseDiagnostics };
  }

  // Duplicate-symbol detection (single scan, independent of layout passes).
  const dupDiagnostics = [];
  const seen = new Map();
  for (const stmt of statements) {
    const defs = [];
    if (stmt.label) defs.push({ name: stmt.label.name, col: stmt.label.col });
    if (stmt.kind === "assign") defs.push({ name: stmt.name, col: stmt.nameCol });
    for (const def of defs) {
      const key = def.name.toLowerCase();
      if (seen.has(key)) {
        dupDiagnostics.push(error("duplicate-symbol", `Duplicate symbol '${def.name}'.`, stmt.line, def.col, def.name.length));
      } else {
        seen.set(key, true);
      }
    }
  }

  // Layout fixpoint: recompute addresses/sizes until BOTH the size vector and every symbol
  // value stabilize. The symbol table PERSISTS across passes (each pass is seeded with the
  // previous pass's values) so a forward reference resolves to its prior-pass address during
  // sizing; combined with the grow-only zero-page/absolute decision this converges and keeps
  // the emission-pass sizes identical to the converged layout. Rebuilding an empty table each
  // pass would leave forward references permanently unresolved during sizing and silently
  // emit wrong operands and sizes.
  // Forward-declared symbol values propagate at most one dependency link per pass, and each
  // zero-page/absolute instruction can grow its width at most once (grow-only). A generous
  // linear bound therefore lets every valid acyclic program converge while still terminating
  // on genuinely circular definitions (which never stabilize) with a phase-error.
  const maxPasses = statements.length * 3 + 64;
  const symbols = new Map();
  let previousVector = null;
  let previousSnapshot = null;
  let converged = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    let pc = initialPc;
    const vector = [];
    const scratch = { pc, symbols };
    for (const stmt of statements) {
      scratch.pc = pc;
      if (stmt.label) {
        symbols.set(stmt.label.name.toLowerCase(), { name: stmt.label.name, value: pc });
      }
      if (stmt.kind === "assign") {
        const evaluated = evaluateExpression(stmt.expr, scratch, stmt.line);
        const previous = symbols.get(stmt.name.toLowerCase());
        symbols.set(stmt.name.toLowerCase(), {
          name: stmt.name,
          // Keep the prior-pass value when this pass cannot yet resolve the expression, so a
          // symbol assigned from a forward reference converges instead of flapping to zero.
          value: evaluated.undefined ? (previous ? previous.value : undefined) : evaluated.value,
        });
        vector.push(0);
      } else if (stmt.kind === "setpc") {
        const evaluated = evaluateExpression(stmt.expr, scratch, stmt.line);
        pc = evaluated.undefined ? pc : evaluated.value & 0xffff;
        vector.push(0x10000 + pc);
      } else if (stmt.kind === "instr") {
        const size = instructionSize(stmt, scratch);
        vector.push(size);
        pc += size;
      } else if (stmt.kind === "data") {
        const size = dataSize(stmt, scratch, null, false);
        vector.push(size);
        pc += size;
      } else {
        vector.push(0);
      }
    }
    const snapshot = [...symbols.entries()]
      .map(([key, entry]) => `${key}=${entry.value === undefined ? "?" : entry.value}`)
      .sort()
      .join(";");
    if (
      previousVector &&
      vector.length === previousVector.length &&
      vector.every((v, k) => v === previousVector[k]) &&
      snapshot === previousSnapshot
    ) {
      converged = true;
      break;
    }
    previousVector = vector;
    previousSnapshot = snapshot;
  }

  const diagnostics = [...dupDiagnostics];
  if (!converged) {
    diagnostics.push(error("phase-error", "Assembly layout did not converge (unstable forward references).", 1, 1, 0));
    return { ok: false, segments: [], symbols: [], diagnostics: sortDiagnostics(diagnostics) };
  }

  // Final emission pass with full validation. emitCtx.pc is the LIVE program counter: pushByte
  // and setPc keep it current so `*` (the current-location operator) resolves to the exact
  // address of each emitted element, including successive values inside a single .byte/.word.
  const segments = [];
  let currentSegment = null;
  const emitCtx = { pc: initialPc, symbols };

  const pushByte = (b) => {
    if (currentSegment && currentSegment.start + currentSegment.bytes.length === emitCtx.pc) {
      currentSegment.bytes.push(b & 0xff);
    } else {
      currentSegment = { start: emitCtx.pc, bytes: [b & 0xff] };
      segments.push(currentSegment);
    }
    emitCtx.pc += 1;
  };
  const setPc = (addr) => {
    emitCtx.pc = addr & 0xffff;
    currentSegment = null;
  };

  for (const stmt of statements) {
    if (stmt.kind === "empty") {
      continue;
    }
    if (stmt.kind === "assign") {
      // Validate the right-hand side so an unsupported character, undefined symbol, or syntax
      // error in an assignment is reported rather than silently assembling to a stale value.
      const evaluated = evaluateExpression(stmt.expr, emitCtx, stmt.line);
      if (evaluated.diagnostic) {
        diagnostics.push(evaluated.diagnostic);
      } else if (evaluated.undefined) {
        diagnostics.push(error("undefined-symbol", `Undefined symbol '${evaluated.undefined.name}'.`, stmt.line, evaluated.undefined.col, evaluated.undefined.name.length));
      }
      continue;
    }
    if (stmt.kind === "setpc") {
      const evaluated = evaluateExpression(stmt.expr, emitCtx, stmt.line);
      if (evaluated.diagnostic) {
        diagnostics.push(evaluated.diagnostic);
        continue;
      }
      if (evaluated.undefined) {
        diagnostics.push(error("undefined-symbol", `Undefined symbol '${evaluated.undefined.name}'.`, stmt.line, evaluated.undefined.col, evaluated.undefined.name.length));
        continue;
      }
      if (evaluated.value < 0 || evaluated.value > 0xffff) {
        diagnostics.push(error("range", `Origin address ${evaluated.value} is outside 0..$FFFF.`, stmt.line, stmt.col, 1));
        continue;
      }
      setPc(evaluated.value);
      continue;
    }
    if (stmt.kind === "instr") {
      emitInstruction(stmt, emitCtx, diagnostics, pushByte);
      continue;
    }
    if (stmt.kind === "data") {
      emitData(stmt, emitCtx, diagnostics, pushByte, setPc);
      continue;
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, segments: [], symbols: [], diagnostics: sortDiagnostics(diagnostics) };
  }

  const symbolList = [...symbols.values()]
    .filter((s) => s.value !== undefined)
    .map((s) => ({ name: s.name, value: s.value }))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));

  return { ok: true, segments, symbols: symbolList, diagnostics: [] };
}

function emitInstruction(stmt, ctx, diagnostics, pushByte) {
  const mnem = stmt.mnemonic.toUpperCase();
  const table = OPCODES[mnem];
  const form = stmt.operand.form;

  if (form === "none") {
    if (table.imp !== undefined) {
      pushByte(table.imp);
      return;
    }
    if (table.acc !== undefined) {
      pushByte(table.acc);
      return;
    }
    diagnostics.push(error("invalid-addressing-mode", `${mnem} requires an operand.`, stmt.line, stmt.mnemCol, mnem.length));
    return;
  }
  if (form === "acc") {
    if (table.acc !== undefined) {
      pushByte(table.acc);
      return;
    }
    diagnostics.push(error("invalid-addressing-mode", `${mnem} does not support accumulator addressing.`, stmt.line, stmt.mnemCol, mnem.length));
    return;
  }

  const evaluated = evaluateExpression(stmt.operand.expr, ctx, stmt.line);
  if (evaluated.diagnostic) {
    diagnostics.push(evaluated.diagnostic);
    return;
  }
  if (evaluated.undefined) {
    diagnostics.push(error("undefined-symbol", `Undefined symbol '${evaluated.undefined.name}'.`, stmt.line, evaluated.undefined.col, evaluated.undefined.name.length));
    return;
  }
  const value = evaluated.value;

  if (form === "imm") {
    if (table.imm === undefined) {
      diagnostics.push(error("invalid-addressing-mode", `${mnem} does not support immediate addressing.`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    if (value < 0 || value > 0xff) {
      diagnostics.push(error("range", `Immediate value ${value} does not fit in one byte.`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    pushByte(table.imm);
    pushByte(value);
    return;
  }

  if (BRANCH_MNEMONICS.has(mnem) && form === "plain") {
    // The 6502 program counter is 16-bit and the branch offset is added to the (wrapped)
    // address of the following instruction, so compute the displacement modulo $10000 and
    // normalize it into the signed 8-bit range. This lets branches that legitimately cross
    // the $FFFF/$0000 boundary encode correctly instead of reporting a spurious range error.
    const next = (ctx.pc + 2) & 0xffff;
    let delta = (value - next) & 0xffff;
    if (delta >= 0x8000) {
      delta -= 0x10000;
    }
    if (delta < -128 || delta > 127) {
      diagnostics.push(error("branch-range", `Branch target out of range (${delta} bytes).`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    pushByte(table.rel);
    pushByte(delta & 0xff);
    return;
  }

  if (form === "indirect") {
    if (table.ind === undefined) {
      diagnostics.push(error("invalid-addressing-mode", `${mnem} does not support indirect addressing.`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    if (value < 0 || value > 0xffff) {
      diagnostics.push(error("range", `Address ${value} is outside 0..$FFFF.`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    pushByte(table.ind);
    pushByte(value & 0xff);
    pushByte((value >> 8) & 0xff);
    return;
  }

  if (form === "indX" || form === "indY") {
    const mode = form === "indX" ? "izx" : "izy";
    if (table[mode] === undefined) {
      diagnostics.push(error("invalid-addressing-mode", `${mnem} does not support this indirect mode.`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    if (value < 0 || value > 0xff) {
      diagnostics.push(error("range", `Indirect base ${value} must be a zero-page address.`, stmt.line, stmt.mnemCol, mnem.length));
      return;
    }
    pushByte(table[mode]);
    pushByte(value);
    return;
  }

  // plain / indexX / indexY: choose zero page or absolute (grow-only decision already made)
  const zpMode = zeroPageForm(form);
  const absMode = absoluteForm(form);
  const hasZp = zpMode && table[zpMode] !== undefined;
  const hasAbs = absMode && table[absMode] !== undefined;
  if (!hasZp && !hasAbs) {
    diagnostics.push(error("invalid-addressing-mode", `${mnem} does not support this addressing mode.`, stmt.line, stmt.mnemCol, mnem.length));
    return;
  }
  if (value < 0 || value > 0xffff) {
    diagnostics.push(error("range", `Address ${value} is outside 0..$FFFF.`, stmt.line, stmt.mnemCol, mnem.length));
    return;
  }
  const useZp = hasZp && !stmt._forcedAbs && value <= 0xff;
  if (useZp) {
    pushByte(table[zpMode]);
    pushByte(value);
    return;
  }
  if (!hasAbs) {
    diagnostics.push(error("range", `Value ${value} does not fit in a zero-page-only instruction.`, stmt.line, stmt.mnemCol, mnem.length));
    return;
  }
  pushByte(table[absMode]);
  pushByte(value & 0xff);
  pushByte((value >> 8) & 0xff);
}

function emitData(stmt, ctx, diagnostics, pushByte, setPc) {
  const dir = stmt.directive;
  if (dir === ".byte" || dir === ".word") {
    if (stmt.argTokens.length === 0 || (stmt.argTokens.length === 1 && stmt.argTokens[0].length === 0)) {
      diagnostics.push(error("syntax", `${dir} requires at least one value.`, stmt.line, stmt.col, dir.length));
      return;
    }
    for (const arg of stmt.argTokens) {
      const { expr, diagnostic } = parseExpression(arg, stmt.line);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      const evaluated = evaluateExpression(expr, ctx, stmt.line);
      if (evaluated.diagnostic) {
        diagnostics.push(evaluated.diagnostic);
        continue;
      }
      if (evaluated.undefined) {
        diagnostics.push(error("undefined-symbol", `Undefined symbol '${evaluated.undefined.name}'.`, stmt.line, evaluated.undefined.col, evaluated.undefined.name.length));
        continue;
      }
      const value = evaluated.value;
      if (dir === ".byte") {
        if (value < 0 || value > 0xff) {
          diagnostics.push(error("range", `Byte value ${value} is outside 0..255.`, stmt.line, arg[0] ? arg[0].col : stmt.col, 1));
          continue;
        }
        pushByte(value);
      } else {
        if (value < 0 || value > 0xffff) {
          diagnostics.push(error("range", `Word value ${value} is outside 0..65535.`, stmt.line, arg[0] ? arg[0].col : stmt.col, 1));
          continue;
        }
        pushByte(value & 0xff);
        pushByte((value >> 8) & 0xff);
      }
    }
    return;
  }
  if (dir === ".text") {
    if (stmt.argTokens.length === 0) {
      diagnostics.push(error("syntax", ".text requires a string.", stmt.line, stmt.col, 5));
      return;
    }
    for (const arg of stmt.argTokens) {
      if (arg.length !== 1 || arg[0].type !== "string") {
        diagnostics.push(error("syntax", ".text arguments must be string literals.", stmt.line, arg[0] ? arg[0].col : stmt.col, 1));
        continue;
      }
      const enc = encodePetsciiString(arg[0].value);
      if (!enc.ok) {
        diagnostics.push(error("unsupported-character", `Character '${enc.badChar}' has no PETSCII representation.`, stmt.line, arg[0].col + 1 + enc.badIndex, 1));
        continue;
      }
      for (const b of enc.bytes) pushByte(b);
    }
    return;
  }
  if (dir === ".fill") {
    if (stmt.argTokens.length < 1) {
      diagnostics.push(error("syntax", ".fill requires a count.", stmt.line, stmt.col, 5));
      return;
    }
    if (stmt.argTokens.length > 2) {
      diagnostics.push(error("syntax", ".fill takes at most a count and a fill value.", stmt.line, stmt.col, 5));
      return;
    }
    const count = evaluateArg(stmt.argTokens[0], ctx, stmt.line, diagnostics, true);
    let fillValue = 0;
    if (stmt.argTokens.length >= 2) {
      fillValue = evaluateArg(stmt.argTokens[1], ctx, stmt.line, diagnostics, true);
    }
    if (!Number.isInteger(count) || count < 0 || count > MEMORY_TOP) {
      diagnostics.push(error("range", `.fill count ${count} is out of range.`, stmt.line, stmt.col, 5));
      return;
    }
    if (fillValue < 0 || fillValue > 0xff) {
      diagnostics.push(error("range", `.fill value ${fillValue} is outside 0..255.`, stmt.line, stmt.col, 5));
      return;
    }
    for (let i = 0; i < count; i++) pushByte(fillValue);
    return;
  }
  if (dir === ".align") {
    if (stmt.argTokens.length < 1) {
      diagnostics.push(error("syntax", ".align requires an alignment.", stmt.line, stmt.col, 6));
      return;
    }
    if (stmt.argTokens.length > 1) {
      diagnostics.push(error("syntax", ".align takes a single alignment value.", stmt.line, stmt.col, 6));
      return;
    }
    const n = evaluateArg(stmt.argTokens[0], ctx, stmt.line, diagnostics, true);
    if (!Number.isInteger(n) || n < 1) {
      diagnostics.push(error("range", `.align value ${n} must be a positive integer.`, stmt.line, stmt.col, 6));
      return;
    }
    const aligned = Math.ceil(ctx.pc / n) * n;
    // The program counter must not wrap past the top of memory. setPc masks to 16 bits, so an
    // alignment that would advance beyond $FFFF is rejected rather than silently wrapping to
    // $0000 (which would reorder the image).
    if (aligned > 0xffff) {
      diagnostics.push(error("range", `.align advances past $FFFF (to $${aligned.toString(16)}).`, stmt.line, stmt.col, 6));
      return;
    }
    setPc(aligned);
    return;
  }
}

// ---------------------------------------------------------------------------
// Image + PRG serialization
// ---------------------------------------------------------------------------

/**
 * Combine emitted segments into a contiguous memory image based at loadAddress. Gaps between
 * segments are filled with $00; overlaps and out-of-range bytes are errors.
 * @returns {{ ok: boolean, prg: Uint8Array|null, diagnostics: object[] }}
 */
function serializePrg(loadAddress, segments) {
  const nonEmpty = segments.filter((s) => s.bytes.length > 0);
  if (nonEmpty.length === 0) {
    return { ok: false, prg: null, diagnostics: [error("empty-output", "Assembly produced no output bytes.", 1, 1, 0)] };
  }
  const sorted = [...nonEmpty].sort((a, b) => a.start - b.start);
  let minAddr = sorted[0].start;
  let maxEnd = 0;
  for (const seg of sorted) {
    maxEnd = Math.max(maxEnd, seg.start + seg.bytes.length);
  }
  if (minAddr < loadAddress) {
    return {
      ok: false,
      prg: null,
      diagnostics: [error("range", `Emitted byte at $${minAddr.toString(16)} is below the load address $${loadAddress.toString(16)}.`, 1, 1, 0)],
    };
  }
  if (maxEnd > MEMORY_TOP) {
    return { ok: false, prg: null, diagnostics: [error("range", `Assembly extends past $FFFF (ends at $${maxEnd.toString(16)}).`, 1, 1, 0)] };
  }
  // Overlap detection on the sorted segments.
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].start + sorted[i - 1].bytes.length;
    if (sorted[i].start < prevEnd) {
      return { ok: false, prg: null, diagnostics: [error("overlap", `Overlapping output at $${sorted[i].start.toString(16)}.`, 1, 1, 0)] };
    }
  }
  const imageLength = maxEnd - loadAddress;
  const prg = new Uint8Array(2 + imageLength);
  prg[0] = loadAddress & 0xff;
  prg[1] = (loadAddress >> 8) & 0xff;
  for (const seg of sorted) {
    const offset = 2 + (seg.start - loadAddress);
    for (let k = 0; k < seg.bytes.length; k++) {
      prg[offset + k] = seg.bytes[k];
    }
  }
  return { ok: true, prg, diagnostics: [] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function failure(diagnostics) {
  return {
    ok: false,
    prg: null,
    loadAddress: null,
    runAddress: null,
    symbols: [],
    diagnostics: sortDiagnostics(diagnostics),
    buildId: null,
  };
}

/**
 * Assemble a source project into an AssemblyResult. Never throws for source errors: failures
 * are returned as diagnostics with a null PRG. Unexpected internal faults are surfaced as an
 * `internal` diagnostic rather than an empty successful artifact.
 * @param {object} rawProject
 */
export function assemble(rawProject) {
  try {
    const validation = validateProject(rawProject);
    if (!validation.ok) {
      return failure(validation.diagnostics);
    }
    const project = validation.project;

    if (project.runMode === "direct") {
      const body = assembleBody(project.source, project.loadAddress);
      if (!body.ok) {
        return failure(body.diagnostics);
      }
      const serialized = serializePrg(project.loadAddress, body.segments);
      if (!serialized.ok) {
        return failure(serialized.diagnostics);
      }
      return success(project, serialized.prg, project.loadAddress, project.runAddress, body.symbols);
    }

    // basic-sys
    if (project.loadAddress !== BASIC_LOAD_ADDRESS) {
      return failure([error("invalid-project", `basic-sys mode requires load address $0801 (got $${project.loadAddress.toString(16)}).`)]);
    }
    const defaultOrigin = defaultBasicCodeOrigin();
    const body = assembleBody(project.source, defaultOrigin);
    if (!body.ok) {
      return failure(body.diagnostics);
    }
    const nonEmpty = body.segments.filter((s) => s.bytes.length > 0);
    if (nonEmpty.length === 0) {
      return failure([error("empty-output", "Assembly produced no output bytes.", 1, 1, 0)]);
    }
    const firstAddr = nonEmpty.reduce((min, s) => Math.min(min, s.start), Infinity);
    const runAddress = firstAddr;
    const stubEnd = BASIC_LOAD_ADDRESS + basicSysStubLength(runAddress);
    if (firstAddr < stubEnd) {
      return failure([error("overlap", `Machine code at $${firstAddr.toString(16)} overlaps the BASIC stub (ends at $${stubEnd.toString(16)}).`, 1, 1, 0)]);
    }
    const stub = buildBasicSysStub(runAddress);
    const stubSegment = { start: BASIC_LOAD_ADDRESS, bytes: Array.from(stub) };
    const serialized = serializePrg(BASIC_LOAD_ADDRESS, [stubSegment, ...body.segments]);
    if (!serialized.ok) {
      return failure(serialized.diagnostics);
    }
    return success(project, serialized.prg, BASIC_LOAD_ADDRESS, runAddress, body.symbols);
  } catch (err) {
    return failure([error("internal", `Internal assembler error: ${err && err.message ? err.message : String(err)}`)]);
  }
}

function success(project, prg, loadAddress, runAddress, symbols) {
  return {
    ok: true,
    prg,
    loadAddress,
    runAddress,
    symbols,
    diagnostics: [],
    buildId: computeBuildId(project, prg),
  };
}

// Exposed for focused unit tests.
export { assembleBody, serializePrg };
