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

Found while fixing, not part of this decision: a sequence at column 0 under a bare key (`tags:` / `- a`) is no block
under §7.1 (only a deeper line is) — strict mode reports it as an unrecognised line, but non-strict mode reads
`["a"]` in TypeScript and Rust and `null` in Go, which the corpus does not cover.
