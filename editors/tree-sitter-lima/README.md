# tree-sitter-lima

Tree-sitter grammar for Lima Core 1.0 plus active References 2.0 tokens.
It is an editor-highlighting parser: reference resolution, strict-mode
diagnostics, hover, and go-to-definition remain LSP responsibilities.

## Syntax nodes

The grammar exposes block mappings and sequences, flow mappings and
sequences, block scalars and continuations, comments, quoted and plain
strings, keys, nulls, booleans, numbers, dates, escapes, and active
`document_reference` / `partial_reference` leaves. Reference-like text in
quoted strings and keys stays literal.

`src/scanner.c` implements indentation, block-scalar boundaries, tolerant
fallbacks, and scalar classification. Reference token character classes in
`grammar.js` mirror `js/src/reference-tokens2.ts`, the repository's canonical
source.

## Development

Requires Bun and a C compiler.

```sh
bun install --frozen-lockfile
bun run ci
```

`bun run corpus:check` materializes all 347 fixtures in `corpus/core` and
`corpus/references-2.0`, including generator-backed limit fixtures. Successful
and semantic-only cases must have no `ERROR`/`MISSING`; syntax-error fixtures
may use tolerant recovery, but any emitted error must start on the fixture's
expected line.

`scripts/gen-corpus.ts` converts 15 selected real fixtures into native
`test/corpus/generated.txt` cases using manually maintained structural
expectations. It never derives expected trees from the parser under test.

The single `queries/highlights.scm` uses capture names shared by Neovim,
Helix, and Zed. `bun run query:check` compiles it and verifies representative
captures.

## Local editor integration

Until Phase 2b pins a real commit, keep integration configuration outside the
tracked tree:

- Neovim: register `install_info.path` as this directory, generate/install the
  parser as `lima`, and copy `queries/highlights.scm` to a temporary runtime's
  `queries/lima/highlights.scm`.
- Helix: add a temporary `[[grammar]]` entry whose `source.path` is this
  directory and copy the query into that temporary runtime's
  `queries/lima/highlights.scm` before `hx --grammar build`.
- Zed: copy `editors/zed` outside the repository, change only that copy to use
  a `[grammars.lima]` entry with `path = "editors/tree-sitter-lima"`, set the
  language grammar to `lima`, and add the query beside its language config.

The production registrations and commit/revision pins are intentionally
deferred to Phase 2b.
