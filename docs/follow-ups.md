# Follow-ups

## References 2.0 resolver cache

`resolveNode` caches resolutions by node and remaining edge budget, but not by
the active dependency stack. Determine whether a complex reference graph can
reuse a cached result whose cycle eligibility differs from the current stack.
No failing case is currently known; this predates the same-top-level fix.

## Reference benchmark syntax error

`js/bench/index.ts` currently has a pre-existing malformed template literal
near line 72, preventing the reference benchmark from running. Repair it and
add a stable References 2.0 benchmark suitable for before/after comparisons.

## Tree-sitter grammar after Core 1.1

The editor grammar (`editors/tree-sitter-lima`) does not show a compact
sequence (Core 1.1 §7.2) as a sequence: its items are missing from the tree,
with no error node. Nor does it show a key that follows a skipped line under a
bare key of an object item (`- a:` / `    freetext` / `      c: 1`), which
Core reads as a later key of the item. Both parse without an error node; the
missing nodes only lose their highlighting. Teach the scanner both, pin the
trees in `scripts/gen-corpus.ts`, and move the Zed extension's grammar
commit with the next release.

## Strict mode's second pass over block lines

Core 1.1's strict range check reads every line of a top-level block a second
time after the block parser has (`js/src/structure.ts`,
`rust/src/structure.rs`). Against 0.5.1, strict mode costs +5 % in
TypeScript and +10–12 % in Rust on real front matter (Go checks in its one
pass and costs nothing). Let the block parser report how far it read, and
start the range check there. The strict scenarios of the cross-language
benchmarks show the effect.

## "Identical output" says more than it means

Core's opening paragraph and §2 promise identical output for any valid input,
but dates are host types (§6.5.3) and mapping order is not semantic (§1). Say
"the same abstract Lima value" instead, the next time the opening is touched
(raised by the review of Core 1.2, 2026-10-30).
