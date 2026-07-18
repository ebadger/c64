# c64 examples

Canonical assembler examples for the deterministic source-to-artifact pipeline. Each example
is source-only and rebuilds byte-identical PRG and D64 artifacts; no Commodore ROM bytes are
required or included.

## Layout

Each example is a directory containing:

- `source.asm` — the NMOS 6510 assembly source (the human-editable canonical copy).
- `project.json` — the `SourceProject` settings (everything except `source`).
- `expected.json` — the recorded golden expectations (`buildId`, PRG/D64 lengths and SHA-256
  digests, load/run addresses, and download names).

`load-example.mjs` composes `project.json` + `source.asm` into a full project.

## Rebuild and verify

```sh
node examples/build-example.mjs          # verify every example matches its expected.json
node examples/build-example.mjs --write  # regenerate expected.json after an intended change
```

`node scripts/dev/run-node-tests.mjs tests` also asserts each example against its committed golden
vectors and runs the full `source -> PRG -> D64 -> extracted PRG` round-trip.

## Examples

- `border-flash/` — a small border-colour cycler that exercises symbol assignment, zero-page
  vs absolute selection, immediate operands, absolute,X indexing, a relative branch, a
  forward-referenced subroutine call, and the `.byte`, `.text`, and `.word` directives in
  basic-sys run mode.
