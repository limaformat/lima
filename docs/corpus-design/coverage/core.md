# Coverage Matrix: Lima Core 1.0
This matrix derives the corpus work directly from the normative Core rules. The IDs are coverage IDs, not necessarily later case IDs.
## Legend
- **positive**: valid success case
- **fallback**: tolerant non-strict behavior
- **error**: expected error
- **pair**: separate strict/non-strict cases
- **boundary**: boundary value plus immediately adjacent value
- **trace**: Phase 1/Phase 2 snapshot should be documented in the test
| ID | Spec | Area | Normative assertion | Kind | Mode |
|---|---|---|---|---|---|
| C-001 | §2 | Conformance | Accept all valid Core constructs | positive | both |
| C-002 | §2 | Conformance | Identical output regardless of implementation language | cross-runner | both |
| C-003 | §2 | Diagnostics | No implicit console output; warnings only via onWarning | warning | non-strict |
| C-010 | §3.1 | Normalization | CRLF becomes LF | positive | both |
| C-011 | §3.1 | Normalization | Standalone CR becomes LF | positive | both |
| C-012 | §3.2 | Normalization | Leading tabs are each replaced by two spaces | positive | both |
| C-013 | §3.2 | Normalization | Tabs within scalar content are preserved | positive | both |
| C-014 | §3.3 | Normalization | Trailing spaces on every line are removed | positive | both |
| C-020 | §4 | Document | Empty document yields an empty mapping | positive | both |
| C-021 | §4 | Document | Top-level key starts in column 0 | positive | both |
| C-022 | §4 | Document | Unknown top-level line is skipped even in strict mode | fallback | both |
| C-023 | §4 | Inline pipeline | Comment outside quotes is stripped | positive | both |
| C-024 | §4 | Inline pipeline | Hash inside quotes is literal | positive | both |
| C-025 | §4 | Inline pipeline | Quoted value plus trailing comment is valid | positive | both |
| C-026 | §4 | Inline pipeline | Trailing content after closing quote falls back to string | fallback | non-strict |
| C-027 | §4/§10 | Inline pipeline | Trailing content after closing quote throws | error | strict |
| C-028 | §4 | Inline pipeline | Empty value after trim/comment becomes null | positive | both |
| C-030 | §5.1 | Keys | Unquoted key grammar accepts letters/digits/_/:/- | positive | both |
| C-031 | §5.1 | Keys | First ': ' outside quotes is the separator | positive | both |
| C-032 | §5.2 | Keys | Single-quoted key, including an empty key | positive | both |
| C-033 | §5.2 | Keys | Double-quoted key decodes escapes | positive | both |
| C-034 | §5.2 | Keys | Space between closing quote and colon is skipped | fallback | non-strict |
| C-035 | §5.2/§10 | Keys | Space between closing quote and colon throws | error | strict |
| C-036 | §5.3 | Duplicate | Top-level duplicate: warning, last value wins | warning | non-strict |
| C-037 | §5.3 | Duplicate | Nested mapping duplicate: warning, last value wins | warning | non-strict |
| C-038 | §5.3 | Duplicate | Flow mapping duplicate: warning, last value wins | warning | non-strict |
| C-039 | §5.3/§10 | Duplicate | Duplicate throws with key and line | error | strict |
| C-040 | §6 | Coercion | Conversion order null → boolean → number → date → string | positive | both |
| C-041 | §6.1.1 | Strings | Unquoted fallback string | positive | both |
| C-042 | §6.1.2 | Strings | All valid double-quote escapes | positive | both |
| C-043 | §6.1.2 | Strings | Unknown escape is left unchanged | fallback | non-strict |
| C-044 | §6.1.2/§10 | Strings | Unknown escape throws | error | strict |
| C-045 | §6.1.2 | Strings | Incomplete Unicode escape is left unchanged | fallback | non-strict |
| C-046 | §6.1.2/§10 | Strings | Incomplete Unicode escape throws | error | strict |
| C-047 | §6.1.2 | Strings | Invalid hex is left unchanged | fallback | non-strict |
| C-048 | §6.1.2/§10 | Strings | Invalid hex throws | error | strict |
| C-049 | §6.1.2 | Strings | Codepoint > U+10FFFF is left unchanged | fallback | non-strict |
| C-050 | §6.1.2/§10 | Strings | Codepoint > U+10FFFF throws | error | strict |
| C-051 | §6.1.2 | Strings | UTF-16 surrogate is left unchanged | fallback | non-strict |
| C-052 | §6.1.2/§10 | Strings | UTF-16 surrogate throws | error | strict |
| C-053 | §6.1.2 | Strings | Unterminated double quote falls back to string | fallback | non-strict |
| C-054 | §6.1.2/§10 | Strings | Unterminated double quote throws | error | strict |
| C-055 | §6.1.3 | Strings | Single quote: only \' is special | positive | both |
| C-056 | §6.1.3 | Strings | Unterminated single quote falls back/throws, as a pair | pair | both |
| C-057 | §6.1.4 | Comments | \# preserves the hash and removes the escape backslash | positive | both |
| C-058 | §6.1.4 | Comments | Only the immediately preceding backslash counts | positive | both |
| C-060 | §6.1.5 | Block scalar | \| produces a multiline string | positive | both |
| C-061 | §6.1.5 | Block scalar | Dedent ends the block scalar | positive | both |
| C-062 | §6.1.5 | Block scalar | Indented hash line is literal | positive | both |
| C-063 | §6.1.5 | Block scalar | Smallest non-empty indentation is removed | positive | both |
| C-064 | §6.1.5 | Block scalar | Internal blank lines are preserved | positive | both |
| C-065 | §6.1.5 | Block scalar | Trailing blank lines/newlines are stripped | positive | both |
| C-066 | §6.1.5 | Block scalar | Indented freetext without \| yields null | fallback | non-strict |
| C-067 | §6.1.5/§10 | Block scalar | Indented freetext without \| throws | error | strict |
| C-068 | §6.1.6 | Continuation | ^^ joins with exactly one space | positive | both |
| C-069 | §6.1.6 | Continuation | Bare ^^ is discarded | positive | both |
| C-070 | §6.1.6 | Continuation | ^^ on the first content line loses the marker | positive | both |
| C-071 | §6.2 | Null | Empty, null, and ~ all yield null | positive | both |
| C-072 | §6.3 | Boolean | Only lowercase true/false are booleans | positive | both |
| C-080 | §6.4.1 | Numbers | Integer, decimal, leading-dot, and exponent grammar | positive | both |
| C-081 | §6.4.1 | Numbers | Invalid exponent forms remain strings | fallback | both |
| C-082 | §6.4.2 | Numbers | Safe-integer maximum and minimum are accepted | boundary | both |
| C-083 | §6.4.2 | Numbers | Integer outside the safe range remains a string | fallback | both |
| C-084 | §6.4.2 | Numbers | -0 and -0.0 are normalized to positive zero | positive | both |
| C-085 | §6.4.2 | Numbers | Float overflow falls back to string | fallback | non-strict |
| C-086 | §6.4.2/§10 | Numbers | Float overflow throws | error | strict |
| C-087 | §6.4.2 | Numbers | Non-zero underflow falls back to string | fallback | non-strict |
| C-088 | §6.4.2/§10 | Numbers | Non-zero underflow throws | error | strict |
| C-089 | §6.4.2 | Numbers | Subnormal non-zero is accepted | boundary | both |
| C-090 | §6.4.3 | Numbers | Plus sign, trailing dot, leading zero, hex/octal/binary all remain strings | fallback | both |
| C-100 | §6.5.1 | Dates | All supported ISO forms | positive | both |
| C-101 | §6.5.1 | Dates | German one-/two-digit formats | positive | both |
| C-102 | §6.5.1 | Dates | Slash formats | positive | both |
| C-103 | §6.5.2 | Dates | Leap year and month lengths | boundary | both |
| C-104 | §6.5.2 | Dates | Invalid component remains a string | fallback | non-strict |
| C-105 | §6.5.2/§10 | Dates | Invalid component throws | error | strict |
| C-106 | §6.5.2 | Dates | Offset ±14:00 valid, 14:01 invalid | boundary | both |
| C-107 | §6.5.3 | Dates | Offset is correctly converted to UTC | positive | both |
| C-108 | §6.5.3 | Dates | UTC result outside 0001–9999 falls back/throws | pair | both |
| C-109 | §6.5.4 | Dates | Explicitly excluded date-like forms remain strings | fallback | both |
| C-110 | §6.5.4 | Dates | String containing @ is not recognized as a date | fallback | both |
| C-120 | §7.1 | Indentation | Base indentation set by the first content line | positive | both |
| C-121 | §7.1 | Indentation | Direct children sit exactly at base indentation | positive | both |
| C-122 | §7.1 | Indentation | A deeper line belongs to the previous key | positive | both |
| C-123 | §7.1 | Indentation | Inconsistent indentation is skipped | fallback | non-strict |
| C-124 | §7.1/§10 | Indentation | Inconsistent indentation throws | error | strict |
| C-125 | §7.1 | Indentation | Blank/comment lines do not set the base | positive | both |
| C-130 | §7.2 | Block sequence | Scalars and bare dash/null | positive | both |
| C-131 | §7.2 | Block sequence | Object item sibling indentation | positive | both |
| C-132 | §7.2 | Block sequence | Nested sequence is consumed as a single null | fallback | non-strict |
| C-133 | §7.2/§10 | Block sequence | Nested sequence throws | error | strict |
| C-140 | §7.3 | Block mapping | Nested mappings of arbitrary depth up to the limit | positive | both |
| C-141 | §7.3 | Block mapping | Key without content becomes null | positive | both |
| C-150 | §7.4 | Flow sequence | Empty and flat sequence | positive | both |
| C-151 | §7.4 | Flow sequence | Quoted comma remains item content | positive | both |
| C-152 | §7.4 | Flow sequence | Trailing comma is ignored | fallback | non-strict |
| C-153 | §7.4/§10 | Flow sequence | Trailing comma throws | error | strict |
| C-154 | §7.4 | Flow sequence | Leading/consecutive comma becomes null | fallback | non-strict |
| C-155 | §7.4/§10 | Flow sequence | Empty element throws | error | strict |
| C-156 | §7.4 | Flow sequence | Unclosed outer flow falls back to the entire string | fallback | non-strict |
| C-157 | §7.4/§10 | Flow sequence | Unclosed flow throws at the opening line | error | strict |
| C-158 | §7.4 | Flow nesting | A sequence of flat mappings is allowed | positive | both |
| C-159 | §7.4 | Flow nesting | Depth > 1 throws in both modes | error | both |
| C-160 | §7.5 | Flow mapping | Empty and flat mapping | positive | both |
| C-161 | §7.5 | Flow mapping | Quoted keys follow block-key rules | positive | both |
| C-162 | §7.5 | Flow mapping | First ': ' at the current depth is the separator | positive | both |
| C-163 | §7.5 | Flow mapping | Invalid item is skipped in non-strict mode | fallback | non-strict |
| C-164 | §7.5/§10 | Flow mapping | Invalid item throws | error | strict |
| C-170 | §8 | Comments | Comment lines at every mapping level | positive | both |
| C-171 | §8 | Comments | Comments inside array objects | positive | both |
| C-180 | §9 | Limits | Document of 65,536 UTF-8 bytes is allowed | boundary | both |
| C-181 | §9 | Limits | Document of 65,537 bytes throws | error | both |
| C-182 | §9 | Limits | Nesting depth 16 is allowed, 17 throws | boundary | both |
| C-183 | §9 | Limits | 128 top-level entries allowed, 129 throws | boundary | both |
| C-184 | §9 | Limits | Duplicates count toward the top-level budget | boundary | both |
| C-185 | §9 | Limits | Key of 128 code points allowed, 129 throws | boundary | both |
| C-186 | §9 | Limits | Decoded quoted key is measured in code points | boundary | both |
| C-187 | §9 | Limits | Scalar of 16,384 code points allowed, 16,385 throws | boundary | both |
| C-188 | §9 | Limits | Code points, not UTF-16 units/bytes | boundary | both |
| C-190 | §10 | Strict list | The strict list is closed; unknown top-level lines remain tolerated | negative | strict |
| C-200 | §11.1 | API | parseCore returns a Record/mapping | api | both |
| C-201 | §11.2 | API | strict defaults to false | api | non-strict |
| C-202 | §11.2 | API | onWarning receives a Diagnostic with message and line | api | non-strict |
| C-203 | §11.3 | API | Errors are at minimum a plain Error with a message | api | both |
| C-210 | Appendix B | Core/References | Core treats ($key) and (%key) as strings | positive | both |

**Scope:** 125 substantive check points. A check point can produce multiple concrete cases.

## Known legacy-parser gaps

Two check points cannot currently be exercised against `js/src/index.ts`
(`package/` origin, predates the frozen 1.0 split of Core vs. References)
and are deliberately left without a corpus case rather than forced into one:

- **C-202** (`onWarning` receives a Diagnostic): the legacy parser has no
  `onWarning` callback — it emits `console.warn` directly (see
  `corpus/runner/src/run.ts`'s `invokeLegacyParser` doc comment). Warnings
  are captured and reported as a non-blocking note, never compared against
  `expect.warnings`.
- **C-210** (Core treats `($key)`/`(%key)` as plain strings): the legacy
  parser exposes a single `parse()` that always performs References
  resolution — there is no separate `parseCore()` entry point that skips
  it, as Appendix B requires of a genuine Core-only parser. Revisit once a
  `parseCore` distinct from `parseReferences` exists.
