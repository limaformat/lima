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

`bun run corpus:check` materializes every fixture in `corpus/core`,
`corpus/core-1.1` and `corpus/references-2.0`, including generator-backed
limit fixtures. Successful
and semantic-only cases must have no `ERROR`/`MISSING`; syntax-error fixtures
may use tolerant recovery, but any emitted error must start on the fixture's
expected line.

`scripts/gen-corpus.ts` converts selected real fixtures into native
`test/corpus/generated.txt` cases using manually maintained structural
expectations. It never derives expected trees from the parser under test.

The single `queries/highlights.scm` uses capture names shared by Neovim,
Helix, and Zed. `bun run query:check` compiles it and verifies representative
captures.

## Editor integration

This grammar is registered against real, published commit pins — see
[`editors/lsp/README.md`](../lsp/README.md#syntax-highlighting) for the
Neovim (`main` and frozen `master` branches) and Helix setup, and
[`editors/zed/`](../zed/) for the Zed extension, which pins this directory
directly in its `extension.toml`.

For local development on the grammar itself (before a change is committed
and has a real commit to pin), point an editor at this directory instead of
a git URL: Neovim's `install_info.path`, Helix's `source.path`, or a
temporarily patched Zed extension copy with a `[grammars.lima]` entry whose
`path` is this directory — the same approach used to develop and test this
grammar in the first place.
