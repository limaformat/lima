# Coverage Matrix: Lima References 1.0
This matrix complements the full Core matrix. A References runner must additionally pass all Core cases.
## Legend
- **positive**: valid success case
- **fallback**: tolerant non-strict behavior
- **error**: expected error
- **pair**: separate strict/non-strict cases
- **boundary**: boundary value plus immediately adjacent value
- **trace**: Phase 1/Phase 2 snapshot should be documented in the test
| ID | Spec | Area | Normative assertion | Kind | Mode |
|---|---|---|---|---|---|
| R-001 | §1 | Scope | References parser includes complete Core behavior | inheritance | both |
| R-010 | §2.1 | Syntax | Document reference grammar including dotted path | positive | both |
| R-011 | §2.2 | Syntax | Partial grammar including literal slash | positive | both |
| R-012 | §2.2 | Syntax | Dotted partial syntax is not a valid partial path | negative | both |
| R-013 | §2.3 | Activity | Active in unquoted top-level mapping value | positive | both |
| R-014 | §2.3 | Activity | Active in nested mapping value | positive | both |
| R-015 | §2.3 | Activity | Active in block sequence item | positive | both |
| R-016 | §2.3 | Activity | Active in flow sequence item | positive | both |
| R-017 | §2.3 | Activity | Active in flow mapping value | positive | both |
| R-018 | §2.3 | Activity | Active in block scalar | positive | both |
| R-019 | §2.3 | Activity | Inactive in single/double quotes | negative | both |
| R-020 | §2.4 | Mode | Pure reference after the complete inline pipeline | positive | both |
| R-021 | §2.5 | Mode | Surrounding text forces interpolation | positive | both |
| R-022 | §2.5 | Mode | More than one token forces interpolation | positive | both |
| R-030 | §3.1 | Pure | String/boolean/null/integer/float/date preserve their type | positive | both |
| R-031 | §3.1 | Pure | Array and mapping are structurally deep-copied | copy | both |
| R-032 | §3.1 | Pure | No aliasing with the document target | copy | both |
| R-033 | §3.1 | Pure | Unresolved remains the token string | fallback | non-strict |
| R-034 | §3.1/§7 | Pure | Unresolved throws after Phase 2, with token/line | error | strict |
| R-035 | §3.1 | Metadata | Deep copy preserves numeric kind until completion | positive | both |
| R-036 | §3.1 | Nested arrays | Array as a sequence element produces a final error | error | both |
| R-040 | §3.2 | Interpolation | Unresolved token remains in the string | fallback | non-strict |
| R-041 | §3.2/§7 | Interpolation | Unresolved throws in strict mode | error | strict |
| R-042 | §3.3 | Dotted path | Traversal through nested mappings | positive | both |
| R-043 | §3.3 | Dotted path | Missing/null/non-map intermediate is unresolved | pair | both |
| R-044 | §3.4 | Partials | Direct lookup, slash is literal | positive | both |
| R-045 | §3.4 | Partials | Missing partial falls back/throws, as a mode pair | pair | both |
| R-050 | §3.5 | Canonical | String unchanged | positive | both |
| R-051 | §3.5 | Canonical | Boolean lowercase true/false | positive | both |
| R-052 | §3.5 | Canonical | Null becomes an empty string | positive | both |
| R-053 | §3.5 | Canonical | Integer base-10 without exponent | positive | both |
| R-054 | §3.5 | Canonical | UTC instant, RFC3339 seconds, Z | positive | both |
| R-055 | §3.5 | Canonical | Mapping in interpolation throws | error | both |
| R-056 | §3.5 | Numeric kind | Document integer vs. document float are internally distinguishable | positive | both |
| R-057 | §3.5 | Numeric kind | Partial numbers always use the float rule | positive | both |
| R-060 | §3.5.1 | Float | 3.14 and -0.5, fixed notation | positive | both |
| R-061 | §3.5.1 | Float | 1e-6 fixed, 1e-7 exponential | boundary | both |
| R-062 | §3.5.1 | Float | 1e20 fixed, 1e21 exponential | boundary | both |
| R-063 | §3.5.1 | Float | 0.30000000000000004 round-trips via shortest representation | positive | both |
| R-064 | §3.5.1 | Float | 1000.0 becomes '1000' | positive | both |
| R-065 | §3.5.1 | Float | Lowercase e, no +, no leading zeros in the exponent | positive | both |
| R-070 | §3.6 | Array interpolation | Join scalar elements with ', ' | positive | both |
| R-071 | §3.6 | Array interpolation | Empty array yields an empty string | positive | both |
| R-072 | §3.6 | Array interpolation | Mapping element throws | error | both |
| R-073 | §3.6 | Array interpolation | Nested array element throws | error | both |
| R-080 | §3.7 | One hop | Backward direct reference, Phase 1 | trace | both |
| R-081 | §3.7 | One hop | Forward direct reference, Phase 2 | trace | both |
| R-082 | §3.7 | One hop | a→b→c leaves a unresolved and resolves b | trace | both |
| R-083 | §3.7 | One hop | Result independent of mapping enumeration order | cross-runner | both |
| R-090 | §3.8 | Partials | No traversal into partial values | negative | both |
| R-091 | §3.8 | Partials | Reference-like string within a partial remains literal | negative | both |
| R-100 | §4 | Snapshots | Every phase reads an immutable snapshot | trace | both |
| R-101 | §4.1 | Phase 1 | Earlier target by line and character offset | trace | both |
| R-102 | §4.1 | Phase 1 | Dotted path's defining key is the final segment | trace | both |
| R-103 | §4.1 | Phase 1 | Partials are always available before any document position | trace | both |
| R-104 | §4.2 | Phase 2 | Recursive into document arrays and mappings | positive | both |
| R-105 | §4.2 | Phase 2 | Not recursive into partial values | negative | both |
| R-106 | §4.3 | Cycles | Self-reference remains unresolved | pair | both |
| R-107 | §4.3 | Cycles | Two-key cycle remains unresolved | pair | both |
| R-110 | §5 | Error ordering | First error by line, then column | error-order | both |
| R-111 | §5 | Error ordering | Sort all source-related error types together | error-order | both |
| R-112 | §5 | Global errors | A global result error is attributed to the lowest involved token | error-order | both |
| R-113 | §5 | Global errors | Without an identifiable token, line 1 is reported | error-order | both |
| R-114 | §5 | Priority | Partial validation happens before document parsing | priority | both |
| R-120 | §6.1 | API | parseReferences extends parseCore | api | both |
| R-121 | §6.2 | Options | partials defaults to {} | api | both |
| R-122 | §6.2 | Validation | Partials are validated and deep-copied before parsing | copy | both |
| R-123 | §6.2 | Validation | Error names the partial and value path, not a document line | error | both |
| R-124 | §6.2 | Limits | Maximum 128 partial names | boundary | both |
| R-125 | §6.2 | Limits | Partial name maximum 128 code points | boundary | both |
| R-126 | §6.2 | Limits | All partials combined, maximum 4,096 nodes | boundary | both |
| R-127 | §6.2 | Limits | Partial mapping key maximum 128 code points | boundary | both |
| R-128 | §6.2 | Node count | Scalar = 1, collection = 1 + children, keys do not count | boundary | both |
| R-130 | §6.2 | Value model | null/boolean/finite number/string/instant/array/map are valid | positive | both |
| R-131 | §6.2 | Value model | NaN/Infinity invalid, -0 becomes +0 | boundary | both |
| R-132 | §6.2 | Value model | Host finite 1e20 is valid | positive | both |
| R-133 | §6.2 | Value model | Date invalid/out of range is invalid; milliseconds are truncated | boundary | both |
| R-134 | §6.2 | Value model | Nested arrays in partials are invalid | error | both |
| R-135 | §6.2 | Value model | Cycles in partials are invalid | error | both |
| R-136 | §6.2 | Value model | Plain own enumerable data properties are allowed | positive | both |
| R-137 | §6.2 | Value model | Class/accessor/function/symbol are invalid | error | both |
| R-138 | §6.2 | Value model | Empty mapping keys are allowed | positive | both |
| R-140 | §6.2 | Final limits | Final scalar max 16,384 code points | boundary | both |
| R-141 | §6.2 | Final limits | Final depth max 16 | boundary | both |
| R-142 | §6.2 | Final limits | Final node count max 65,536 | boundary | both |
| R-143 | §6.2 | Final limits | Final result has no direct nested arrays | error | both |
| R-150 | §7 | Strict additions | A quoted reference-like token produces no unresolved error | negative | both |
| R-151 | §7 | Strict additions | Mapping/invalid array/final limits throw in both modes | error | both |
| R-160 | Appendix | Unsupported | %key shorthand remains literal | negative | both |
| R-161 | Appendix | Unsupported | References in keys/flow mapping keys remain literal | negative | both |
| R-162 | Appendix | Unsupported | No array spreading | negative | both |

**Scope:** 91 substantive check points. A check point can produce multiple concrete cases.
