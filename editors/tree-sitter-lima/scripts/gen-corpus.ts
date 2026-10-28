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
          value: (number))
        (block_mapping_entry
          key: (key)
          value: (number))))))`,
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
for (const subdir of ["core", "core-1.1", "references-2.0"]) {
  const dir = join(SOURCE_ROOT, subdir);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(join(dir, name), "utf8")) as Fixture;
    fixtures.set(fixture.id, fixture);
  }
}

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
