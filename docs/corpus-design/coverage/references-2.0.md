# Coverage Matrix: Lima References 2.0

**Status:** draft corpus — 110 cases; parser adapters intentionally blocked
until their References 2.0 implementations exist.
**Normative basis:** `docs/lima-references-2.0-spec.md` Draft.

A References 2.0 implementation must additionally pass the unchanged Core 1.0
suite. References 1.0 remains an independent frozen conformance target.

## Matrix

| ID | Spec | Area | Normative assertion | Coverage |
|---|---|---|---|---|
| R2-001 | §1 | Scope | References 2.0 includes Core 1.0 behavior | inherited case + Core suite |
| R2-010 | §2.1 | Document syntax | `$(path)` and dotted mapping paths | positive, unresolved pair |
| R2-011 | §2.2 | Partial syntax | `$(:name)`, slash namespacing, dotted mapping traversal, and their combination | positive, unresolved pair |
| R2-012 | §2.3 | Namespace | colon immediately after `$(` selects partials | disambiguation case |
| R2-013 | §2.3 | Names | underscore, colon, dash, slash rules | positive and validation cases |
| R2-014 | §2.4 | Activity | every unquoted scalar context is active | mapping/sequence/flow/block cases |
| R2-015 | §2.4 | Inactivity | quoted, incomplete, invalid, and key occurrences are literal | strict negative cases |
| R2-016 | §2.4 | Scanner | adjacent complete tokens and longest-complete precedence | scanner cases |
| R2-020 | §2.5 | Pure mode | one complete token preserves type | scalar/array/map/date cases |
| R2-021 | §2.5 | Interpolation | surrounding text or multiple tokens forces string mode | positive cases |
| R2-030 | §3.1 | Document paths | mapping traversal; no array indexes | positive and unresolved pair |
| R2-031 | §3.1 | Partial paths | first component is partial name; later components traverse mappings | positive and unresolved pair |
| R2-032 | §3.2 | Copying | pure results are structural copies with preserved metadata | copy and numeric-kind cases |
| R2-033 | §3.2 | Shape | array inserted into sequence is rejected | both modes |
| R2-034 | §3.3 | Partial inertia | reference-like partial strings remain literal after traversal/copy | positive negative cases |
| R2-040 | §3.4 | Canonical scalars | string, boolean, null, integer, instant | one case per kind |
| R2-041 | §3.4 | Invalid interpolation | mappings and invalid arrays throw | both modes |
| R2-042 | §3.4 | Numeric kind | document integer/float and host float remain distinct internally | positive cases |
| R2-043 | §3.5 | Floats | ECMAScript thresholds, shortest form, lexical normalization | boundary cases |
| R2-044 | §3.6 | Arrays | scalar join and empty result | positive and invalid-element cases |
| R2-050 | §4.1 | Order | forward/backward and mixed chains are source-order independent | direct and chain cases |
| R2-051 | §4.2 | Chain boundary | three edges resolve; four edges do not | exact boundary pair |
| R2-052 | §4.2 | Per-source depth | permitted suffix of an overlong chain still resolves | non-strict boundary result |
| R2-053 | §4.2 | Interpolation depth | longest embedded dependency controls depth | interpolation-chain case |
| R2-054 | §4.2 | Partials | partial lookup is one terminal edge | partial cases |
| R2-055 | §4.3 | Cycles | self, two-key, and external dependent remain unresolved | strict/non-strict cases |
| R2-056 | §4.4 | Copied activity | document copies retain active tokens; partial copies do not | structural-copy cases |
| R2-060 | §5 | Ordering | earliest source error wins across diagnostic kinds | ordering cases |
| R2-061 | §5 | Attribution | final global errors identify earliest participating insertion | limit cases |
| R2-062 | §5 | Priority | partial validation precedes document parsing | priority case |
| R2-070 | §6.1 | API | References composes Core and defaults partials to empty | API cases |
| R2-071 | §6.2 | Names | every partial name matches grammar; dot rejected; `_` accepted | validation cases |
| R2-072 | §6.2 | Partial limits | counts, name/key lengths, node budget | generated boundaries |
| R2-073 | §6.2 | Value model | accepted types, copies, invalid host values, cycles, dates | inherited/adapted cases |
| R2-074 | §6.3 | Final limits | scalar, depth, node count, nested arrays | allowed/above and mode pairs |
| R2-080 | §7 | Modes | unresolved falls back only non-strict; hard errors throw in both | mode pairs |
| R2-090 | §8 | Unsupported | no array indexing/spreading or references in keys | negative cases |
| R2-100 | §10 | Compatibility | `($...)` and `(%...)` are literal under 2.0 | strict compatibility case |

## Deliberately not copied from References 1.0

The following 1.0 cases have no mechanically renamed counterpart:

- the phase-1 backward-position rule;
- the phase-2 immutable-snapshot rule;
- the one-hop chain limit;
- the old `partials-no-traversal` expectation: partial strings remain inert in
  2.0, but mapping traversal is now permitted, so dedicated traversal and
  inertia cases replace that mixed 1.0 fixture; and
- `(%a.b)` as the dotted-partial negative grammar example.

They are replaced by R2-031 and R2-050–R2-056. The derivation script excludes
the corresponding fixtures explicitly so a future refresh cannot accidentally
reintroduce obsolete semantics.
