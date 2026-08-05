# Generated boundary cases

Reserved for generator-produced conformance cases (large scalars, deep
nesting, resource-limit boundaries — see
[`docs/corpus-design/README.md`](../../docs/corpus-design/README.md), §9).

**Empty by architectural choice, not because it's unbuilt.** The loader
and generators (`corpus/runner/src/generators/`) exist and are actively
used — 13 cases across `corpus/core/` and `corpus/references/` as of this
writing carry a `"generator"` field (e.g.
[`core/limits-nesting-depth-allowed.json`](../core/limits-nesting-depth-allowed.json)),
resolved to the actual input text by `corpus/runner/src/loader.ts` at load
time. A generator-backed case still only needs a small `.json` description
(name plus parameters) either way, so there turned out to be no benefit to
routing it through a separate directory instead of keeping it alongside
its hand-written neighbours in `core/`/`references/` — this directory
would only earn content if a future case needed a genuinely large
generated *file* on disk rather than a few generator parameters.
