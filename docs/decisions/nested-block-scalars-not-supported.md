# Decision: nested `|` block scalars don't work in any implementation

**Status: proposed, not decided.** This is a recommendation for the
maintainer to confirm or reject — nothing described here is implemented.
Unlike the other two open decision documents, this one isn't a
spec-ambiguity question: the spec text is unambiguous, and all three
implementations diverge from it the same way.

Discovered incidentally during Claude Code's review of the Go port's
`lineContent` fix (2026-08-07), via an unrelated sanity check. Not
connected to
[`structural-indentation-unicode-whitespace.md`](structural-indentation-unicode-whitespace.md)
or
[`comment-lines-and-bare-key-block-detection.md`](comment-lines-and-bare-key-block-detection.md).

## The problem

Core §6.1.5 defines block scalar extent generically, with no top-level
restriction:

> **Block scalar extent:** A line belongs to a block scalar if and only
> if its indentation is strictly greater than the indentation of the key
> that introduced the scalar. This rule applies to all lines...

Tested `"a:\n  b: |\n    line1\n    line2\n"` — a `|` block scalar
introduced by a key that is itself nested one level deep — against all
three implementations:

| Implementation | Top-level `|` (`"b: |\n  line1\n  line2\n"`) | Nested `|` (as above) |
|---|---|---|
| TypeScript (`@limaformat/lima`, published) | `"line1\nline2"` — correct | `"\|"` — the literal marker, not the content |
| Rust (`lima`, published on crates.io) | correct | same: `"\|"` |
| Go (`lima`, unpublished) | correct | same: `"\|"` |

All three treat `|` as a normal inline scalar value (the one-character
string `"|"`) instead of recognizing it as a block scalar introducer, as
soon as the introducing key is itself nested rather than top-level. The
top-level path works correctly everywhere; only the nested path is
missing.

No fixture in the 250-case conformance corpus tests a block scalar
introduced by a non-top-level key, so none of the three test suites
caught this.

## Why this is different from the other two open decisions

The other two documents in this directory involve either a genuine gap
in what the spec text says (structural indentation and Unicode
whitespace) or apparent disagreement between the spec and established
implementation behaviour that could go either way (comment lines and
bare-key block detection). This one has none of that ambiguity — §6.1.5
is unambiguous, all three implementations agree with each other, and
none of them agree with the spec. It's a shared, confirmed conformance
gap, not a question of which behaviour should win.

## Options considered

### A. Implement nested block scalar support in all three implementations

Extend the `|`-detection and extent-scanning logic (currently only
triggered from each implementation's top-level key/value scan) to also
fire from within nested block/mapping parsing.

- The only option that actually closes the gap against the spec.
- Touches three codebases, two of them already published
  (`@limaformat/lima` on npm, `lima` on crates.io) — a real behaviour
  change, not just an internal refactor, so it needs its own coordinated
  release across all three, plus new corpus fixtures covering nested
  `|` at multiple depths (mapping-under-mapping, array-item-under-key,
  etc.) so future ports don't reintroduce the gap.

### B. Leave it as documented behaviour, note the limitation

Accept that block scalars are effectively a top-level-only feature in
practice today, and say so explicitly wherever the feature is
documented (guide, README, spec errata note) rather than silently
letting users discover it.

- No implementation work, but a real feature gap under a
  spec that doesn't say it should be one — increases the chance someone
  hits this by surprise, since nothing in the current `docs/guide.md`
  flags it.

## Recommendation

**Primary: option A**, but scoped as its own dedicated piece of work
across all three implementations plus a corpus addition — not something
to bundle into whatever else is currently in flight (the Go port's
whitespace/indentation work is unrelated and already large). Until
resourced, option B's minimum — a documentation note — costs little and
prevents silent surprises in the meantime.

**Not implemented pending maintainer confirmation.** No code in this
repository has been changed as a result of this document.
