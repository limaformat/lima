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
