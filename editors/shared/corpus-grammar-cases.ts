import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  closingQuoteIndex,
  stripCommentKeepEscapes,
} from "../../js/src/scalars.js";

export interface CorpusQuoteRange {
  /** UTF-16 offsets, start inclusive and end exclusive. */
  range: [number, number];
  quote: "single" | "double";
  kind: "key" | "string";
  closed: boolean;
}

export interface CorpusGrammarCase {
  id: string;
  input: string;
  /** UTF-16 offset of the first comment `#`, or null when there is none. */
  commentStart: number | null;
  quoteRanges: CorpusQuoteRange[];
}

interface CorpusFile {
  id: string;
  input?: string;
  tags?: string[];
}

const CORPUS = resolve(__dirname, "../..", "corpus");

const GRAMMAR_TAGS = new Set(["comment", "comments", "quoted", "quoting"]);

/** The cases a later suite replaces, by that suite's manifest. */
const SUPERSEDED = new Set(
  ["core-1.1", "core-1.3"].flatMap(
    (suite) =>
      (
        JSON.parse(
          readFileSync(resolve(CORPUS, "manifests", `${suite}.json`), "utf8"),
        ) as { supersedes: string[] }
      ).supersedes,
  ),
);

/**
 * Comment and quote fixtures from the normative conformance corpus of Core
 * 1.3 and References 2.1, one case per line: the grammars read line by line.
 * The comment oracle is the parser's own boundary on that line, so a line
 * inside a `|` block scalar, whose `#` is content, cannot be judged alone;
 * fixtures with block scalars are left out. Offsets are JavaScript/UTF-16
 * offsets, as TextMate counts them, and Emacs buffer positions for these
 * lines, which hold no character outside the BMP; the Sublime generator turns
 * them into the UTF-8 byte columns its syntax tests count.
 */
export const CORPUS_GRAMMAR_CASES: CorpusGrammarCase[] = [
  ...readCorpusDirectory("core"),
  ...readCorpusDirectory("core-1.1"),
  ...readCorpusDirectory("core-1.2"),
  ...readCorpusDirectory("core-1.3"),
  ...readCorpusDirectory("references-2.0"),
  ...readCorpusDirectory("references-2.1"),
].sort((a, b) => a.id.localeCompare(b.id));

function readCorpusDirectory(directory: string): CorpusGrammarCase[] {
  const path = resolve(CORPUS, directory);
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const fixture = JSON.parse(
        readFileSync(resolve(path, name), "utf8"),
      ) as CorpusFile;
      if (
        typeof fixture.input !== "string" ||
        SUPERSEDED.has(fixture.id) ||
        !fixture.tags?.some((tag) => GRAMMAR_TAGS.has(tag)) ||
        fixture.tags.includes("block-scalar")
      ) {
        return [];
      }

      // Drop transport newlines used by corpus JSON while retaining any
      // trailing spaces that are part of the actual fixture lines.
      const lines = fixture.input.replace(/(?:\r?\n)+$/, "").split(/\r?\n|\r/);
      return lines.flatMap((input, index) => {
        if (input.trim() === "") return [];
        const commentStart = findCommentStart(input);
        return [
          {
            id: lines.length === 1 ? fixture.id : `${fixture.id}:${index + 1}`,
            input,
            commentStart,
            quoteRanges: findQuoteRanges(
              commentStart === null ? input : input.slice(0, commentStart),
            ),
          },
        ];
      });
    });
}

function findCommentStart(input: string): number | null {
  const start = afterQuotedKey(input);
  const text = input.slice(start);
  const value = stripCommentKeepEscapes(text);
  if (value === text.trimEnd()) return null;

  // stripCommentKeepEscapes trims whitespace immediately before a comment.
  // Let the oracle decide whether a comment exists, then locate the `#` whose
  // preceding text normalizes to the oracle's returned value.
  for (let index = value.length; index < text.length; index++) {
    if (text[index] === "#" && text.slice(0, index).trimEnd() === value) {
      return start + index;
    }
  }
  throw new Error(`comment oracle returned an unlocatable boundary: ${input}`);
}

/**
 * Where the parser looks for a line's comment: after the separator's colon of
 * a quoted key at the line's start, after an item's dash too, since it reads
 * the key by the key rules first (Core §5.2: a single-quoted key has no
 * escape, so `'a\': # c` holds a comment); otherwise from the start.
 */
function afterQuotedKey(input: string): number {
  const key = /^[ \t]*(?:-[ \t]+)?/.exec(input)![0].length;
  if (input[key] !== "'" && input[key] !== '"') return 0;
  const close = closingQuoteIndex(input.slice(key), false);
  const colon = key + close + 1;
  return close >= 0 && /^:[ \t]/.test(input.slice(colon)) ? colon + 1 : 0;
}

function findQuoteRanges(input: string): CorpusQuoteRange[] {
  const ranges: CorpusQuoteRange[] = [];
  for (let start = 0; start < input.length; start++) {
    const delimiter = input[start];
    if (delimiter !== '"' && delimiter !== "'") continue;
    if (start > 0 && input[start - 1] === "\\") continue;
    // A quote in running text (for example YAML's) is not an opener.
    if (start > 0 && /[A-Za-z0-9_]/.test(input[start - 1])) continue;

    const keyClose = closingQuoteIndex(input.slice(start), false);
    const isKey =
      keyClose >= 0 && /^\s*:/.test(input.slice(start + keyClose + 1));
    const close = closingQuoteIndex(input.slice(start), !isKey);
    const end = close < 0 ? input.length : start + close + 1;
    ranges.push({
      range: [start, end],
      quote: delimiter === '"' ? "double" : "single",
      kind: isKey ? "key" : "string",
      closed: close >= 0,
    });
    start = end - 1;
  }
  return ranges;
}
