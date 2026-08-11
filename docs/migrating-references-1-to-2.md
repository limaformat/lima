# Migrating Lima References 1.0 to 2.0

References 2.0 changes reference syntax and makes `parse` the primary public
entry point. Lima Core 1.0 is unchanged.

## Syntax

| References 1.0 | References 2.0 |
|---|---|
| `($site.title)` | `$(site.title)` |
| `(%author)` | `$(:author)` |

References 1.0 tokens are ordinary literal strings in References 2.0. They are
not deprecated aliases, so migrate every active token before switching parser
versions. Quoted strings and mapping keys remain literal in both versions.

## Partials

References 1.0 partials are selected by a flat name. References 2.0 additionally
allows mapping traversal after the partial name:

```lima
authorName: $(:author.name)
city: $(:people/alice.address.city)
```

```ts
const partials = {
  author: { name: 'Ada' },
  'people/alice': { address: { city: 'London' } },
}
```

The first dot separates the partial name from its mapping path. A slash is
literal namespace content in the partial name. Dots are therefore not valid
inside partial names themselves. Strings stored in partials remain inert and
are never evaluated as references.

## Reference chains

References 1.0 uses one-hop resolution. References 2.0 resolves transitively,
with at most three reference edges for each source token:

```lima
a: $(b)
b: $(c)
c: $(d)
d: 42
```

Here all four values become `42`. A source requiring a fourth edge remains
literal in non-strict mode and throws an unresolved-reference error in strict
mode. A shorter suffix of the same chain may still resolve.

## API

Use `parse` for References 2.0:

```ts
import { parse, parseCore } from '@limaformat/lima'

const metadata = parse(input, { partials })
const coreOnly = parseCore(input)
```

`parseReferences` remains available during the 2.x specification line as a
deprecated compatibility alias to `parse`. It has References 2.0 semantics; it
does not select References 1.0.

To use the primary function while explicitly disabling References:

```ts
parse(input, { mode: 'core' })
```

This uses the same reference-unaware path as `parseCore`. Do not provide
`partials` together with `mode: 'core'`.

## Migration checklist

1. Replace active `($path)` tokens with `$(path)`.
2. Replace active `(%name)` tokens with `$(:name)`.
3. Check whether any former one-hop chains now resolve transitively and change
   the resulting value.
4. Ensure every partial name follows the 2.0 grammar and contains no dot.
5. Replace new uses of `parseReferences` with `parse`.
6. Run the application test suite in strict mode to expose missing targets,
   cycles, and chains exceeding three edges.

See the [References 2.0 specification](lima-references-2.0-spec.md) for the
normative rules and the [guide](guide.md#references-optional-extension) for a
practical walkthrough.
