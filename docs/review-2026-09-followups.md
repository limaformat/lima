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

- `v: "abc\"` — the only closing quote is escaped, so the string is
  unterminated → §10.1 "Unterminated quoted string" must throw in strict.
  It does not (the check is only "first char == last char").
- Flow: `v: ["abc]` (unterminated) and `v: ["x" trailing]` (content after
  the closing quote) pass in strict; §10.1 requires a throw.
- *Not* a bug: `'abc\'` is a valid literal single-quoted string `abc\`
  (single quotes do no escape processing).
- Still to verify: the single-quote / `#` / backslash interaction in the
  comment stripper (M3 part C) — plausible, not reproduced.

### 4. Comment line before a nested block — code (TS + Rust + Go) + corpus — M4 — decision: option C

`key:\n# comment\n  nested: value` currently yields `{key: null}` — the
nested content is silently lost. Core §4 rule 7 / §6.1.3: comment lines are
skipped, including in the pre-check that decides *whether* a bare key has a
nested block. Fix in all three implementations, add a corpus fixture. See
`decisions/comment-lines-and-bare-key-block-detection.md` (option C — fix
to match the spec rather than amend the spec).

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

`loader.ts` dispatches Core cases (specVersion 1.0, no `api` field) to
`parseReferencesV1` — the References 1.0 resolver, which never shipped in
the public API. Only 1 of 149 Core cases sets `api: "core"`.

**Fix:** run Core cases against `parseCore` **and** `parse` (2.0); make
`api` explicit or derive it from `spec`; freeze/version the runner dispatch
semantics alongside the corpus (the manifest hashes protect only the
fixture files, not which entry point a frozen case exercises).

### 7. Clarify the References 1.0 status — docs

`README.md` presents "101 frozen References 1.0 cases … passed by …" and
"250 cases, content-hash protected" as a live property, though the language
feature never shipped in the public API. Reframe as frozen history.
`AGENTS.md` lists only Core 1.0 + References 1.0 as normative — add
References 2.0 and state the References 1.0 status precisely.

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
