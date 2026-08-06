# Decision: does non-ASCII whitespace count as block indentation?

**Status: proposed, not decided.** This is a recommendation for the
maintainer to confirm or reject — nothing described here is implemented.
It does not change [Lima Core 1.0](../lima-core-1.0-spec.md); §3 only
normatively addresses tabs before the first non-whitespace character. This
document is about a behavioural question the spec text does not currently
answer either way.

Discovered during Claude Code's final review of the Go port (`go/`),
2026-08-07, after Codex's fix for the `isTrimWhitespace` dead-code finding
from Phase A. Filed separately from
[`corpus-int-float-type-assertion.md`](corpus-int-float-type-assertion.md)
because the two are unrelated: this one is about what counts as
*structural* indentation, not about corpus type assertions.

## The problem

Fixing the Phase A finding (`isTrimWhitespace` — the ECMAScript-whitespace
predicate covering NBSP, BOM, U+2000–200A, U+2028/2029, etc. — was defined
but never called) required deciding which call sites actually need the
full class versus plain ASCII space/tab. Codex wired it into `go/core.go`'s
`sourceLines`, which feeds the **structural** indent comparison that
`parseBlock`/`parseCorePositioned` use to decide what's a new top-level
key versus a nested continuation — not just scalar/value trimming.

That makes Go's structural indentation more permissive than Rust's
observed behaviour. Verified directly against `rust::parse_core` (a
scratch project depending on `rust/` by path, no repository files
touched) for identical inputs, non-strict:

| Input | Go (`go/core.go` as of this review) | Rust (`rust/src/*.rs`, unchanged) |
|---|---|---|
| `"parent:\n child: value\n"` (NBSP indent) | `parent: {child: "value"}` — nests | `parent: null`, plus a separate top-level key literally named `" child"` — does not nest |
| Same pattern with BOM, U+2028, U+2029, two U+2000 | nests in every case | does not nest in any case — the character stays part of the key text |
| `" key: value\n"` (Unicode whitespace before any top-level key exists) | **`{}`** — empty result, no error, no warning | `{" key": "value"}` — key preserved |
| Same NBSP pattern two levels deep (`parent: / a: /   b: value`) | nests correctly at both levels | diverges at the second level too — not just a top-level-only quirk |

The current 250-case conformance corpus doesn't exercise this — no
fixture uses non-ASCII whitespace as leading indentation — so both
behaviours currently pass 149/149 and 101/101 without anyone having
picked one on purpose.

The third row is the one that matters independently of which policy wins:
a document can lose an entire key **silently**, with no error and no
`onWarning` diagnostic. Core §2 states a conforming parser MUST NOT
"[a]ccept syntax not defined in this document without falling back as
specified" or "[s]ilently produce incorrect values" — dropping a value
to nothing without emitting anything isn't a documented fallback for any
construct in the spec, and arguably a stricter failure than a
misidentified type.

## Options considered

### A. Restrict Go back to ASCII-only structural indentation

Revert `sourceLines`' indent computation to ASCII space/tab only (after
tab-expansion), keeping the full `isTrimWhitespace` class for the
scalar/value-trimming call sites Phase A actually identified (block
key/value trim, flow element boundaries, comment/blank-line detection —
`rust/src/block.rs`, `flow.rs`, `block_cursor.rs`, `core.rs`'s eight
usage sites).

- Restores observable parity with Rust, the designated primary porting
  reference for this project.
- Doesn't require touching Rust, TS, or the spec.
- Doesn't by itself explain *why* Rust's own `BlockCursor.indent` field
  internally references `is_trim_whitespace` at all if it's meant to stay
  ASCII-only in practice — worth a short joint read of `block_cursor.rs`
  before treating this as settled, since the empirical result and the
  code's apparent intent don't obviously agree.

### B. Make the full ECMAScript-whitespace class the normative rule, update Rust and TS to match

Treat Go's broader behaviour as the intended one, add a normative
sentence to Core §3, and bring Rust's (and TS's) structural indentation
in line with it.

- Larger footprint: a real behavioural change to two already-published
  packages (`lima` on crates.io, `@limaformat/lima` on npm), not just an
  internal Go fix.
- No corpus fixture or spec text currently motivates this; would need a
  concrete reason (a real frontmatter document using such indentation)
  before justifying the change, not just "Go already does it."

### C. Fix the silent-data-loss case regardless of A or B

Whichever policy wins, a leading Unicode-whitespace-only line before any
top-level key is established should not silently vanish into `{}`. Under
option A this case likely resolves itself (the line stops looking like
valid indentation and falls back to string/error handling, matching
Rust's row-3 behaviour above). Should be re-verified once A or B is
chosen, not assumed fixed for free.

## Recommendation

**Primary: option A**, as the narrower, lower-footprint fix, consistent
with `AGENTS.md`'s instruction to treat `rust/src/*.rs` as the primary
porting reference and not change language semantics merely to satisfy
the current implementation. Before implementing: a short joint read of
`rust/src/block_cursor.rs`'s `is_trim_whitespace` usage against its
actual call sites, to understand why the field exists if it isn't
effectively load-bearing for structural indentation today — option A
might reveal that Rust itself has room to be more deliberate here, even
if its current *behaviour* is the one to preserve.

**Not implemented pending maintainer confirmation.** No code in this
repository has been changed as a result of this document. Tracked as a
follow-up to the Go port's Abschlussreview (2026-08-07), alongside
[`corpus-int-float-type-assertion.md`](corpus-int-float-type-assertion.md)
— both deferred, neither blocking the separate Go benchmark work package.
