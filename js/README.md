# @limaformat/lima

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

Two functions are exported:

- `parseCore(input, options?)` — the base format only.
- `parse(input, options?)` (alias for `parseReferences`) — adds
  `($key)` document references and `(%key)` external partials.

```ts
parse(frontmatter, { strict: true })
parse(frontmatter, { partials: { author: 'Alice' } })
```

Full syntax reference, the References extension, resource limits, strict
mode, and the complete API:
**[docs/guide.md](https://github.com/limaformat/lima/blob/main/docs/guide.md)**.

Why Lima exists, the case against YAML, and security rationale:
**[repository README](https://github.com/limaformat/lima#readme)**.

The [Lima Core 1.0](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References 1.0](https://github.com/limaformat/lima/blob/main/docs/lima-references-1.0-spec.md)
specifications are the normative source of truth — this package implements
them exactly, verified against a
[250-case conformance corpus](https://github.com/limaformat/lima/tree/main/corpus)
(count pinned by a test) shared with any other Lima implementation.

Migrating existing YAML frontmatter:
[docs/migrating-from-yaml.md](https://github.com/limaformat/lima/blob/main/docs/migrating-from-yaml.md).
Static site generator integration status:
[docs/integrations.md](https://github.com/limaformat/lima/blob/main/docs/integrations.md).

## License

ISC — see
[LICENSE](https://github.com/limaformat/lima/blob/main/js/LICENSE) (also
included in this package as `LICENSE`).
