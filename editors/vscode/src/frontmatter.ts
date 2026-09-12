/**
 * Extracts the Lima frontmatter block from a Markdown / MDX document:
 * a `---` fence on the very first line, its content, and a closing `---`
 * fence alone on a line. Pure — no `vscode` dependency.
 */

export interface Frontmatter {
  /** The frontmatter body, without the fences. */
  text: string;
  /** 0-based line index of the first body line (for offsetting findings). */
  startLine: number;
}

const OPEN = /^-{3}[ \t]*\r?\n/;
const CLOSE = /(\r?\n)-{3}[ \t]*(?:\r?\n|$)/;

export function extractFrontmatter(document: string): Frontmatter | null {
  if (!OPEN.test(document)) return null;
  const afterOpen = document.replace(OPEN, "");
  const close = CLOSE.exec(afterOpen);
  if (!close) return null;
  return {
    // keep the newline that precedes the closing fence as part of the body
    text: afterOpen.slice(0, close.index) + close[1],
    startLine: 1, // line 0 is the opening fence; the body starts at line 1
  };
}
