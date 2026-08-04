# YAML/Lima divergence report

Reports how often Lima's `parseCore` (Core only, non-strict) and js-yaml's
`load` produce the *same* result on realistic frontmatter, and — more
importantly — exactly *where* and *why* they don't, on the hand-authored
sample corpus in `../fixtures/frontmatter-samples/`.

## What this is NOT

- **Not a conformance check.** `docs/lima-core-1.0-spec.md` is the only
  authority for what Lima must do. YAML/js-yaml agreement is a comparison
  point, not a requirement — Lima is deliberately not YAML-compatible (no
  anchors/aliases, no `>` folded block scalar, its own scalar-coercion and
  date rules; see the project README's "Why not YAML?").
- **Not a CI gate.** Divergence from YAML is expected by design, so a
  changed match rate isn't automatically a regression — only an unexpected
  *shift* (caught by the baseline test in `test/run.test.ts`) is worth a
  second look.
- **Not exhaustive.** 16 hand-authored samples covering common SSG/CMS
  conventions (Jekyll, Hugo, Astro, Next.js/MDX, Docusaurus, Eleventy,
  generic docs sites) — breadth of realistic shapes, not depth of spec
  edge cases (that's `corpus/`'s job).

## Methodology notes

- js-yaml's `load()` default schema (`CORE_SCHEMA`, YAML 1.2) does not
  implicitly resolve timestamps — a recent, more conservative js-yaml
  default that most real-world frontmatter tooling does not actually use
  (Jekyll/Psych, historical js-yaml defaults, and gray-matter all resolve
  dates). This report uses `YAML11_SCHEMA` instead, to compare against
  what real tooling produces rather than js-yaml's newest, most
  conservative option — see the comment at the `load()` call in
  `src/run.ts` for the reasoning if this ever needs revisiting.
- Five classifications per sample: `MATCH` (both succeed, equal value),
  `DIVERGE` (both succeed, different value — reported with path-level
  diffs), `LIMA_ONLY_FAILS`, `YAML_ONLY_FAILS`, `BOTH_FAIL`.
- Value comparison reuses `corpusValuesEqual`/`diffCorpusValues` from
  `corpus/runner/src/normalize.ts` rather than a new comparator — same
  Date-by-timestamp and order-independent-mapping rules the Lima
  conformance corpus already relies on.

## Running

```sh
bun install
bun run run          # human-readable report
bun run run -- --json  # machine-readable
bun test              # baseline trip-wire
```

## Deferred (not in scope here)

Spec-length and codebase-size comparison between Lima and YAML — Lima's
side is measurable locally (`wc -l` over `docs/*.md` and `js/src`), YAML's
spec length needs an external reference not available locally.
