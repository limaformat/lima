# tree-sitter-lima

Tree-sitter grammar for Lima Core <!-- facts:language.core_version -->1.3<!-- /facts --> plus active References <!-- facts:language.references_version -->2.1<!-- /facts --> tokens.
It is an editor-highlighting parser: reference resolution, strict-mode
diagnostics, hover, and go-to-definition remain LSP responsibilities.

## Syntax nodes

The grammar exposes block mappings and sequences, flow mappings and
sequences, block scalars and continuations, comments, quoted and plain
strings, keys, nulls, booleans, numbers, dates, escapes, and active
`document_reference` / `partial_reference` leaves. Reference-like text in
quoted strings and keys stays literal.

A `#` is a `comment` only at the start of a line or a value or after
whitespace, as Core 1.3 reads it: `https://example.org/x#top`, `\#x` and
`[a,#x]` keep their `#` as text, and `key: # note` is a key with a comment,
whose block may follow. A comment inside a flow collection, as in
`[a, #x]`, leaves it unclosed: the value is a `plain_scalar` up to the
comment. A tab after a key's colon separates key and value as a space does.

`src/scanner.c` implements indentation, block-scalar boundaries, tolerant
fallbacks, scalar classification, and exact Unicode <!-- facts:language.unicode_version -->18.0<!-- /facts --> block-key checks via
the generated `src/unicode_key_table.h`. Tree-sitter regexes use `\p{L}`,
`\p{M}`, and `\p{N}` for flow keys and References <!-- facts:language.references_version -->2.1<!-- /facts --> tokens; those regexes
follow the Unicode version embedded in the installed Tree-sitter generator,
which may differ at newly assigned code points from Core's fixed Unicode <!-- facts:language.unicode_version -->18.0<!-- /facts -->.
Because Tree-sitter regexes have no lookahead, a colon-bearing flow key is
written as non-empty colon-separated parts; consecutive or final colons in a
flow key are the one syntax-highlighting approximation. Block keys remain
exact.

## Development

Requires Bun and a C compiler.

```sh
bun install --frozen-lockfile
bun run ci
```

`bun run corpus:check` materializes every fixture in `corpus/core`,
`corpus/core-1.1`, `corpus/core-1.2`, `corpus/core-1.3`,
`corpus/references-2.0`, and `corpus/references-2.1`, including
generator-backed limit fixtures. Successful and semantic-only cases must
have no `ERROR`/`MISSING`; syntax-error fixtures may use tolerant recovery,
but any emitted error must start on the fixture's expected line.

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
