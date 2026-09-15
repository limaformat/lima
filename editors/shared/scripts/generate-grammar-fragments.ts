import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMENT,
  DOCUMENT_REFERENCE,
  EMACS_DOCUMENT_REFERENCE,
  EMACS_KEY,
  EMACS_PARTIAL_REFERENCE,
  KEY,
  PARTIAL_REFERENCE,
} from "../grammar-fragments.js";

const ROOT = resolve(__dirname, "../../..");
const TEXTMATE = resolve(
  ROOT,
  "editors/vscode/syntaxes/lima.tmLanguage.json",
);
const SUBLIME = resolve(ROOT, "editors/lsp/syntaxes/lima.sublime-syntax");
const EMACS = resolve(ROOT, "editors/lsp/emacs/lima-mode.el");

update(TEXTMATE, generateTextMate);
update(SUBLIME, generateSublime);
update(EMACS, generateEmacs);
console.log(
  "generated canonical grammar fragments for TextMate, Sublime, and Emacs",
);

function update(path: string, generate: (source: string) => string): void {
  const source = readFileSync(path, "utf8");
  const generated = generate(source);
  if (generated !== source) writeFileSync(path, generated);
}

function generateTextMate(source: string): string {
  const generated = [
    ["textmate-comment", COMMENT],
    ["textmate-mapping-key", String.raw`^(\s*)(${KEY})(\s*)(:)(?=\s|$)`],
    ["textmate-document-reference", DOCUMENT_REFERENCE],
    ["textmate-partial-reference", PARTIAL_REFERENCE],
    ["textmate-flow-mapping-key", String.raw`(${KEY})(\s*)(:)(?=\s)`],
  ].reduce(
    (current, [marker, pattern]) =>
      replaceLineAfterMarker(
        current,
        `GENERATED:${marker}`,
        "match",
        json(pattern),
      ),
    source,
  );
  JSON.parse(generated);
  return generated;
}

function generateSublime(source: string): string {
  return [
    ["sublime-key", "key", yamlDoubleQuoted(KEY)],
    ["sublime-comment", "- match", yamlSingleQuoted(COMMENT)],
    [
      "sublime-document-reference",
      "- match",
      yamlSingleQuoted(DOCUMENT_REFERENCE),
    ],
    [
      "sublime-partial-reference",
      "- match",
      yamlSingleQuoted(PARTIAL_REFERENCE),
    ],
  ].reduce(
    (current, [marker, key, value]) =>
      replaceLineAfterMarker(current, `GENERATED:${marker}`, key, value),
    source,
  );
}

function generateEmacs(source: string): string {
  return [
    ["emacs-key", "lima--key-regexp", EMACS_KEY],
    [
      "emacs-document-reference",
      "lima--document-reference-regexp",
      EMACS_DOCUMENT_REFERENCE,
    ],
    [
      "emacs-partial-reference",
      "lima--partial-reference-regexp",
      EMACS_PARTIAL_REFERENCE,
    ],
  ].reduce(
    (current, [marker, name, pattern]) =>
      replaceElispConstant(current, `GENERATED:${marker}`, name, pattern),
    source,
  );
}

function replaceLineAfterMarker(
  source: string,
  marker: string,
  key: string,
  value: string,
): string {
  const markerOffset = uniqueMarkerOffset(source, marker);
  const lineStart = source.indexOf("\n", markerOffset) + 1;
  if (lineStart === 0) throw new Error(`${marker}: missing generated line`);
  const lineEnd = source.indexOf("\n", lineStart);
  if (lineEnd < 0) throw new Error(`${marker}: unterminated generated line`);
  const line = source.slice(lineStart, lineEnd);
  const match = line.match(/^(\s*)(?:"?)([^":]+)(?:"?):\s.*$/);
  if (!match || match[2].trim() !== key) {
    throw new Error(`${marker}: expected ${key} line, got ${line.trim()}`);
  }
  const renderedKey = line.includes(`"${key}"`) ? `"${key}"` : key;
  const suffix = line.trimEnd().endsWith(",") ? "," : "";
  return (
    `${source.slice(0, lineStart)}${match[1]}${renderedKey}: ` +
    `${value}${suffix}${source.slice(lineEnd)}`
  );
}

function replaceElispConstant(
  source: string,
  marker: string,
  name: string,
  pattern: string,
): string {
  const markerOffset = uniqueMarkerOffset(source, marker);
  const blockStart = source.indexOf("\n", markerOffset) + 1;
  const blockEnd = source.indexOf("\n\n", blockStart);
  if (blockStart === 0 || blockEnd < 0) {
    throw new Error(`${marker}: missing defconst block`);
  }
  const block = source.slice(blockStart, blockEnd);
  if (!block.startsWith(`(defconst ${name}\n`)) {
    throw new Error(`${marker}: expected defconst ${name}`);
  }
  const rendered = `(defconst ${name}\n  ${json(pattern)})`;
  return `${source.slice(0, blockStart)}${rendered}${source.slice(blockEnd)}`;
}

function uniqueMarkerOffset(source: string, marker: string): number {
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error(`missing marker ${marker}`);
  if (source.indexOf(marker, offset + marker.length) >= 0) {
    throw new Error(`duplicate marker ${marker}`);
  }
  return offset;
}

function json(value: string): string {
  return JSON.stringify(value);
}

function yamlSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function yamlDoubleQuoted(value: string): string {
  return json(value);
}
