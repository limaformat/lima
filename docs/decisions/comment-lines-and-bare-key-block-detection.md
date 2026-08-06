# Decision: do comment lines end lookahead for a bare key's block?

**Status: proposed, not decided.** This is a recommendation for the
maintainer to confirm or reject — nothing described here is implemented.
It does not change [Lima Core 1.0](../lima-core-1.0-spec.md); this
document is about an apparent conflict between the spec's own text and
the shared behaviour of two already-published implementations.

Discovered incidentally while reviewing the Go port's fix for
[`structural-indentation-unicode-whitespace.md`](structural-indentation-unicode-whitespace.md)
(2026-08-07). Unrelated to that document's subject — filed separately.

## The problem

Core §4 rule 7 and §6.1.3 both state, in almost identical wording:

> Comment lines (first non-whitespace character is `#`) do not affect
> base indentation and are skipped.

For a **bare key** (a key ending in `:` with no inline value, whose value
is either a nested block or `null`), all three implementations decide
whether a nested block follows by looking at the next line after the key.
The literal spec text above says a comment line there should be skipped
over, so the scanner keeps looking until it finds real content or runs
out of lines.

Tested directly against all three implementations, input `"key:\n#
comment\n  nested: value\n"` — a plain ASCII comment at column 0,
followed by correctly indented real content:

| Implementation | Result |
|---|---|
| TypeScript (`@limaformat/lima`, published) | `{"key": null}` — nested content lost |
| Rust (`lima`, published on crates.io) | `{"key": null}` — same |
| Go, before the whitespace-indentation fix | `{"key": {"nested": "value"}}` — correct per the spec text above |
| Go, after the whitespace-indentation fix | `{"key": null}` — now matches TypeScript and Rust |

So two of the three published implementations agree with each other and
diverge from the spec text quoted above; Go's pre-fix behaviour happened
to match the spec, apparently as an incidental side effect of how its
lookahead loop was written, not a deliberate design choice. The Go
whitespace-indentation fix ([Option A of that
decision](structural-indentation-unicode-whitespace.md)) made Go's
lookahead match Rust's observed behaviour, which — as a side effect —
also reintroduced this three-way disagreement with the spec text on an
unrelated point.

A comment line that sits *inside* an already-open block (i.e. after the
scanner has already committed to descending into a block) is correctly
skipped by all three implementations without affecting the block's base
indentation — the divergence is specifically about the **pre-check**
that decides whether a bare key has any nested block at all in the first
place. Whether §4 rule 7 / §6.1.3 was written with that pre-check in mind,
or only describes behaviour once inside an established block, is exactly
the ambiguity this document raises.

No fixture in the 250-case conformance corpus exercises a bare key
followed by a shallower-or-equal-indented comment before its real nested
content, so none of the three implementations' test suites caught this.

## Options considered

### A. Leave all three as they are (comment ends the lookahead)

Treat the two-out-of-three published implementations as the de facto
correct behaviour; Go now matches them, nothing to do.

- No further code changes anywhere, in any language.
- Leaves the literal spec sentence unaddressed — either the spec text
  needs a clarifying amendment (this is the actual intended behaviour,
  and §4/§6.1.3 should say so more precisely), or two published packages
  have a real, shipped conformance gap.

### B. Fix Go alone to skip comments in this lookahead

Restore Go's pre-fix behaviour for this one lookahead, deliberately
diverging from Rust here while staying aligned with the literal spec
text.

- Creates a new, permanent three-way inconsistency in the opposite
  direction (Go alone would differ from TS and Rust) — trades one
  disagreement for another, doesn't resolve anything project-wide.
- Not recommended: singles out the newest, least-established
  implementation to carry a compatibility burden the two published ones
  don't.

### C. Fix all three implementations to match the spec text

Change the bare-key lookahead in TypeScript, Rust, and Go so a comment
line is skipped when deciding whether a nested block follows, add a
corpus fixture for this exact case, and treat it as a genuine
conformance defect in the two already-published packages.

- Only option that actually resolves the spec/implementation mismatch
  rather than picking a side.
- Real cost: touches two already-published packages
  (`@limaformat/lima` on npm, `lima` on crates.io) for a behaviour change
  that could — in principle — affect a real document with a
  shallow-indented comment before intentional nested content under a
  bare key. Needs its own scoped release, not something to bundle into
  the Go port's current work.

## Recommendation

**Primary: option A for now** — leave Go matching the two published
implementations, since introducing a fresh divergence (option B) is
worse than the status quo, and a three-language fix (option C) is a
separate, larger piece of work with its own release implications that
shouldn't block or get bundled into finishing the Go port. Revisit as
its own tracked item, likely resolved via option C once there's
capacity for a coordinated three-language fix plus a new corpus fixture.

**Not implemented pending maintainer confirmation.** No code in this
repository has been changed as a result of this document. Does not
block or depend on
[`structural-indentation-unicode-whitespace.md`](structural-indentation-unicode-whitespace.md)
or
[`corpus-int-float-type-assertion.md`](corpus-int-float-type-assertion.md) —
all three are independent, currently open items.
