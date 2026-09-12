# Lima for VS Code

Syntax highlighting and live diagnostics for [Lima](https://limaformat.dev)
— the small, specified frontmatter format.

## What it does

### Highlighting

- **`.lima` files** — a full TextMate grammar: keys, comments, block (`-`)
  and flow (`[ ]`, `{ }`) collections, `|` literal block scalars and `^^`
  continuation lines, scalar types (string, number, boolean, null, date in
  ISO 8601 / `DD.MM.YYYY` / `DD/MM/YYYY` form), and single/double-quoted
  strings with their real escape rules.
- **References 2.0 tokens** — `${document.path}` and `$(partial.path)` are
  highlighted where they are active (unquoted scalars, flow values); they
  stay literal inside quoted strings, matching the spec.
- **Markdown / MDX frontmatter** — the `---` … `---` block at the top of a
  `.md` or `.mdx` file is highlighted as Lima.

### Diagnostics

The real Lima parser runs as you type — over `.lima` files and the
frontmatter block of Markdown / MDX — and reports the specification's own
diagnostics: duplicate keys, invalid dates, unknown escape sequences,
unterminated strings, bad flow syntax, resource-limit violations, and the
rest, each with its diagnostic code.

Checking is **strict by default** (an editor is where you want that
feedback). Settings:

| Setting | Default | |
|---|---|---|
| `lima.diagnostics.enable` | `true` | Turn diagnostics on/off. |
| `lima.diagnostics.strict` | `true` | Strict mode. Off = match a non-strict runtime, which coerces instead of erroring. |
| `lima.diagnostics.ignoreUnresolvedReferences` | `true` | Suppress unresolved-reference / partial findings — the editor has no cross-file or `partials` context. |

## Not part of Lima (and so not highlighted)

- `>` folded block scalars — use `|` plus `^^`.
- YAML anchors, aliases, tags, merge keys, directives, multi-document
  streams.
- References **1.0** `($key)` / `(%key)` syntax — in References 2.0 these
  are ordinary string content.

## Development

```sh
bun install         # also builds dist/ (via the `prepare` script)
bun test            # grammar scopes + diagnostic findings
bunx tsc --noEmit   # typecheck src/
bun run build       # rebuild dist/extension.js
bun run watch       # rebuild on change
```

`dist/` is a build artifact and is git-ignored. `bun install` regenerates
it through the `prepare` script, so a fresh checkout (or a `git clean`)
plus `bun install` leaves a working extension. `bun run watch` while
developing.

The parser is bundled from `../../js/src` so the checker and the published
`@limaformat/lima` package never drift. Grammar lives in `syntaxes/`.

## License

ISC — see [LICENSE](./LICENSE). Part of the
[limaformat/lima](https://github.com/limaformat/lima) monorepo
(`editors/vscode`).
