import type { LimaFinding } from "./diagnostics.js";

export interface RangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/**
 * Maps a Lima finding to a 0-based range, given the length of the line it is
 * on. The caller supplies a line-length lookup because editor document APIs
 * expose it differently.
 */
export function findingRange(
  finding: LimaFinding,
  lineOffset: number,
  lineLength: (line: number) => number,
): RangeLike {
  const line = Math.max(0, finding.line - 1 + lineOffset);
  const length = lineLength(line);
  const startColumn = Math.max(0, finding.column - 1);
  const endColumn =
    finding.length && finding.length > 0
      ? Math.min(length, startColumn + finding.length)
      : length;

  return {
    start: { line, character: Math.min(startColumn, length) },
    end: {
      line,
      character: Math.max(
        endColumn,
        Math.min(startColumn + 1, length),
      ),
    },
  };
}
