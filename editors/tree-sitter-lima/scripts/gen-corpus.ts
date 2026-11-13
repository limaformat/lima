import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerator } from "../../../corpus/runner/src/generators/index";

const ROOT = process.cwd();
const SOURCE_ROOT = join(ROOT, "..", "..", "corpus");
const OUTPUT = join(ROOT, "test", "corpus", "generated.txt");

// These trees are deliberately maintained expectations, not snapshots made by
// parsing with the grammar under test. The full fixture error contract is
// checked separately by check-fixtures.ts.
const EXPECTED_TREES: Record<string, string> = {
  "core.api.parse-returns-mapping": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    value: (number)))`,
  "core.block-mapping.nested-arbitrary-depth": `(document
  (block_mapping_entry
    key: (key)
    (block_mapping
      (block_mapping_entry
        key: (key)
        (block_mapping
          (block_mapping_entry
            key: (key)
            value: (plain_scalar))
          (block_mapping_entry
            key: (key)
            value: (plain_scalar)))))))`,
  "core.block-sequence.object-item-sibling-indentation": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        value: (plain_scalar)
        (block_mapping_entry
          key: (key)
          value: (plain_scalar)))
      (block_sequence_item
        key: (key)
        value: (plain_scalar)
        (block_mapping_entry
          key: (key)
          value: (plain_scalar))))))`,
  "core.block-scalar.continuation.basic": `(document
  (block_mapping_entry
    key: (key)
    (block_scalar
      body: (block_scalar_body
        (continuation)))))`,
  // `| # c` is no marker (the `|` stands alone, Core §6.1.5): a plain scalar and a comment, at every level.
  "core.block-scalar.marker-with-comment-nested": `(document
  (block_mapping_entry
    key: (key)
    (block_mapping
      (block_mapping_entry
        key: (key)
        value: (plain_scalar)
        (comment)))))`,
  "core.block-scalar.marker-with-comment-object-item": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        value: (plain_scalar)
        (comment)
        (block_mapping_entry
          key: (key)
          value: (plain_scalar)
          (comment))))))`,
  // `| x` keeps its `|`: the scanner looks past it for a marker without moving the value's start.
  "core.block-scalar.marker-with-trailing-text": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  // A line non-strict mode skips inside an object item (`---`) is no error node and ends no item (Core 1.1 §7.1).
  "core.block-sequence.object-item-past-skipped-line": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        value: (number)
        (block_mapping_entry
          key: (key)
          value: (number))))))`,
  "core.block-sequence.compact.top-level": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        value: (plain_scalar))
      (block_sequence_item
        value: (plain_scalar))))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  "editor.block-sequence.bare-item-key-past-skipped-line": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        (block_mapping
          (block_mapping_entry
            key: (key)
            value: (number)))))))`,
  "core.block-scalar.dedent-comment-ends-scalar": `(document
  (block_mapping_entry
    key: (key)
    (block_scalar
      body: (block_scalar_body)))
  (comment)
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  // Core §7.1 rule 7: an indented comment before a bare key's first child does not decide the block's indentation
  "core.indentation.blank-comment-lines-no-base": `(document
  (block_mapping_entry
    key: (key)
    (comment)
    (block_mapping
      (block_mapping_entry
        key: (key)
        value: (number))
      (block_mapping_entry
        key: (key)
        value: (number)))))`,
  // ... nor opens one after an inline value, and a blank line after a top-level comment is no ERROR
  "core.document.blank-and-comment-lines.strict": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (comment)
  (comment)
  (block_mapping_entry
    key: (key)
    value: (number)))`,
  "core.flow-mapping.empty-and-flat": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_mapping))
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key)
      value: (number)
      key: (flow_key)
      value: (number))))`,
  "core.flow-nesting.sequence-of-mappings-allowed": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_sequence
      (flow_mapping
        key: (flow_key)
        value: (flow_plain_scalar)
        key: (flow_key)
        value: (flow_plain_scalar))
      (flow_mapping
        key: (flow_key)
        value: (flow_plain_scalar)
        key: (flow_key)
        value: (flow_plain_scalar)))))`,
  "core.keys.quoted.double-quoted-decodes-escapes": `(document
  (block_mapping_entry
    key: (double_quoted_key
      (escape_sequence)
      (escape_sequence))
    value: (plain_scalar)))`,
  "core.null.all-forms": `(document
  (block_mapping_entry
    key: (key))
  (block_mapping_entry
    key: (key)
    value: (null))
  (block_mapping_entry
    key: (key)
    value: (null)))`,
  "core.keys.unicode-languages-and-punctuation": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  "core.keys.invalid-initials-non-strict": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  // Core 1.3 §4, §8: a `#` begins a comment only at the start of a value or after whitespace (§1), in flow values
  // too; any other `#` is text, `\#` included.
  "core.comments.url-fragment-and-color": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    (comment)))`,
  "core.comments.escaped-hash": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  "core.comments.hash-after-nbsp": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)
    (comment)))`,
  "core.comments.hash-after-nel": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  "core.comments.hash-after-closing-quote": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  "core.comments.hash-in-quotes": `(document
  (block_mapping_entry
    key: (key)
    value: (single_quoted_string))
  (block_mapping_entry
    key: (single_quoted_key)
    value: (plain_scalar)))`,
  "editor.comments.hash-after-space-in-quotes": `(document
  (block_mapping_entry
    key: (key)
    value: (single_quoted_string))
  (block_mapping_entry
    key: (key)
    value: (double_quoted_string
      (escape_sequence))))`,
  "core.comments.flow-sequence-hash-after-comma": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_sequence
      (flow_plain_scalar)
      (flow_plain_scalar)))
  (block_mapping_entry
    key: (key)
    value: (flow_sequence
      (flow_plain_scalar))))`,
  // `[a, #x]` is unclosed once its comment is removed: a plain scalar and a comment.
  "core.comments.flow-sequence-hash-after-space": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)
    (comment)))`,
  "core.comments.flow-mapping-hash-after-text": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key)
      value: (flow_plain_scalar))))`,
  "references-2.core-1-3.flow-hash-and-token": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    value: (flow_sequence
      (flow_plain_scalar)
      (flow_plain_scalar
        (document_reference)))))`,
  "references-2.core-1-3.token-after-hash": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (document_reference))))`,
  "references-2.core-1-3.token-before-hash": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (document_reference))))`,
  "references-2.core-1-3.token-before-comment": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (document_reference))
    (comment)))`,
  "references-2.core-1-3.token-in-comment": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    (comment)))`,
  // Core 1.3 §4, §7.1: `key: # note` is a bare key with a comment; its block may follow.
  "core.bare-key.comment-only-value-opens-block": `(document
  (block_mapping_entry
    key: (key)
    (comment)
    (block_mapping
      (block_mapping_entry
        key: (key)
        value: (number)))))`,
  "core.bare-key.comment-only-value-without-block": `(document
  (block_mapping_entry
    key: (key)
    (comment))
  (block_mapping_entry
    key: (key)
    value: (number)))`,
  "core.bare-key.comment-only-value-compact-sequence": `(document
  (block_mapping_entry
    key: (key)
    (comment)
    (block_sequence
      (block_sequence_item
        value: (plain_scalar)))))`,
  "core.bare-key.comment-only-value-nested": `(document
  (block_mapping_entry
    key: (key)
    (block_mapping
      (block_mapping_entry
        key: (key)
        (comment)
        (block_mapping
          (block_mapping_entry
            key: (key)
            value: (number))))
      (block_mapping_entry
        key: (key)
        value: (number)))))`,
  "core.bare-key.comment-only-value-first-key-of-item": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        (comment)
        (block_mapping
          (block_mapping_entry
            key: (key)
            value: (number)))))))`,
  "core.bare-key.comment-only-value-in-object-item": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        value: (plain_scalar)
        (block_mapping_entry
          key: (key)
          (comment)
          (block_mapping
            (block_mapping_entry
              key: (key)
              value: (number))))))))`,
  // Core 1.3 §5.1: a tab after the colon separates key and value as a space does, in every key context; U+00A0 does
  // not, and the line is unrecognised.
  "core.separator.tab-top-level": `(document
  (block_mapping_entry
    key: (key)
    value: (number)))`,
  "core.separator.tab-key-with-colon": `(document
  (block_mapping_entry
    key: (key)
    value: (number)))`,
  "core.separator.tab-quoted-key": `(document
  (block_mapping_entry
    key: (single_quoted_key)
    value: (number)))`,
  "core.separator.tab-block-contexts": `(document
  (block_mapping_entry
    key: (key)
    (block_mapping
      (block_mapping_entry
        key: (key)
        value: (number))))
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        key: (key)
        value: (number)
        (block_mapping_entry
          key: (key)
          value: (number))))))`,
  "core.separator.tab-flow-mapping": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key)
      value: (number))))`,
  "core.separator.tab-at-end-of-input": `(document
  (block_mapping_entry
    key: (key)))`,
  "core.separator.nbsp-is-no-separator": `(document)`,
  // A colon with nothing before it is no key (§5.1): `- :\tx` is an item whose value is `:\tx`.
  "editor.separator.colon-without-key": `(document
  (block_mapping_entry
    key: (key)
    (block_sequence
      (block_sequence_item
        value: (plain_scalar))
      (block_sequence_item
        value: (plain_scalar)))))`,
  // Core 1.3 §7.5: the separator is found before the item is trimmed, so `{k: }` has the key `k` and no value.
  "core.flow-mapping.flow-mapping-empty-value": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key))))`,
  "core.flow-mapping.flow-mapping-empty-value-tab": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key))))`,
  "core.flow-mapping.flow-mapping-empty-value-later-item": `(document
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key)
      value: (number)
      key: (flow_key))))`,
  // A single-quoted key is literal (§5.2): `'a\'` is the key, and `b':` after it leaves the line unrecognised.
  "core.errata.single-quoted-key-no-escape": `(document)`,
  "references-2.interpolation.block-scalar.basic": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    (block_scalar
      body: (block_scalar_body
        (document_reference)))))`,
  "references-2.activity.quoted-token.inactive": `(document
  (block_mapping_entry
    key: (key)
    value: (number))
  (block_mapping_entry
    key: (key)
    value: (double_quoted_string)))`,
  "references-2.activity.flow-document-brace-boundaries": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (flow_sequence
      (flow_plain_scalar
        (document_reference)
        (document_reference))
      (flow_mapping
        key: (flow_key)
        value: (number))
      (flow_plain_scalar
        (document_reference))))
  (block_mapping_entry
    key: (key)
    value: (flow_mapping
      key: (flow_key)
      value: (flow_plain_scalar
        (document_reference)
        (document_reference))
      key: (flow_key)
      value: (flow_plain_scalar
        (document_reference)))))`,
  "references-2.partials.slash-name.mapping-path": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (partial_reference))))`,
  "references-2.keys.unicode": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (document_reference)))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (document_reference)))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (partial_reference)))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar
      (partial_reference))))`,
  "references-2.scanner.incomplete-token.literal-strict": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
  "references-2.unsupported.references-in-keys-remain-literal": `(document
  (block_mapping_entry
    key: (key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (double_quoted_key)
    value: (plain_scalar))
  (block_mapping_entry
    key: (key)
    value: (plain_scalar)))`,
};

interface Fixture {
  id: string;
  input?: string;
  generator?: { name: string; parameters: Record<string, unknown> };
}

const fixtures = new Map<string, Fixture>();
for (const subdir of ["core", "core-1.1", "core-1.2", "core-1.3", "references-2.0", "references-2.1"]) {
  const dir = join(SOURCE_ROOT, subdir);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(join(dir, name), "utf8")) as Fixture;
    fixtures.set(fixture.id, fixture);
  }
}

fixtures.set("editor.block-sequence.bare-item-key-past-skipped-line", {
  id: "editor.block-sequence.bare-item-key-past-skipped-line",
  input: "list:\n  - a:\n      freetext\n        c: 1\n",
});
fixtures.set("editor.separator.colon-without-key", {
  id: "editor.separator.colon-without-key",
  input: "k:\n- :\tx\n- : y\n",
});
// Inside quotes a `#` is never a comment (§4), after a space neither.
fixtures.set("editor.comments.hash-after-space-in-quotes", {
  id: "editor.comments.hash-after-space-in-quotes",
  input: "k: ' #x'\nj: \"a\\n #x\"\n",
});

const cases: string[] = [];
for (const [id, tree] of Object.entries(EXPECTED_TREES)) {
  const fixture = fixtures.get(id);
  if (!fixture) throw new Error(`unknown fixture id: ${id}`);
  const input = fixture.input ?? (fixture.generator
    ? runGenerator(fixture.generator.name, fixture.generator.parameters).input
    : undefined);
  if (input === undefined) throw new Error(`${id}: no materializable input`);
  cases.push(`==================\n${id}\n==================\n${input}\n---\n\n${tree}\n`);
}

const generated = cases.join("\n");
if (process.argv.includes("--check")) {
  if (readFileSync(OUTPUT, "utf8") !== generated) {
    console.error(`${OUTPUT} is stale; run bun run corpus:generate`);
    process.exit(1);
  }
  console.log(`${cases.length} generated corpus cases are current`);
} else {
  mkdirSync(join(ROOT, "test", "corpus"), { recursive: true });
  writeFileSync(OUTPUT, generated);
  console.log(`generated ${cases.length} corpus cases at ${OUTPUT}`);
}
