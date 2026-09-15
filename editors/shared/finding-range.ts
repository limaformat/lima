import type { LimaFinding } from "./diagnostics.js";
import { codepointOffsetToUtf16 } from "../../js/src/reference-tokens2.js";

export interface RangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/**
 * Maps a Lima finding's 1-based codepoint position to a 0-based UTF-16 range.
 * The caller supplies the source line because editor document APIs expose it
 * differently.
 */
export function findingRange(
  finding: LimaFinding,
  lineOffset: number,
  lineText: (line: number) => string,
): RangeLike {
  const line = Math.max(0, finding.line - 1 + lineOffset);
  const text = lineText(line);
  const startCodepoint = Math.max(0, finding.column - 1);
  const startCharacter = codepointOffsetToUtf16(text, startCodepoint);
  const endCharacter =
    finding.length && finding.length > 0
      ? codepointOffsetToUtf16(text, startCodepoint + finding.length)
      : text.length;
  const minimumEnd = codepointOffsetToUtf16(text, startCodepoint + 1);

  return {
    start: { line, character: startCharacter },
    end: {
      line,
      character: Math.max(endCharacter, minimumEnd),
    },
  };
}
