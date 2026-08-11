# @limaformat/lima

[![npm version](https://img.shields.io/npm/v/%40limaformat%2Flima.svg)](https://www.npmjs.com/package/@limaformat/lima)

**LIMA Is Metadata Annotation** — a small, predictable frontmatter format.
A deliberate, focused subset of YAML: the part frontmatter actually needs,
with well-defined types, no surprises, and zero runtime dependencies.

```bash
npm install @limaformat/lima
# or
bun add @limaformat/lima
```

```ts
import { parse } from '@limaformat/lima'

const result = parse(`
title: Hello World
published: 2024-03-01
draft: false
tags:
  - javascript
  - webdev
`)

// {
//   title: 'Hello World',
//   published: 2024-03-01T00:00:00.000Z,  // a Date
//   draft: false,
//   tags: ['javascript', 'webdev']
// }
```

`parse` accepts the raw content **between** the frontmatter delimiters
(`---`) — stripping them is the caller's job.

Three functions are exported:

- `parseCore(input, options?)` — the base format only.
- `parse(input, options?)` — the primary References 2.0 parser; adds
  `$(key)` document references and `$(:key)` external partials.
- `parseReferences(input, options?)` — deprecated compatibility alias for
  `parse` with the same References 2.0 semantics.

```ts
parse(frontmatter, { strict: true })
parse(frontmatter, { partials: { author: 'Alice' } })
parse(frontmatter, { mode: 'core' }) // same reference-unaware path as parseCore
```

The **[guide](https://github.com/limaformat/lima/blob/main/docs/guide.md)**
covers Core and References 2.0 syntax, resource limits, strict mode, and the
public API. The normative rules are defined in the
**[References 2.0 specification](https://github.com/limaformat/lima/blob/main/docs/lima-references-2.0-spec.md)**.

Why Lima exists, the case against YAML, and security rationale:
**[repository README](https://github.com/limaformat/lima#readme)**.

The [Lima Core 1.0](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References 2.0](https://github.com/limaformat/lima/blob/main/docs/lima-references-2.0-spec.md)
specifications are the source of truth for these public entry points. The
frozen References 1.0 implementation remains available internally to run its
independent conformance suite.

Migrating existing YAML frontmatter:
[docs/migrating-from-yaml.md](https://github.com/limaformat/lima/blob/main/docs/migrating-from-yaml.md).
Static site generator integration status:
[docs/integrations.md](https://github.com/limaformat/lima/blob/main/docs/integrations.md).

## License

ISC — see
[LICENSE](https://github.com/limaformat/lima/blob/main/js/LICENSE) (also
included in this package as `LICENSE`).
