# Changelog

## [0.1.0] — unreleased

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
