import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { UNICODE_KEY_RANGES } from "../../../js/src/unicode-key-table.js";

const output = resolve(import.meta.dir, "../src/unicode_key_table.h");
const rows: string[] = [];
for (let i = 0; i < UNICODE_KEY_RANGES.length; i += 12) {
  rows.push(
    `  ${Array.from(UNICODE_KEY_RANGES.slice(i, i + 12), (value) => `0x${value.toString(16)}`).join(", ")},`,
  );
}

writeFileSync(
  output,
  `// Generated from js/src/unicode-key-table.ts (Unicode 18.0.0); DO NOT EDIT.\n` +
    `#ifndef TREE_SITTER_LIMA_UNICODE_KEY_TABLE_H_\n` +
    `#define TREE_SITTER_LIMA_UNICODE_KEY_TABLE_H_\n\n` +
    `static const uint32_t lima_unicode_key_ranges[] = {\n${rows.join("\n")}\n};\n` +
    `static const uint32_t lima_unicode_key_ranges_len = ${UNICODE_KEY_RANGES.length};\n\n` +
    `#endif\n`,
);

console.log(`generated ${output}`);
