# Decision: lines that belong to no structure

**Status: accepted (2026-10-28) — Lima Core 1.1.** Both parts below, the specification as proposed (one document,
`docs/lima-core-1.0-spec.md`, now Core 1.1 under its old name, so that every published link still reaches it),
packages 0.6.0. Implemented by Claude Code; Codex CLI reviews.

## The problem

An indented line that follows a top-level key with an inline value is dropped without a word, in strict mode too:

```lima
title: A
	author: B          # a tab before it (§3 makes it two spaces)
```

```lima
description: >
  A folded description
  over two lines.
```

Both parse, strict or not, to `{ title: 'A' }` and `{ description: '>' }` with no error and no warning
(`@limaformat/lima` 0.5.1, checked with every input below; for `>` and the chomping indicators the corpus pins the same
for Rust and Go). The first is a typo or a stray tab; the second is
the first thing a YAML user writes. In both, data is lost without notice, which is what strict mode is for.

Found in hadley, which reads every Lima file strictly since 2026-10-28: a page's `author` vanished behind a tab, and a
YAML-style `description: >` became `>`.

## What the specification says

The same construct is an error one level down, and skipped only at the top level:

- §7.1 rule 3: "A line indented deeper than the base indentation belongs to the immediately preceding key's value as a
  nested block." Rule 5: "A line whose indentation does not correspond to any currently open block level is
  inconsistently indented — silently skipped in non-strict; throw in strict." §10.1 lists it ("Inconsistent
  indentation | skip | throw").
- §4, last paragraph: "Lines that do not match any key pattern and are not part of a block value are silently skipped in
  both strict and non-strict mode."

The corpus applies §7.1 below the top level and §4 at it:

| Case (all 1.0.0 baseline) | Input | Strict |
|---|---|---|
| `core.indentation.inconsistent.strict` | `a:` / `  x: 1` / `   y: 2` | `INVALID_INDENTATION`, line 3 |
| `core.block-scalar.freetext-without-pipe.strict` | `value:` / `  freetext` | `INVALID_INDENTATION`, line 2 |
| `core.block-scalar.folded-marker-unsupported.strict` | `desc: >` / `  Hello` / `  World` | `{ desc: '>' }` |
| `core.block-scalar.chomping-indicator-unsupported.strict` | `a: \|-` / `  Hello` / … | `{ a: '\|-', b: '\|+' }` |

`y: 2` after `x: 1` and `Hello` after `desc: >` are the same thing: a line indented after a key whose value is inline,
which opens no block. The level decides the outcome. This is a specification ambiguity (§4 against §7.1), which the 1.0
corpus resolved in favour of §4 at the top level.

## Proposal

Strict mode treats such a line at the top level as at any other level: it is inconsistently indented (§7.1 rule 5),
`INVALID_INDENTATION` with its line. Non-strict mode is unchanged: the line is skipped, with no warning. No new error
code, no change to any non-strict result or warning.

Specification text (Core 1.1):

- §4, last paragraph: "An unindented line that does not match any key pattern is silently skipped in both strict and
  non-strict mode; it is not in the strict error list (see §10). An indented line that is not part of a block value is
  inconsistently indented (§7.1 rule 5)."
- §7.1 rule 5, added: "This holds at the top level as at any other: a key with an inline value opens no block, so a
  line indented after it corresponds to no open block level."
- §10.1, the row "Inconsistent indentation": "(§7.1 rule 5, at any level)".
- Appendix A, the rows for `>` and the chomping indicators: "The lines that follow such a marker are inconsistently
  indented (§7.1 rule 5)."
- Implementation note (non-normative, §10.2 leaves the message to the implementation): when the inline value before
  the line is `>`, `>-`, `>+`, `|-` or `|+`, the message says so, for example `">" is YAML's folded scalar; Lima writes
  "|" and continues a line with "^^"`.

## Corpus

- Superseded for Core 1.1, byte-frozen in the 1.0 baseline as they are:
  `core.block-scalar.folded-marker-unsupported.strict`, `core.block-scalar.chomping-indicator-unsupported.strict`.
- Their replacements (`since: "1.1.0"`, same inputs, strict): `INVALID_INDENTATION` at line 2.
- New (`since: "1.1.0"`), each strict with its non-strict twin (the line skipped, no warning):
  - `title: A` / `  author: B` — an indented key after a scalar;
  - `title: A` / `⇥author: B` — the same with a tab (§3);
  - `title: "A"` / `  more` — freetext after a quoted value;
  - `tags: [a, b]` / `  c` — after a flow sequence.
- Unchanged: `core.strict-list.is-closed` and `core.document.unrecognized-line.skipped-both-modes`. A line at column 0
  that matches no key pattern stays skipped (see the open question below).

## Versioning

This is the first change since the freeze that alters a baseline expectation, so it cannot be an erratum (the README:
errata never alter the 1.0.0 baseline). Proposed:

1. The specification becomes Lima Core 1.1 (version 1.1.0) with a short "Changes from 1.0" section; the 1.0 text stays
   reachable at its tags. The alternative, a second full document beside the frozen one, as References 1.0 and 2.0 are,
   copies about a thousand lines for one rule.
2. A manifest `corpus/manifests/core-1.1.json`: the 1.0 cases without the two superseded ones, the replacements and the
   new cases. `core-1.0.json` stays byte-frozen and keeps running against internal code as a regression guard, as the
   References 1.0 corpus does, with the two superseded cases skipped by id.
3. The packages move to 0.6.0: strict mode rejects documents it accepted (semver before 1.0).

## Part 2: an unindented line that matches no key pattern

A line at column 0 that matches no key pattern, such as `author Odile` with its colon missing, a YAML document marker
`---` or `...`, or a quoted key whose line ends before its closing quote, is skipped in both modes in Core 1.0 (§4,
§5.2; `core.strict-list.is-closed`, `core.document.unrecognized-line.skipped-both-modes`). It loses data the same way.
Core 1.0 kept it on purpose: the strict list is closed, and strict mode does not validate everything. Core 1.1 adds
one entry to the closed list, so that strict mode has one rule a reader can state: every content line belongs to the
structure, or strict mode throws.

- §4, §5.2 and §10.1 (a new row "Unrecognised line"), Appendix A (multi-document markers).
- A new error code, `UNRECOGNIZED_LINE`, with its line.
- Superseded for Core 1.1: the strict cases that skip such a line; their replacements throw `UNRECOGNIZED_LINE`.
- Non-strict mode is unchanged, again with no warning.
- In a block mapping, a line whose key the key grammar rejects is unrecognised too (added after review, below).

## Review (Codex CLI, 2026-10-28)

The first review of the implementation found five issues; the maintainer accepted all fixes:

1. Strict mode still dropped an indented line after a block had ended: below a block mapping's base indentation
   (`a:` / `  b: c` / ` x: y`), and after a `|` scalar that a comment at column 0 ended. The check now knows a
   mapping's base indentation (its first content line, §7.1 rule 1) and where a scalar ends (§6.1.5).
2. The rule held at the top level only: in a block mapping, a line whose key the key grammar rejects (`a.b: value`,
   `bad key: value`) was still skipped in strict mode. Part 2 now covers it (§5.1, §10.1), with `UNRECOGNIZED_LINE`;
   `core.keys.nested.dot-invalid` and `core.keys.nested.unquoted-space-invalid` are superseded too (eight in all).
3. A last `key:` without a line terminator was `null` in Rust and Go and no key in TypeScript, and the specification
   said neither: §4, §5.1 and Appendix D now say that the end of the input ends the last line. TypeScript's non-strict
   result changes with it.
4. The tree-sitter fix had broken a valid input (`a:` / blank / `  # comment` / `  x: 1`): the scanner now takes the
   indentation of the next content line past comment and blank lines (§7.1 rule 7), and the generated tree-sitter
   corpus pins both shapes.
5. The packages were still at 0.5.1: they move to 0.6.0 with the release.

## Compact sequences

Found while fixing: a sequence at column 0 under a bare key (`tags:` / `- a`), which YAML front matter often writes,
was no block under §7.1 (only a deeper line is). Non-strict mode read `["a"]` in TypeScript and Rust at the top level,
by accident, and lost the sequence and the keys after it one level down; Go read `null`. Strict mode would have
reported it as an unrecognised line.

Decided (the maintainer, 2026-10-28): Core 1.1 allows it, at every level (§7.2, "Compact sequences"). A bare key's
sequence may start at the key's own column and ends at the first content line there that is not an item; an item is
`-` alone or `-` followed by whitespace. Only a bare key opens one. Before the decision, the sites that use Lima
were checked: none writes such a sequence, so no page changes.

## Review 2 (Codex CLI, 2026-10-28)

The second review, and a three-way differential test of random documents that followed it, found where Core 1.0 had
left the implementations to differ. The maintainer accepted all proposals:

1. `a: |` with no content lines was `"|"` in TypeScript and Rust and `''` in Go; it is `''` (§6.1.5).
2. A block with mapping entries and sequence items lost everything in TypeScript and Rust in non-strict mode; the first
   kind wins and a line of the other kind is skipped, as Go did (§7.1).
3. `- [a, b]` was a string in TypeScript and Rust and a sequence in Go; an item's value is an inline value (§15.3), so
   it is a nested sequence, `null` in non-strict mode and an error in strict mode (§7.2). Any other item value that
   begins with `[` is read as an inline value is.
4. The References 2.0 specification names Core 1.1 as its base.
5. Code comments and package texts name Core 1.1.
6. The tree-sitter grammar learns compact sequences after the release.

Also found: whitespace-only lines could make the Go package panic, and Go lost an object item's keys after a blank or
comment line, both already in 0.5.1; both are fixed. One divergence stays open, outside this decision: a line
indented by spaces and then Unicode whitespace such as U+00A0, which §3 leaves undefined.

## Review 3 (Codex CLI, 2026-10-28) and the differential test

The third review found no blocker. Its findings, and what was done:

1. A block whose first line is neither an entry nor an item (`a:` / `  freetext` / `  - item`) had no single non-strict
   outcome. §7.1 now says that the first entry or item decides, and that a line non-strict mode skips is as if it were
   absent: it decides nothing and ends neither the block nor the object item before it.
2. The packages are still at 0.5.1: the version moves to 0.6.0 in the release commit, as planned.
3. References 2.0 and the README said that Core 1.1 changes strict mode only; corrected.
4. Appendix D allowed only a space after a sequence dash; it now has `item-separator`, whitespace as §7.2 says.
5. A wording slip in §7.2; corrected.

The maintainer then made the three-way differential test a gate (`corpus/runner/src/differential.ts`, a CI job). Its
structured documents found, all already in 0.5.1: in Go, a negative number as an item (`- -7`) read as a nested
sequence, an empty `|` as a later key of an object item read `"|"`, a first line that is neither entry nor item made
the block a mapping, and a skipped line ended an object item; in TypeScript and Rust, an unclosed `{` as an item was
accepted in strict mode. And one the comparison cannot find, since all three agreed: `| # c` below the top level was a
block scalar, which §6.1.5 and §15.7 rule out (the marker stands alone); the tree-sitter scanner made it an error
node, and dropped the `|` of `a: | x`. All are fixed, with corpus cases (and two pinned tree-sitter trees); the gate
runs four seeds of 25,000 documents with no disagreement, and sixteen more seeds (about 770,000 parses per
implementation) found none either.

## Review 4 (Codex CLI, 2026-10-28)

No blocker. The findings, and what was done:

1. The new §7.1 sentence said that a line non-strict mode skips is as if it were absent, which contradicted the dedent
   rule, the block-scalar extent and the end of a compact sequence; all three implementations already follow those
   rules. The sentence now says what they do: a skipped line decides nothing about what a block holds, but its
   indentation counts as any line's — less indented than a block it ends the block, as a bare key's first line it opens
   the key's block only when deeper, and it ends a `|` scalar or a compact sequence as §6.1.5 and §7.2 say; otherwise
   it ends neither the block nor the object item before it. No result changes.
2. The differential test compared values in a form that could not tell an integer from a float, nor a date from a
   mapping that looks like one. Every type is now tagged; Rust and Go must agree on integer or float, TypeScript (one
   number type) by value.
3. Its exclusion of Unicode-whitespace indentation also left out the content of `|` scalars, where such whitespace is
   defined; it no longer does.
4. Its generator reached none of the resource limits; it now writes documents just below, at and above each of them.
   They found at once that Go read a duplicate key among more than 128 top-level entries before the key-count limit;
   it now counts first, as TypeScript and Rust do.
5. Shrinking could turn one disagreement into another; it now keeps the mode and the odd one out.
6. `a: | x` had no tree-sitter tree pinned; it has one now. Pinning the skipped-line cases also showed that the
   grammar made a line skipped between an object item's keys an error node; it is an unrecognised line there now.

## Indentation by Unicode whitespace

The differential test had left out one divergence as open: a line indented by spaces and then other whitespace, such
as U+00A0, which §3 did not define. Strict mode already rejected every such line in all three implementations; in
non-strict mode TypeScript counted the whitespace as indentation, Rust in one case read such a line at column 0 as part
of the block before it, and Go did neither.

Decided (the maintainer, 2026-10-28), in Core 1.1: indentation is spaces only (§7.1). Other whitespace before content is
no indentation but starts the content, so the line is unrecognised — skipped in non-strict mode, an error in strict
mode — and its indentation is its spaces. A blank or comment line stays one, and in a `|` scalar such whitespace is
content, where only a line of spaces is empty (§6.1.5). §1 now defines whitespace once: the set all three already used,
ECMAScript's WhiteSpace and LineTerminator. Such whitespace in an indentation is nearly always pasted from a web page or
a word processor; counted as a space, it would shift the structure without notice.

Found on the way, by the generator's new lines of U+00A0: in TypeScript and Rust, a `|` scalar that such a line ended
let the block parser take the lines after it as the scalar's, so strict mode dropped a deeper line without an error.
The test now runs without an exclusion.

## Review 5 (Codex CLI, 2026-10-28)

No blocker. The findings, and what was done:

1. An object item's later keys must stand at its first key's column (§7.2), but all three implementations took any
   line deeper than the dash as a key of the item. The maintainer decided to follow §7.2: a deeper line is
   inconsistently indented and skipped in non-strict mode, the item going on; a less indented one ends the item
   (§7.1 rule 4); strict mode throws for either. §7.2 now says so. No site has such a line; one Core 1.1 case
   written after review 4 had pinned the old reading and now pins the new one.
2. The differential test read any object with a key such as `$int` as a number tag, so a mapping with a key of that
   name could hide a difference. Tags are now recognised by their exact shape, and the generator writes such keys.
3. Appendix D's `item-separator` admitted the newline that ends the line; it no longer does. (Review 6: it first
   excluded every line terminator of §1, U+2028 and U+2029 too, which §7.2 and all three implementations accept
   after a dash; it now excludes U+000A only, the one character that ends a line after §3.)
4. Stale counts in the tree-sitter documentation; they are gone rather than updated, since the scripts know them.

Also after this review: strict mode had become 16–19 % slower than in 0.5.1 in TypeScript and Rust, and Go 6 % in both
modes, measured on the hadley sites' front matter. The checks now work on positions and reuse what the parser already
found: TypeScript +4 % (Core) and +6 % (References), Rust +10 %, Go ±0, non-strict within ±3 %. The cross-language
benchmarks gain strict scenarios, so that the next such regression shows.

## Review 6 (Codex CLI, 2026-10-28)

No blocker. A `|` scalar as an object item's first key measured its body from the dash plus two columns in all three
implementations, so after wider whitespace (`-   a: |`) it took the item's next key as text — already so in 0.5.1, and
now measured from the key's column. Appendix D's `item-separator` is corrected once more (Review 5, item 3), and the
Go benchmark inventory lists the strict scenarios. The performance commit was checked to change no outcome: 400,000
outcomes each in TypeScript and Go, messages and hints included, matched those before it.
