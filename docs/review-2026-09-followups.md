# Review follow-ups — 2026-09

Consolidated, prioritised worklist from the first independent whole-repo
review (external review 2026-09-04, cross-checked against the code at
`da292ff`). Companion to [`follow-ups.md`](follow-ups.md); supersedes none
of it.

Two axes: **priority** (P0 = blocks the next Core 1.0 release because valid
input is parsed incorrectly) and **type** (code bug / corpus infra / docs /
decision to close).

Findings referenced as `B1`, `M1` … map to the external review's
BLOCKER/MAJOR numbering.

---

## P0 — blocks a Core 1.0 freeze

### 1. Rebuild the block-scalar path — code (TS + Rust + Go) — B1

**Status: done (Core 1.0.1).** Each implementation now has one shared
block-scalar primitive called by both the top-level and the nested path
(`js/src/block-scalar.ts`, `rust/src/block_scalar.rs`,
`go/block_scalar.go`). Corpus cases C-218–C-224; Core suite 149 → 157;
`corpus/manifests/core-1.0.json` carries per-entry `since` markers with the
149-case 1.0.0 baseline frozen. All three implementations pass the full
157-case suite.

The top-level `key: |` path in `js/src/core.ts` (`parseEntry`, ~L254–318)
does its own ad-hoc block-scalar slurping and gets three independent things
wrong:

- **1A — no extent check.** Dedented `#` lines and other dedented non-key
  text are absorbed into the scalar. The verbatim Core §6.1.5 example
  (`description: |` / `  Text` / `# top-level comment` / `title: Hello`
  → `description = 'Text'`) fails: the implementation returns
  `"  Text\n# top-level comment"`.
- **1B — wrong indentation trimming.** `core.ts:267`
  `minIndent = Math.min(minIndent, key.length + 2)` is an arbitrary cap
  with no basis in the spec. `core.ts:268` treats `minIndent === 1` as
  `trimAmt = 0`, so a one-space content indent is never removed. Every
  block-scalar corpus case uses the 11-char key `description:`, so the cap
  never bites.
- **1C — nested block scalars unimplemented.** `block.ts` does not
  recognise `|` at all; a `|` under a nested key yields the literal string
  `"|"`. Core §6.1.5 imposes no top-level restriction. (Decision:
  implement — see `decisions/nested-block-scalars-not-supported.md`,
  option A.)

**Fix:** one shared block-scalar scanner, callable from both the top-level
scan and `block.ts`. Extent = "indentation strictly greater than the
introducing key, `#` lines included"; content indent = "smallest number of
leading spaces among all non-empty content lines, from column 0"; keep the
existing `^^` continuation and trailing-strip behaviour.

**Corpus:** dedented comment ends scalar; dedented non-key text ends
scalar; short key + deep content indent; one-space content indent; nested
`|` (mapping-under-mapping, array-item-under-key).

**Effort:** medium–large; coordinated three-language release.

---

## P1 — before the freeze

### 2. Centralise key + quote lexing — code (TS + Rust + Go) — M2

**Status: done, all three languages (Core 1.0.2).** Shared `closingQuoteIndex`
(`js/src/scalars.ts`, `rust/src/scalars.rs`, `go/scalars.go` — escape-aware
quote termination); the top-level/nested/flow-mapping separator searches
skip past the closing quote; unquoted keys with interior ASCII space/tab
are rejected in nested/flow the way they already were at the top level;
double-quoted key escapes are strict-checked in every mapping context.
Corpus cases C-225–C-233 (`since: "1.0.2"`), all three implementations pass.
**Decision (2026-09-04):** a malformed unquoted key is an unrecognised
line/item in *both* modes — §10's strict list stays closed. Only an ASCII
space/tab is rejected — deliberately not the full Unicode whitespace class,
to avoid regressing each port's own Unicode-structural-indentation handling
(`docs/decisions/structural-indentation-unicode-whitespace.md`; caught by
Go's existing `TestUnicodeWhitespaceIsNotStructuralIndentation` test during
the port). `a.b` / `($x)` unquoted keys are still accepted in nested/flow
(the frozen 1.0 corpus relies on `{($a): v}`), and a newline in a quoted
key is still accepted (P2 #11).

Top-level, block-nested and flow mappings each enforce a different, weaker
notion of where a key ends. Concrete cases:

| Input | Current | Expected (§5.1 / §5.2) |
|---|---|---|
| `outer:\n  bad key: value` (space) — even strict | `{outer:{"bad key":"value"}}` | invalid unquoted key → skip / (strict) throw |
| `outer:\n  bad.key: value` (dot) | accepted | same |
| `m: {bad key: value}` (flow) | accepted | same |
| `m: {"a: b": value}` (flow, quoted key with `:`) | `{"m":{"\"a":"b\": value"}}` | key = `a: b` |
| `m:\n  "say \"hi\"": v` (nested, escaped quote) | `{m: null}` | key = `say "hi"` |
| `"bad\q": value` (unknown escape in a double-quoted key), strict — **at every level** | accepted | §10.1 → throw |

**Fix:** one key reader (quote-aware separator search, shared unescape with
strict-mode threaded through), used by all three mapping contexts.

### 3. Strict quoted-string recognition: escape-aware and context-independent — code (TS + Rust + Go) — M3

**Status: done, all three languages, shipped together with #2** (same
`closingQuoteIndex` primitive). `parseQuotedOrTyped` (and its Rust/Go
equivalents) enforce §10.1's "unterminated quoted string" and "content
after closing quote" checks in every value position — top level, flow
sequence, flow mapping, block sequence item. Corpus cases C-225–C-228.

- `v: "abc\"` — the only closing quote is escaped, so the string is
  unterminated → §10.1 "Unterminated quoted string" must throw in strict.
  It did not (the check was only "first char == last char"). Fixed.
- Flow: `v: ["abc]` (unterminated) and `v: ["x" trailing]` (content after
  the closing quote) passed in strict; §10.1 requires a throw. Fixed.
- **Corrected from the original finding:** `'abc\'` is *also* unterminated —
  `\'` is the single-quote escape (§6.1.3), so there is no closing quote.
  Strict now throws (C-226).
- Still to verify: the single-quote / `#` / backslash interaction in the
  comment stripper (M3 part C) — plausible, not reproduced. → P2 #11.

### 4. Comment line before a nested block — code (TS + Rust + Go) + corpus — M4 — decision: option C

**Status: done, all three languages (Core 1.0.3).** `key:\n# comment\n
nested: value` used to yield `{key: null}` — the nested content silently
lost. Core §4 rule 7 / §6.1.3: comment lines are skipped, including in the
lookahead that decides *whether* a bare key has a nested block at all — now
true at every such site (top level, nested mapping) in all three
implementations. Go's nested-mapping lookahead had no skip loop at all
before this (not even for a blank line) — a strictly worse instance of the
same bug, found during the port. Corpus cases C-234–C-236, `since:
"1.0.3"`. See `decisions/comment-lines-and-bare-key-block-detection.md`.

### 5. References 2.0 error provenance: source-based — code (TS + Rust + Go) — M1

**Status: done, all three languages.** A three-language issue, not TS-only
(References 2.0 ships in all three); Codex's second re-review escalated the
first, container-relative attempt to a full **§2.4 physical position,
codepoint-based, cross-language-identical, exposed as `column`**:

- **Physical `(line, offset)`.** Every reference token now carries its real
  1-based source line and 0-based **codepoint** offset within that line
  (`x: café ${m}` → offset 8, not a scalar-local 5). The offset is read by
  scanning the *raw* value text — for a block scalar, the original body
  lines, so a `^^`-continuation token keeps its real line (§2.4's explicit
  "MUST NOT be reconstructed from the merged string"). `ReferenceSource`
  (`{raw?, line, col}` in TS / `ReferenceSource`/`referenceSource` in
  Rust/Go) is threaded from every value-parse site — `core`, `block`,
  `flow`, `block-scalar` — carrying the value's physical column;
  `scanReferenceTokens2` / `scan_tokens` zip a raw-source scan (line/offset)
  with the decoded scan (splice index). The old `StringSourceSpan` /
  per-line-span machinery is gone.
- **1A** (flow-element ordering) falls out of the above: each element's
  tokens are anchored at the element's real column within the container.
- **1B** `INVALID_REFERENCE_SHAPE` carries the token's offset; TS's
  `InsertedAt` gained `offset` and `earliestParticipant` an offset
  tie-break (Rust/Go already had both). TS now sets `LimaError.column`
  (`offset + 1`) on References throws — Rust/Go already did.

Corpus R2-064 (4 cases), now asserting `expect.error.column`; TS/Rust/Go
produce byte-identical `(line, column)`. References 2.0 suite 119 → 123.

Ordering rule: §5 (earliest source position wins — line, then codepoint).

**Original-source position (Codex CR3 MAJOR 1, now fixed):** §2.4 fixes a
token's column to its physical position in the *original* source text,
before Core normalization. Two normalizations previously shifted a later
token's reported column:

- a `\#` escape immediately before a token on the same line (collapses to
  `#` in the decoded value); and
- Core §3 leading-tab expansion (tab → two spaces), inline, nested, and
  inside a block scalar.

Both are fixed: the value text with a trailing comment removed but `\#`
left intact (`stripCommentKeepEscapes` / `physicalRaw`) is threaded to the
reference scan as `source.raw`, and a per-physical-line `tabAdjust` count
(columns added by tab expansion) is subtracted from each token's column.
Verified identical across TS/Rust/Go. Corpus R2-065 (4 `error-position-*`
cases) plus 2 comment-scan guard cases; References 2.0 suite 123 → 129.

**Zip invariant now hard-enforced (Codex CR3 MINOR 1):** the raw-vs-decoded
reference-token scan length mismatch throws (`Error` / `panic!` /
`assert_eq!`) in all three, not just TS.

**`parseCore` skips source construction (Codex CR3 MINOR 2):** the
positioned source anchor is built only for the positioned builder
(`builder === positionedBuilder` / `B::POSITIONED` / `captureReferences`);
`parseCore`'s native builder discards it, so it is no longer computed.

### 5b. Key column must be codepoint-based — code (Rust + Go) — Codex CR-M2 follow-up

**Status: done.** The §7.2 sibling-column check (CR-M2) computed the key's
column after `- ` in UTF-8 bytes (`dash_key_column` / `core.go`), so a
multi-byte space after the dash (`- <NBSP>key:`) put the column one past
where TypeScript (UTF-16 units) placed it, and the same following line was
treated as a nested block in TS but a sibling key in Rust/Go. Both now
count codepoints.

### 6. Point the Core corpus gate at the public API — corpus infra (`corpus/runner/`) — M6

**Status: done.** `loader.ts` defaulted every `spec: "core"` case with no
explicit `api` to `references` — dispatching it to `parseReferencesV1`,
the internal References 1.0 resolver, which never shipped in the public
API. 173 of 174 Core cases had no explicit `api` and so ran through it.
Fixed: the default is now spec-aware (`spec === 'core'` → `core`); the
schema rejects an explicit `api: "parse"`/`"references"` on a `spec:
"core"` case as nonsensical. Every `spec: "core"` case is now *also*
cross-checked against `parse` (References 2.0) — Core is reference-unaware
by construction, so the two builders (`nativeBuilder`, `positionedBuilder`)
must agree exactly on referenceless input: the same value on success, and
(since CR-M4) the same diagnostic code and line on error. This is the part
of the fix that actually exercises the public References entry point on
Core input, not only `parseCore`. Full corpus re-run clean, every case
through `parseCore` and cross-checked against `parse` with no divergence.
Rust and Go
needed no change: both already call the public Core entry point directly
for `corpus/core/*.json`, never routed through an `api` field.

### 7. Clarify the References 1.0 status — docs

**Status: done.** `README.md` presented "101 frozen References 1.0 cases …
passed by …" and "250 cases, content-hash protected" as a live property,
though the language feature never shipped in the public API — now states
the runnable reference API is Core 1.0 + References 2.0, References 1.0 is
frozen history. `AGENTS.md` listed only Core 1.0 + References 1.0 as
normative — now names References 2.0 and states the References 1.0 status
precisely.

### 12. Go: bare key with a nested block unsupported in a block sequence — code (Go)

**Status: done.** Found incidentally while fixing #4. `items:\n  -
key:\n      nested: value` used to parse `key:` as a literal string item
(`["key:"]`) instead of `[{key: {nested: value}}]`, in both the
first-item and continuation-key position of a block-sequence item's
mapping — TypeScript and Rust already handled this correctly; Go's
`parseBlock` array branch never attempted the bare-key case at all, only
`key: value` (via `findSep`). Fixed with two new helpers in `go/core.go`,
`bareNestedValue` and `parseArrayItemContinuationKeys` (see
`docs/corpus-design/coverage/core.md`'s "Bare keys in block sequence
items" section). Corpus cases C-237–C-240, `since: "1.0.4"`. Verified
against a sibling key resuming after the nested block, and the
same-column-as-key edge case (content indented no deeper than the key
itself still nests under it, matching TypeScript's existing behaviour
exactly, not just "some deeper indent works").

---

## Codex re-review — 2026-09-07

Independent re-review of the batch above (`cbc2701..9fcc88d`) by Codex,
cross-checked against the code. Findings `CR-B1`, `CR-M1` … below.

### CR-B1. The frozen manifest did not actually freeze the baseline — corpus infra

**Status: done, commit `10ba6c6`.** `verifyFrozenManifest` only ever
compared the corpus against the committed manifest, and `regenerateManifest`
re-read every file and adopted its current id/hash — so editing a 1.0.0
case and re-running `write-frozen-manifests.ts` absorbed the change
silently. Fixed: `regenerateManifest` carries baseline entries
(`since === baselineVersion`) forward verbatim and throws on an edited /
added / removed baseline file; new `BASELINE_DIGESTS` constant in
`manifests.ts` (SHA-256 over the sorted baseline `(path, id, sha256)`
tuples, in source, not in the regenerable manifest) is re-checked by both
functions. `specVersion` now follows the highest revision actually present.
6 new runner tests.

### CR-M1. §5.1 unquoted-key grammar not enforced — code (TS + Rust + Go) + corpus

**Status: done (Core 1.0.5), decision: option 1a.** §5.1's pattern
`[a-zA-Z0-9_][a-zA-Z0-9_:\-]*` was enforced only by the TS top-level
scanner — the block-nested and flow contexts (all languages) and the
Rust/Go top-level scanners accepted `a.b`, `/x`, `($x)`, `${x}`, and a
leading-NBSP key. `isValidKey` (`scalars.{ts,rs}` / `scalars.go`) now
enforces the full grammar, shared across all three mapping contexts in all
three languages; a non-conforming unquoted key is an unrecognised
line/item, skipped in both modes. Corpus C-241–C-246 (`since: "1.0.5"`),
Core suite 178 → 184. Two cases changed expectation:
`references(-2).unsupported.references-in-keys-remain-literal` now yield
`m: {}` for the unquoted flow-key half; the frozen References 1.0 case was
amended once with its manifest hash and `BASELINE_DIGESTS['references-1.0']`
re-pinned (the CR-B1 baseline-amendment path). Closes the M2 table's dot
row, which the P1 #2/#3 step left open.

### CR-M2. First bare key in a block sequence item over-nests same-column content — code (TS + Rust + Go)

**Status: done (Core 1.0.6), commit `48e5f20`.** Per §7.1 rule 3 / §7.2,
content at the column of an item's first key is a sibling, not a nested
block. All three implementations chose the nested block by comparing the
next line against the item's *dash* column, not the key's column (the key
sits after `- `). Fixed at every bare-key site to compare against the
key's own column — `block.ts` computes it inline, `block.rs` gains
`dash_key_column`, `core.go`'s `bareNestedValue` takes the key column as
its threshold. The continuation-key position and plain nested mappings
were already correct and are unchanged. Corpus C-247–C-248
(`since: "1.0.6"`), Core suite 184 → 186; C-237–C-240 unaffected.

### CR-M3. Unicode-whitespace key handling diverged across languages — partly resolved by CR-M1

CR-M1 makes ` key` a rejected key in all three (TS already did). The
residual divergence — TS counts NBSP as *indentation* and reparents a
deeper NBSP-prefixed line, Rust/Go drop it — is
`docs/decisions/structural-indentation-unicode-whitespace.md`, a
deliberate pre-existing decision. Re-confirm the decision (likely a doc
clarification only); no further code expected.

### CR-M4. `crossCheckAgainstParse` skipped expected-error cases — corpus infra

**Status: done, commit `d270809`.** `run.ts` cross-checked only the
`expectation.kind === 'result'` branch. Now the error branch does too: for
a `spec:"core" api:"core"` case that expects a throw, `parse()` (References
2.0) must throw the same diagnostic `code` at the same `line` on the same
referenceless input — otherwise the case FAILs with a `parse() …` reason.
`crossCheckAgainstParse` split into `crossCheckResultAgainstParse` /
`crossCheckErrorAgainstParse`. All 44 Core error cases agree — no
divergence. P1 #6's "every passing `spec: "core"` case" claim now holds for
error cases too.

---

## Codex re-reviews 2 & 3 — 2026-09-07

Two further independent re-review rounds on the M1 error-provenance work.

### CR2-M1 / CR2-M2. M1 offset was container-relative, not physical; TS did not set `LimaError.column`

**Status: done (option A rewrite).** The first M1 pass anchored a token at
an offset *local to its flow element / scalar* and carried it on a
`StringSourceSpan`. Replaced wholesale with a raw+decoded token *zip*:
`scanReferenceTokens2` / `scan_tokens` scans the raw (undecoded) text for
each `${…}`/`$(…)`'s physical `(line, offset)` and the decoded value for
its splice index, then zips the two (invariant: same tokens, same order).
The result is a true physical codepoint `(line, column)`, identical across
TS/Rust/Go, surfaced as `LimaError.column` in all three. See item 5.

### CR2-M3. CR-M2 key column measured in bytes in Rust/Go

**Status: done.** See item 5b — `dash_key_column` / `core.go` now count
codepoints, matching TS.

### CR3-M1. Position must be the *original* source column (`\#`, leading tabs)

**Status: done (option A for both).** See item 5's "Original-source
position" note: comment-stripped-but-escape-preserving text threaded as
`source.raw`; per-line `tabAdjust` subtracted. Corpus R2-065 + the
comment-scan guard cases, suite 123 → 129.

**Follow-up fix (found in review-4 prep, commit after `a62dfb6`):** the
first cut of CR3-M1 threaded the *pristine* pre-`stripComment` value text
as `source.raw`. That reintroduced comment text into the raw token scan:
`x: ${a} # ${b}` made the raw scan see two `${…}` and the decoded value
one — the raw/decoded zip length check (CR3-MINOR-1) then threw / panicked
/ asserted in all three languages. Fixed by threading
`stripCommentKeepEscapes(raw)` (new shared helper; `stripComment` is now
`stripCommentKeepEscapes(v).replace(\#→#)`) via a `physicalRaw` wrapper —
a trailing comment removed, `\#` kept. Two corpus guard cases
(`comment-after-*-reference-*-not-scanned`).

**Review 4 (Codex, `d3e9f50..HEAD`): one MAJOR, now fixed.** Go's
sequence continuation-key path (`core.go`, `parseArrayItemContinuationKeys`)
built the raw anchor with `strings.TrimSpace` (Go's Unicode whitespace,
which eats U+0085) while the decoded side used the project's ECMAScript
`trimWhitespace` (which does not). For a continuation-key value with
U+0085 before the token, Go reported column 8 where TS/Rust reported 9 —
a §2.4 violation and a cross-language divergence, in the review diff.
Fixed: the raw anchor now slices from `cl.text[valueByte:]` with
`valueByte` computed via `leadingWsBytes` (the project boundary), matching
every other call site. Corpus R2-067
(`error-position-continuation-key-unicode-space`, asserts column 9 in all
three). Review 4 verdict: Ship after fixes → this was the only fix.

### CR3-MINOR-1 / CR3-MINOR-2. Zip invariant not hard-enforced outside TS; `parseCore` still built source metadata

**Status: done.** See item 5 — the length-mismatch check now throws /
panics / asserts in all three, and the positioned source anchor is built
only for the positioned builder.

---

## P2 — should fix

### 8. Int vs Float sentinel in the corpus — corpus infra + 3 runners — M7 — decision: option A

**Status: done (`c93fdab`, Core 1.0.7).** `{"$type":"int"/"float","value":N}`
in `expect.result`, restricted to `spec:core`/`api:core` (rejected in
partials and References cases). Honoured in all three comparison paths:
`normalize.ts` (`materialize` → a `{$numkind,value}` wrapper; `run.ts`
projects the actual via `parseCoreWithPositions` + `toPlainValue` only for
marker-bearing cases; kind-exact equality with a plain-number
backward-compat fallback), `rust/tests/corpus.rs` `value_matches` (explicit
`Int`/`Float` × marker arms before the `$type => None` skip — a mismatch is
`Some(false)`, not a skip), `go/corpus_test.go` `equalCorpus`. 3 new cases
`core.number-kind.{integers,floats,zero-normalization}` (`since: "1.0.7"`,
Core suite 186 → 189); the frozen `number-grammar-forms.json` is untouched.
Verified: a deliberately wrong kind FAILs in all three runners, never
skipped. Coverage C-091.

### 12. Harden the `$type` marker shape in the corpus validator — corpus infra

**Status: done (`c93fdab`, folded into #8).** `schema.ts`'s
`validateCorpusValue` now rejects a `$type` object with any key other than
`$type` and `value` — for every marker (`instant`, `host-number`,
`host-date`, `int`, `float`) — matching `case.schema.json`'s
`additionalProperties: false`. `schema.test.ts` covers all five.

### 9. Preserve `insertedAt` provenance across a second pure-reference copy — code

**Status: done (TS `afb2e60`, Rust + Go `0d9a06a`).** The pure-reference
copy sites spread `{ ...deepCopyPositioned(target), insertedAt: {…} }`,
unconditionally overwriting a root `insertedAt` that the deep copy had
preserved from an earlier resolution. When a pure reference copies a value
that was *itself* the root inserted by an earlier pure reference, that
earlier token's provenance was lost — so §5's "earliest source token whose
inserted or copied value participates in the invalid structure" picked the
wrong (later) token for a final depth/node-count error.

Repro (`middle: ${base}` … `outer: …n10: { v: ${middle} }`, `base` deep
enough that `outer` overflows `NESTING_DEPTH_LIMIT`): pre-fix, all three
implementations reported `RESOURCE_LIMIT` at line 20 (`${middle}`); §5
requires line 1 (`${base}`).

Fix (same model in all three): additive `priorInsertions` /
`prior_insertions` on the positioned node, carried by the deep copy,
consumed by `finalize*`/`collect*Participants`; a `copyWithInsertion` /
`copied_with_insertion` helper stashes the old root insertion into the
history before stamping the new token. Output is byte-identical for every
tree where no root is re-stamped (frozen 1.0 unchanged). Corpus
`error-position-provenance-second-copy` (R2-068) asserts the three
implementations agree — verified `RESOURCE_LIMIT` line 1 col 9 `${base}`
for the two-copy repro and line 1 col 4 `${b}` for a three-edge chain in
TS/Rust/Go. References 2.0 suite 130 → 131.

The frozen References 1.0 resolver (`references.ts:168/172`, and the Rust
`resolve_tree` equivalent) has the same overwrite pattern — deliberately
untouched (never public; only the 101-case frozen corpus is normative for
it), the new struct field is threaded through it mechanically and stays
empty there.

### 10. Extract the shared helpers out of `references.ts` — code (TS, refactor)

**Status: done (`037219d`).** `deepCopyPositioned`, `partialToPositioned`,
`finalizePositioned` (+ `FinalizedValue`), `earliestParticipant`,
`collectAllParticipants`, and `emptyMapping` moved verbatim to
`js/src/positioned-tree.ts`; `references.ts` (frozen 1.0) and
`references2.ts` both import from it. `references2.ts` no longer imports
anything from `references.ts`. No behaviour change, no test changes.

### 11. Raw line terminator in a quoted key; single-quote comment state — code (TS) + corpus

**Status: done (`542002a`, Core 1.0.8).** Decision was option A —
align TS to the grammar. A quoted key spanning a raw newline
(`"line1<LF>line2": value`) was stitched into one key by TS but rejected
(unrecognised line, skip in both modes) by Rust and Go. Core §15.6
already excludes U+000A from both single- and double-quoted-key
characters, so TS was the outlier.

Fix: `matchAt` in `js/src/scanner.ts` (the one choke point for both
top-level key paths — `scanKeys` and `KeyCursor`) now rejects a raw
`\n`/`\r`/U+2028/U+2029 inside a single- or double-quoted key; the
module's canonical-regex comment is updated. The `\n` *escape*
(backslash-`n`) still yields a key containing U+000A in all three (§5.2
escape symmetry). Strict stays skip-in-both-modes (the `unclosed key` /
`garbage line` norm — not a §5.2 "space before colon" throw). One
existing JS test that encoded the pre-fix stitching was corrected (with a
written reason), not weakened. §5.2 gained a clarifying paragraph
(non-normative, restates §15.6). 5 corpus cases
(`core.keys.quoted.raw-newline-*`, `…escape-newline…`,
`…does-not-swallow-next-key`), coverage C-092. Verified `{}` / `{"d":2}` /
key-with-newline identical across TS/Rust/Go in both modes.

**M3 part C — verified, no code needed.** `stripComment` /
`stripCommentKeepEscapes` handle single-quote / `\'` / `\\` / `#` /
backslash identically across TS/Rust/Go in both modes (~15 combinations
tested, zero divergence). Two corpus cases added as a regression guard
(`single-quoted-value-escaped-quote-hash-not-comment`,
`single-quoted-value-then-real-comment`), coverage C-093.

---

## P3 — polish / follow-up

- **12. Done (`c93fdab`)** — see P2 #12 above; folded into the #8 batch.
- **13.** Repair `js/bench/index.ts` (~L72) and add a stable References 2.0
  benchmark. (also in `follow-ups.md`)
- **14.** Document the `resolveNode` cache invariant (key without the
  active dependency stack) as a comment / property test — 200k fuzzed
  documents found no divergence, but it is not obviously safe. (also in
  `follow-ups.md`)
- **15.** Verify the Go CI job added in `da292ff` on its first run (added
  without a local Go toolchain).
- **16. Done:** docs count 117→119 / "Draft" (commit `cbc2701`).

---

## Decisions to close formally

Update the `Status:` header in `docs/decisions/`:

| Document | Resolution |
|---|---|
| `nested-block-scalars-not-supported.md` | decided — option A (implement); see P0 #1 |
| `comment-lines-and-bare-key-block-detection.md` | decided — option C (fix to spec); see P1 #4 |
| `corpus-int-float-type-assertion.md` | decided — option A (`$type` sentinel); see P2 #8 |
| `fence-recognition-convention.md` | deferred — outside the freeze scope; revisit separately |
| `structural-indentation-unicode-whitespace.md` | already resolved (2026-08-07) |

---

## After the fixes: re-run the gates

Fresh build · `src`/`dist` byte comparison · `typecheck` · `bun test` (js +
corpus/runner) · corpus runner, all three suites · `cargo test` ·
`go test ./...` · **one targeted regression test per finding**.

---

## Critical path to a Core 1.0 freeze

P0 #1 → P1 #2, #3, #4 (all three languages + corpus) → gates. #5–#8 can run
in parallel (TS / corpus only, no Rust/Go blocker). #7 is doable now.

**No freeze blockers remain, and all of P0/P1/P2 is done.** Remaining:
P3 #13 (bench), #14 (`resolveNode` cache invariant), #15 (Go CI first
run — a push-time check); the decision-doc `Status:` headers; a one-line
spec note on `LimaError.column`; then `git-retime` + push. Core is at
errata 1.0.8, References 2.0 corpus at 131 cases.
