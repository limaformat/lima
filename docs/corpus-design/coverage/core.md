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
| C-211 | Appendix A | Unsupported | Chomping indicators `|-`/`|+` are ordinary strings, freetext skipped | pair | both |
| C-212 | Appendix A | Unsupported | YAML anchors/aliases (`&`, `*`) and tags (`!!str`, `!!int`) are literal | fallback | both |
| C-213 | Appendix A | Unsupported | Multi-document markers (`---`, `...`) are unrecognized lines | fallback | both |
| C-214 | Appendix A | Unsupported | Year 0000 is date-shaped but fails component validation | pair | both |
| C-215 | Appendix A | Unsupported | Negative year never matches the date grammar | fallback | both |
| C-216 | Appendix A | Unsupported | `\0` is an unknown escape, not a null shorthand | pair | both |
| C-217 | Appendix A | Unsupported | `parseCore` ignores an unsupported `partials` option entirely | api | both |
| C-218 | §6.1.5 (1.0.1) | Block scalar | A dedented comment line ends the scalar; the `#` line is not absorbed | positive | both |
| C-219 | §6.1.5 (1.0.1) | Block scalar | A dedented non-key, non-comment line ends the scalar and is dropped | positive | both |
| C-220 | §6.1.5 (1.0.1) | Block scalar | Full common indentation is removed; no cap tied to the key's length | positive | both |
| C-221 | §6.1.5 (1.0.1) | Block scalar | A single-space content indentation is still removed uniformly | positive | both |
| C-222 | §6.1.5 (1.0.1) | Block scalar | `\|` introduced by a nested key is a block scalar | pair | both |
| C-223 | §6.1.5 (1.0.1) | Block scalar | A sibling key at the nested key's column resumes normally after the scalar | positive | both |
| C-224 | §6.1.5 (1.0.1) | Block scalar | `\|` introduced by a key inside a block sequence item is a block scalar | positive | both |
| C-225 | §6.1.2/§10.1 (1.0.1) | Strings | An escaped closing quote (`"a\""`) leaves the string unterminated — strict throws, non-strict falls back to a literal | pair | both |
| C-226 | §6.1.3/§10.1 (1.0.1) | Strings | `'a\''` is unterminated — `\'` is the single-quote escape, not a close | error | strict |
| C-227 | §10.1 (1.0.1) | Strings | "Unterminated quoted string" strict check applies to a quoted flow-sequence item | error | strict |
| C-228 | §10.1 (1.0.1) | Strings | "Content after closing quote" strict check applies to a quoted flow-sequence item and a flow-mapping value | error | strict |
| C-229 | §5.2 (1.0.1) | Keys | An unquoted key with a space is not a key in a nested or flow mapping (skipped in both modes), matching the top level | positive | both |
| C-230 | §5.1 (1.0.1) | Keys | The `: ` separator is found outside a quoted key, so a quoted nested/flow key may contain `: ` | positive | both |
| C-231 | §5.2 (1.0.1) | Keys | A double-quoted nested key decodes `\"` escapes; the inner quotes do not end the key | positive | both |
| C-232 | §5.2/§10.1 (1.0.1) | Keys | An unknown escape in a double-quoted key throws in strict mode, at the top level and nested | error | strict |
| C-233 | §5.2 (1.0.1) | Keys | An unquoted key with a space in a block sequence item is not a mapping; the item is a literal scalar | positive | both |
| C-234 | §4/§6.1.3 (1.0.3) | Comments | A comment line does not end the lookahead for whether a bare key has a nested block | positive | both |
| C-235 | §4/§6.1.3 (1.0.3) | Comments | The comment-skip applies to a bare key at any depth, not only the top level | positive | both |
| C-236 | §4/§6.1.3 (1.0.3) | Comments | Skipping a comment does not manufacture content: a bare key followed only by a dedented sibling after the comment is still `null` | positive | both |
| C-237 | §7.2 (1.0.4) | Block sequence | A bare key as a block sequence item's first key has a nested block | positive | both |
| C-238 | §7.2 (1.0.4) | Block sequence | A bare key as a block sequence item's continuation key also has a nested block | positive | both |
| C-239 | §7.2 (1.0.4) | Block sequence | A sibling key after a bare key's nested block resumes as a further continuation key of the same item | positive | both |
| C-240 | §7.2 (1.0.4) | Block sequence | A bare key with nothing more indented following it is `null`, the same as a bare key anywhere else | positive | both |
| C-241 | §5.1 (1.0.5) | Keys | A dotted unquoted key is not a key at the top level; the line is skipped and strict does not throw (not in §10) | positive | strict |
| C-242 | §5.1 (1.0.5) | Keys | A dotted unquoted key is not a key in a nested mapping; the bare outer key is left with no child | positive | strict |
| C-243 | §5.1 (1.0.5) | Keys | A dotted unquoted key is not a key in a flow mapping; the entry is dropped | positive | strict |
| C-244 | §5.1 (1.0.5) | Keys | A dotted unquoted key in a block sequence item is not a mapping; the item is a literal scalar | positive | both |
| C-245 | §5.1 (1.0.5) | Keys | A key beginning with NBSP is not an unquoted key in any implementation, independent of the Unicode-indentation decision | positive | both |
| C-246 | §5.1 (1.0.5) | Keys | `:`, `-`, leading `_`, and trailing digits stay valid unquoted-key characters in nested and flow mappings, not only at the top level | positive | both |
| C-247 | §7.2 (1.0.6) | Block sequence | A line at a bare *first* key's own column is the next sibling key, not the key's nested block — the bare key is `null`; strict does not throw | positive | strict |
| C-248 | §7.2 (1.0.6) | Block sequence | The same for a sibling key that carries an inline value | positive | both |

**Scope:** 132 substantive check points (plus the 1.0.x errata rows below). A check point can produce multiple concrete cases.

## Core 1.0.x errata (2026-09)

All 1.0.x rows were added for defects the 2026-09 independent review found
(`docs/review-2026-09-followups.md`). No spec text changed — these cover
behaviour Core always specified but no 1.0.0 fixture exercised. No 1.0.0
case changed result. The `since` marker in `corpus/manifests/core-1.0.json`
records each addition's revision; the 149-case 1.0.0 baseline stays
byte-frozen.

### Block scalars — C-218–C-224 (P0 #1)

- **Extent.** The top-level `|` path absorbed any dedented line up to the
  next top-level key, so a dedented comment (the §6.1.5 example verbatim)
  or dedented freetext landed in the scalar. It now ends at the first
  non-blank line indented to the key's column or less.
- **Indentation trimming.** The removed amount was capped at `key.length
  + 2`, and a one-space indent was removed as zero. Now it is exactly the
  smallest leading-space count among the non-empty content lines.
- **Nesting.** `|` was only recognised from the top-level key scan;
  introduced by a nested key it stayed the literal string `"|"`. It is
  now handled at any depth (`js/src/block-scalar.ts`, shared by
  `core.ts` and `block.ts`), matching §6.1.5's depth-agnostic wording and
  closing `docs/decisions/nested-block-scalars-not-supported.md`.

### Key and quote lexing — C-225–C-233 (P1 #2/#3)

- **Escape-aware quoted termination.** "Is this quoted scalar closed at its
  final character?" is now escape-aware everywhere (`closingQuoteIndex`),
  so `"a\""` / `'a\''` are correctly unterminated. §10.1's "unterminated
  quoted string" and "non-whitespace content after closing quote" strict
  checks apply in every value position — top-level, flow sequence, flow
  mapping, block sequence item — not only the top level.
- **Key separator.** `findKeySep` / the flow-mapping separator search skip
  past the (escape-aware) closing quote first, so `{"a: b": v}` and
  `"say \"hi\"": v` parse as one key.
- **Key escapes.** A double-quoted key's escapes are strict-checked through
  every mapping context, not only the top level.
- **Malformed unquoted keys.** An unquoted key with interior whitespace is
  treated as an unrecognised line/item in nested and flow mappings, the
  same as at the top level (§5.2). §10's strict list is closed and does
  not cover this, so it is skipped in both modes, not thrown. This step
  rejected only interior ASCII space/tab; the full §5.1 grammar is
  enforced by C-241–C-246 (1.0.5).
- A literal newline inside a top-level quoted key is still accepted
  (`docs/review-2026-09-followups.md` P2 #11).

### Comment lines before a nested block — C-234–C-236 (P1 #4)

`docs/decisions/comment-lines-and-bare-key-block-detection.md`, decided
2026-09-04, option C. §4 rule 7 / §6.1.3 state that a comment line does not
affect base indentation and is skipped; the lookahead that decides whether
a **bare key** (`key:` with no inline value) has a nested block only
skipped blank lines, so a comment between the key and its real nested
content ended the lookahead early and the content was lost (`{key: null}`
instead of the nested mapping). Fixed at every bare-key lookahead site —
top level, nested mapping. Go additionally had this same gap for a plain
*blank* line at the nested-mapping site (not only comments) — its
lookahead there had no skip loop at all, unlike the top level's.

Not fixed in this batch (a separate, unrelated gap found incidentally
while porting): Go's block-sequence branch (`- key:`) does not support a
bare key with a nested block at all, in either the first-item or
continuation-key position — `items:\n  - key:\n      nested: value`
parses `key:` as a literal string item instead of `{key: {nested: value}}`.
TypeScript and Rust handle this correctly. Tracked as item 12 in
`docs/review-2026-09-followups.md`; closed below.

### Key grammar §5.1 — C-241–C-246 (Core 1.0.5, Codex re-review MAJOR 1)

The P1 #2/#3 step centralised *where a key ends* but only rejected an
unquoted key with an interior ASCII space/tab. The §5.1 pattern
`[a-zA-Z0-9_][a-zA-Z0-9_:\-]*` was still enforced only by the top-level
scanner (`js/src/scanner.ts`), not in the block-nested or flow contexts,
and not at all in the Rust or Go top-level scanners — so `a.b`, `/x`,
`($x)`, `${x}`, and a leading-NBSP key were accepted as Core syntax in
some contexts and languages but not others. `isValidKey`
(`scalars.{ts,rs}` / `scalars.go`) now enforces the full §5.1 grammar for
unquoted keys, shared by all three mapping contexts in all three
languages. A non-conforming unquoted key is an unrecognised line/item,
skipped in both modes (§4; §10's list stays closed).

Two existing cases changed expectation, not classification:
`references(-2).unsupported.references-in-keys-remain-literal` — the
unquoted flow key `{($a): v}` / `{${a}: v}` is now dropped (`m: {}`); each
case's quoted-key half still demonstrates the token staying literal. The
frozen References 1.0 case was amended once, with its manifest `sha256`
and `corpus/runner/src/manifests.ts`'s `BASELINE_DIGESTS` re-pinned in the
same commit — the deliberate, reviewable baseline-amendment path that the
BLOCKER 1 fix established.

`docs/decisions/structural-indentation-unicode-whitespace.md` is
unaffected: it governs whether Unicode whitespace is *indentation*, not
whether it may appear in a key. TypeScript still treats NBSP as
indentation and so still differs from Rust/Go on
`parent:\n  a:\n\u00a0\u00a0b: value` (where `b` reparents under `parent`
in TS but the line is dropped in Rust/Go) — but all three now agree that
`\u00a0key` is not a key.

### Bare keys in block sequence items — C-237–C-240 (item 12)

TypeScript and Rust already supported a bare key (no inline value) as a
block sequence item's first key or a later continuation key, with a
nested block looked ahead for the same way as anywhere else. Go's
`parseBlock` array branch never attempted this at all — only `key: value`
(via `findSep`) — so `- key:` fell through to being parsed as the literal
scalar `"key:"`, and a bare continuation key broke out of the
continuation loop entirely, silently dropping the key (non-strict) or
throwing a confusing "mixed array and map entries" error (strict).
Fixed in `go/core.go` with two new helpers, `bareNestedValue` (the same
blank/comment-skipping lookahead as the top-level and nested-mapping
bare-key sites) and `parseArrayItemContinuationKeys` (replacing the old
value-only inline loop, now handling both forms). Verified against the
sibling-after-nested-block form as well as the straightforward one.

The same-column-as-key case, matched byte-for-byte against TypeScript at
the time, turned out to be a shared bug — see C-247/C-248 below.

### Block-sequence first bare key over-nested same-column content — C-247–C-248 (Core 1.0.6, Codex re-review CR-M2)

The *first* bare key of a block-sequence object item chose its nested
block by comparing the next line's indentation against the item's dash
column, not against the key's own column (the key sits after `- `, at
least two columns deeper). A line at the key's own column — the next
sibling key per §7.1 rule 3 / §7.2 — was wrongly absorbed as the key's
nested block. All three implementations had this; the item-12 Go port
reproduced it from TypeScript. The *continuation*-key position and a
plain nested mapping were already correct. Now every bare-key site
compares against the key's column: `block.ts` computes it from the cursor,
`block.rs` gains `dash_key_column`, `core.go`'s `bareNestedValue` takes
the key column as its threshold (the dash-relative offset for a first key,
`lineStructuralIndent` for a continuation key). The C-237–C-240 fixtures
use correct deeper indentation and are unaffected.

## Known implementation gaps

None currently. The previous entry, **C-202** (`onWarning` receives a
Diagnostic with message and line), is now covered: `parseCore`/
`parseReferences` both accept an `onWarning?: (diagnostic: { message:
string; line: number }) => void` option (Core §11.2's exact shape) and
never emit to `console.warn` — the four existing duplicate-key-warning
cases (`core.keys.duplicate.*-warning`) are compared against
`expect.warnings` for real now (the corpus runner's `invokeParser` wires
`onWarning` through the same message-classifying adapter used for thrown
errors — see `corpus/runner/src/run.ts` — instead of capturing
`console.warn` output, which no longer happens at all).

**C-210** (Core treats `($key)`/`(%key)` as plain strings) is covered by
`core.api.parse-core-never-resolves-references`, which calls `parseCore`
directly (via the case's `api: "core"` field) with strict mode on and two
unresolvable tokens — no `UNRESOLVED_REFERENCE` is thrown, proving Core
never even recognizes the syntax, let alone resolves it.

## Maintainability audit: Appendix A constructs (first step)

A 2026-08-04 maintainability audit (same one that found the References §7
strict-mode gaps, see `coverage/references.md`) found that most of Core's
Appendix A ("What Lima Core Does Not Support") had never had a single
corpus case verifying the documented behavior — the exceptions being the
already-covered `>` folded marker and the excluded date forms (C-109).
C-211 through C-215 close five of these, each added only after confirming
actual runtime behavior first rather than assuming the appendix's stated
reason implies a specific parse result:

- Chomping indicators behave exactly like `>` (ordinary string, freetext
  silently skipped, identical in both modes) — genuine strict/non-strict
  pair, mirroring the `>` cases.
- YAML anchors/aliases/tags have no scanner special-casing at all and
  remain part of the unquoted string — one case; no strict-list condition
  can ever fire for them, so no pair is needed.
- Multi-document markers turned out to be nothing more than instances of
  the general "unrecognized top-level line" mechanism (C-022), already
  strict-mode-verified there — one case documents the specific construct
  without a redundant strict pair.
- Year 0000 was the one surprise: it *is* syntactically date-shaped and
  fails ordinary calendar-component validation, making it a genuine
  instance of the existing C-104/C-105 strict-error-list check rather
  than a distinct "unsupported form" — it needed its own strict/non-strict
  pair, and is distinct from C-108 (a valid literal year pushed out of
  range by UTC offset, not the literal year field itself).
- A negative year, by contrast, never matches the date grammar and stays
  a plain string unconditionally — one case, no strict variant.

## Maintainability audit: Appendix A constructs (second step — `\0` escape)

C-216 closes the `\0` escape row. Checked the implementation first,
same discipline as the first step: `SINGLE_CHAR_ESCAPES` in
`js/src/scalars.ts` already deliberately excludes `'0'`, with a comment
citing this exact appendix row — so `\0` already falls through to the
general "unknown escape" path (§6.1.2/§10.1) with no special-casing,
verified against actual parser output before writing the cases. No
implementation change was needed; this was a pure coverage gap, not a
live defect (unlike the References-side Date-aliasing bug) — the fix
for this specific row predates this audit, see the `run.test.ts`
baseline history's 60/0/0 entry.

## Maintainability audit: Appendix A constructs (third step — `partials` on `parseCore`)

C-217 closes the last Core Appendix A row from this audit. This turned
out not to be an open design question after checking the code: `CoreOptions`
(`js/src/core.ts`) only has `strict` and `onWarning` — there is no
`partials` field, and `parseCore` never reads one even if an untyped
caller supplies it. Verified directly: calling `parseCore` with a
`partials` option (via a type-bypassing cast, the same way an untyped JS
caller could) produces byte-identical output to calling it without one,
in both modes, with `(%key)` staying an unresolved literal string either
way — confirmed against actual output before writing anything.

**Resolved without a dedicated corpus case:** the schema's own `api`
field documentation already states that `api: "core"` cases must not set
`options.partials` (`parseCore` has no such option), and the runner's
core-api branch (`corpus/runner/src/run.ts`) never forwards `partials`
to `parseCore` regardless of what a case sets — so a corpus case could
only ever prove the *runner* doesn't forward it, not that `parseCore`
itself tolerates an untyped caller passing it. Covered instead by two
unit tests in `js/src/misc.test.ts` that import `parseCore` directly and
bypass the type constraint, the same reasoning as R-032/R-137 in
`coverage/references.md`.

This closes the Core Appendix A portion of the audit. The last item —
the References Appendix "host-language types in partials" row — turned
out to already be fully covered (`references.test.ts`'s R-137/R-135
cases); see `coverage/references.md` for that finding, which was a stale
doc reference rather than a coverage gap.
