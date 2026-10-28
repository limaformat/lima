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

## Indentation by Unicode whitespace

Core §3 normalises tabs in leading indentation and §7.1 counts spaces, but no
section says what a line indented by other Unicode whitespace is, such as
U+00A0 at column 0 or after spaces (`  key: v` under a block). The
three implementations read it differently, in both modes. The same set is
open after a sequence dash (§7.2 says "whitespace", Appendix D's
`item-separator` refers to it). Decide it in the
specification (Core 1.2 or an erratum), add corpus cases, and drop the
exclusion `isKnownOpen` in `corpus/runner/src/differential.ts`.
