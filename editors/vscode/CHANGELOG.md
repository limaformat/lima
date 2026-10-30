# Changelog

## [0.3.0] — 2026-10-30

Highlighting and diagnostics follow Lima Core 1.2 and References 2.1: the
bundled parser is that of `@limaformat/lima` 0.7.0.

- Keys in any script and gendered keys (`größe`, `題名`, `autor*in`,
  `autor·in`) are highlighted and read as keys, and so are references to them
  (`${größe}`); the grammar uses the editor's Unicode classes (README).
- A document with a lone surrogate is reported as `INVALID_DOCUMENT`; new
  hints name whitespace other than spaces before a key and a FULLWIDTH COLON
  in place of `: `.

The minimum is now VS Code 1.82. Its extension host moved to Electron 25
(Chromium 114 / V8 11.4), which provides `String.prototype.isWellFormed()`;
the bundled parser uses that method to reject invalid Unicode scalar values.
See the official [VS Code 1.82 Electron update][vscode-1.82] and
[Electron 25 release notes][electron-25].

[vscode-1.82]: https://code.visualstudio.com/updates/v1_82#_electron-25-update
[electron-25]: https://www.electronjs.org/blog/electron-25-0

## [0.2.0] — 2026-10-28

Diagnostics follow Lima Core 1.1: the bundled parser is that of
`@limaformat/lima` 0.6.0, which reads strictly, as the extension does.

- A line that belongs to no structure is reported where it stands: one
  indented after a value, which opens no block (the lines after a YAML `>`,
  `|-` or `|+`, a key indented by a tab), and an unrecognised line — a key
  without its `: `, an invalid key, a YAML `---` / `...` marker — as
  `UNRECOGNIZED_LINE`. The message names a YAML marker and what Lima writes
  instead.
- A sequence at its key's own column (`tags:` / `- a`), as YAML writes it,
  is a sequence, not an error.
- Indentation is spaces only: a line indented by other whitespace, such as a
  pasted U+00A0, is reported.
- An object item's later keys stand at its first key's column; another
  column is reported.

## [0.1.0] — 2026-09-14

Adopted into the `limaformat/lima` monorepo (`editors/vscode`) from its
earlier home. Publisher is now `limaformat`; the license is ISC, matching
the rest of the project.

### Grammar rewrite for the current specs

- References **2.0**: `${document.path}` and `$(partial.path)` are
  recognised as reference tokens (unquoted scalars and flow values only —
  literal inside quoted strings). The old `($key)` / `(%key)` References
  1.0 highlighting is removed; those are ordinary strings in 2.0.
- Block scalars: only `|` is a marker. `>` (folded) is not part of Lima
  and is no longer treated as one.
- `^^` continuation lines are matched at the start of the line, per
  Lima Core §6.1.6 (previously matched at end of line).
- Double-quoted strings: the escape set matches §6.1.2 exactly (`\0` is
  not valid and is now flagged); an unknown `\x` is marked
  `invalid.illegal`.
- Single-quoted strings: `\'` is the one escape and `\\` is a literal
  two-character run, per §6.1.3.
- Dates also match ISO 8601 with an explicit `Z`/offset.

### Added

- **Live diagnostics.** The Lima parser (bundled from the monorepo source,
  so it never drifts from the published package) runs on `.lima` files and
  Markdown / MDX frontmatter as you type and reports the spec's diagnostics
  — duplicate keys, invalid dates, unknown escapes, unterminated strings,
  bad flow syntax, resource limits — each with its code. Strict by default;
  configurable via `lima.diagnostics.*`.
- Markdown / MDX frontmatter injection: the leading `---` … `---` block is
  highlighted as Lima.
- Tests: `test/grammar.test.ts` (scope assertions via `vscode-textmate`)
  and `test/diagnostics.test.ts` (findings from the bundled parser). An
  esbuild bundle step and a `tsc` typecheck run in CI.
