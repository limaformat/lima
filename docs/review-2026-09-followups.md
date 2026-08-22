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

### 5. References 2.0 error provenance: source-based — code (TS: `reference-tokens2.ts`, `references2.ts`) — M1

- **1A:** token offsets are local scalar offsets, not physical source
  offsets. `items: [prefix ${missing1}, ${missing2}]` in strict mode
  reports the *later* token. Every active token must carry its real
  physical `(line, offset)` from parse time.
- **1B:** different diagnostic kinds are not given uniform provenance, so a
  later invalid-shape error can beat a physically earlier unresolved
  reference. Every throw site and the final scan must carry `(line,
  offset)` and sort globally.

Ordering rule: §5 (earliest source position wins — line, then character
offset).

### 6. Point the Core corpus gate at the public API — corpus infra (`corpus/runner/`) — M6

**Status: done.** `loader.ts` defaulted every `spec: "core"` case with no
explicit `api` to `references` — dispatching it to `parseReferencesV1`,
the internal References 1.0 resolver, which never shipped in the public
API. 173 of 174 Core cases had no explicit `api` and so ran through it.
Fixed: the default is now spec-aware (`spec === 'core'` → `core`); the
schema rejects an explicit `api: "parse"`/`"references"` on a `spec:
"core"` case as nonsensical. Every passing `spec: "core"` case is now
*also* cross-checked against `parse` (References 2.0) — Core is
reference-unaware by construction, so the two builders (`nativeBuilder`,
`positionedBuilder`) must agree exactly on referenceless input; this is
the part of the fix that actually exercises the public References entry
point on Core input, not only `parseCore`. Full corpus re-run clean: all
174 cases pass through `parseCore`, and all 174 cross-checks against
`parse` agree — no divergence between the two builders. Rust and Go
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

## P2 — should fix

### 8. Int vs Float sentinel in the corpus — corpus infra + 3 runners — M7 — decision: option A

`{"$type":"int"/"float","value":N}` inside `expect.result`, honoured by
`normalize.ts` / `corpus.rs` / `corpus_test.go`. Only ~5–10 new targeted
cases for the §6.4.1 / §6.4.2 boundaries (starting with `1e3` → Float); do
not retag existing cases. See
`decisions/corpus-int-float-type-assertion.md` (option A).

### 9. Verify M1C, and preserve `insertedAt` if it is real — code (TS)

`references2.ts:147/158` overwrites `insertedAt` on the copy root
unconditionally, discarding the provenance of an inner reference result
that resolved earlier. **Build a repro first** — a chain within the
three-edge limit that triggers a final node/depth limit — and only fix if
the attribution is observably wrong.

### 10. Extract the shared helpers out of `references.ts` — code (TS, refactor)

`deepCopyPositioned`, `finalizePositioned`, `earliestParticipant`,
`collectAllParticipants`, `partialToPositioned` into a neutral module (e.g.
`positioned-tree.ts`), so the live References 2.0 resolver does not import
from the frozen 1.0 module. No behaviour change.

### 11. LF in quoted keys; single-quote comment state — spec answer + code

`"line1\nline2": value` is accepted at top level. Decide whether the
quoted-key grammar (§5.2) permits LF (likely not), then fix. Verify the
single-quote / `#` / backslash interaction in the comment stripper (M3
part C).

---

## P3 — polish / follow-up

- **12.** `schema.ts:87–104`: `$type` markers accept extra properties; the
  JSON schema declares `additionalProperties: false`. Align them. (M-MINOR1)
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
