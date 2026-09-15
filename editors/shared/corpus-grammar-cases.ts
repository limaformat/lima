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

/**
 * One-line comment/quote fixtures from the normative conformance corpus.
 * Offsets are JavaScript/UTF-16 offsets, matching TextMate, Sublime, and
 * Emacs buffer positions for the ASCII delimiters in these cases.
 */
export const CORPUS_GRAMMAR_CASES: CorpusGrammarCase[] = [
  ...readCorpusDirectory("core"),
  ...readCorpusDirectory("references-2.0"),
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
        !fixture.tags?.some((tag) => tag === "comment" || tag === "quoted") ||
        fixture.input.trimEnd().includes("\n")
      ) {
        return [];
      }

      // Drop transport newlines used by corpus JSON while retaining any
      // trailing spaces that are part of the actual one-line fixture.
      const input = fixture.input.replace(/(?:\r?\n)+$/, "");
      const commentStart = findCommentStart(input);
      return [
        {
          id: fixture.id,
          input,
          commentStart,
          quoteRanges: findQuoteRanges(
            commentStart === null ? input : input.slice(0, commentStart),
          ),
        },
      ];
    });
}

function findCommentStart(input: string): number | null {
  const value = stripCommentKeepEscapes(input);
  if (value === input.trimEnd()) return null;

  // stripCommentKeepEscapes trims whitespace immediately before a comment.
  // Let the oracle decide whether a comment exists, then locate the `#` whose
  // preceding text normalizes to the oracle's returned value.
  for (let index = value.length; index < input.length; index++) {
    if (
      input[index] === "#" &&
      input.slice(0, index).trimEnd() === value
    ) {
      return index;
    }
  }
  throw new Error(`comment oracle returned an unlocatable boundary: ${input}`);
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
