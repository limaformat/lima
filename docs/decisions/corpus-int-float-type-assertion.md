# Decision: how should the conformance corpus assert Int vs. Float?

**Status: proposed, not decided.** This is a recommendation for the
maintainer to confirm or reject — nothing described here is implemented.
It does not change [Lima Core 1.0](../lima-core-1.0-spec.md), which already
defines Integer and Float as distinct value-model types (§6.4). This
document is about a gap in how the **corpus** verifies that distinction,
not about the grammar itself.

Discovered during Claude Code's independent review of the Go port
(`go/`), 2026-08-07. Filed here because fixing it touches shared
infrastructure (`corpus/`) used by all three implementations, not just one
of them — per `AGENTS.md`'s instruction to distinguish implementation
defects, corpus defects, and specification ambiguities, this is squarely a
**corpus defect**, not a bug in Rust or Go.

## The problem

Lima's value model distinguishes `Int` from `Float` as separate types in
every implementation that has native numeric types to distinguish
(Rust's `LimaValue::Int(i64)`/`LimaValue::Float(f64)`, Go's
`Int64`/`Float64`, and even TypeScript's `LimaValue` internally, which
carries a `kind: 'int' | 'float'` tag — see `js/src/value.ts`,
`canonicalString`). The conformance corpus, however, never actually
verifies which one an implementation produced. It only verifies the
numeric *value*:

```go
// go/corpus_test.go:107–112 (equalCorpus)
case Int64:   y, ok := e.(float64); return ok && float64(x) == y
case Float64: y, ok := e.(float64); return ok && float64(x) == y
```

```rust
// rust/tests/corpus.rs:144–145 (value_matches)
(LimaValue::Int(n), Json::Number(e)) => Some(e.as_f64() == Some(*n as f64)),
(LimaValue::Float(n), Json::Number(e)) => Some(e.as_f64() == Some(*n)),
```

Both branches check the same thing regardless of which one matched — the
match arm itself carries no assertion. The TypeScript runner
(`corpus/runner/src/normalize.ts`, `corpusValuesEqual`) has the same
blind spot for a different reason: it compares against the result of
`toPlainValue()`, which already discards the `kind` tag before the
comparison ever runs.

Root cause: JSON has no Int/Float distinction, and `expect.result` is
plain JSON. `9007199254740991` and, hypothetically, `9007199254740991.0`
are indistinguishable once decoded into `any` (Go), `serde_json::Value`
(Rust), or a plain `number` (TS) — there's currently no way for a fixture
to assert "this leaf must specifically be a Float," short of an
externally-known convention that no runner currently implements.

**Concrete case that currently passes without verifying anything:**
`corpus/core/number-grammar-forms.json` expects `h: 1e3` → `1000`. Per
Core §6.4.1, exponent notation should produce a `Float`, not an `Int`,
even though the resulting value is a whole number. No runner checks this
today — an implementation that misclassified `1e3` as `Int(1000)` would
still show green.

## Options considered

### A. Extend the existing `$type` sentinel convention

Corpus fixtures already use a `$type` object for values JSON can't
natively express — `{"$type": "host-number", "value": "nan"}`,
`{"$type": "instant", ...}` (documented in
[`docs/corpus-design/README.md`](../corpus-design/README.md)). Extending
that same convention with `{"$type": "float", "value": <number>}` /
`{"$type": "int", "value": <number>}`, usable anywhere inside
`expect.result` (not just `options.partials`, where `host-number`
currently lives), keeps the mechanism consistent with what fixture authors
already know.

- Requires updating all three comparison paths (`normalize.ts`,
  `corpus.rs`, `corpus_test.go`) to unwrap and check the tag.
- TS's comparison would need to run against the tagged `LimaValue` (or an
  equivalent pre-`toPlainValue()` representation) for tagged leaves
  specifically, rather than uniformly against the plain projection.
- Cheapest to implement given the sentinel-handling code paths already
  exist in all three runners for other `$type` values.

### B. Separate `resultTypes` side-channel per fixture

A parallel field (e.g. `"resultTypes": {"h": "float"}`) mapping JSON
Pointer–style paths to expected kinds, checked independently of
`expect.result`.

- Doesn't require touching the value representation at every call site —
  purely additive.
- Duplicates path information already implicit in `expect.result`'s
  shape; keeping the two in sync by hand is an extra source of fixture
  authoring error that option A doesn't have (the type lives right next
  to the value it describes).

### C. Leave the corpus as-is; add language-native unit tests instead

Each implementation asserts Int/Float classification in its own
hand-written test suite (not the shared JSON corpus), e.g. a
Rust/Go-only test asserting `parse_core("h: 1e3").unwrap()["h"]` is
`Float`, outside `corpus/`.

- Fastest to land, zero corpus-schema risk.
- Reintroduces exactly the problem the shared corpus exists to prevent:
  each implementation's author decides independently what "correct"
  means, rather than being checked against one language-neutral source —
  the corpus's own stated purpose
  ([`docs/corpus-design/README.md`](../corpus-design/README.md)).
  Acceptable as a stopgap, not as the final answer.

## Recommendation

**Primary: option A**, scoped narrowly at first — do not retag all ~250
existing fixtures. Add a small number of new, targeted fixtures that
specifically exercise the Int/Float boundary (starting with the
exponent-notation case above, plus the other boundary forms in Core
§6.4.1/§6.4.2), wire the three runners to honor the new sentinel for
those, and leave the remaining fixtures untouched since their numeric
values are unambiguous either way (no fixture currently *needs* the
distinction to catch a real bug except this one). Option C is acceptable
as an interim safety net if option A's schema work is deferred, but
should not replace it.

**Not implemented pending maintainer confirmation.** No code in this
repository currently emits or checks a `$type: "int"`/`$type: "float"`
sentinel. Tracked as Teil 2 of the active Codex handoff (Go port review
follow-up, 2026-08-07) — implementation should confirm this document's
approach before touching `corpus/`.
