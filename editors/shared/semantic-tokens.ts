/**
 * Semantic tokens from the parser's `outline()`: each key and each comment
 * where the parser reads them, which a grammar can only approximate. Pure —
 * no editor dependency; the language server and vscode-lima encode the list.
 */

import { outline, type LimaOutline, type LimaSpan } from "../../js/src/index.js";
import { limaDocumentText } from "./document-text.js";

/**
 * Standard token types of the Language Server Protocol and VS Code, so that
 * every theme colours them. The order is the legend's: a token's type index.
 */
export const SEMANTIC_TOKEN_TYPES = ["property", "comment"] as const;
export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];

export interface SemanticToken {
  /** 0-based line in the editor's document. */
  line: number;
  /** 0-based column in UTF-16 code units. */
  character: number;
  /** Length in UTF-16 code units. */
  length: number;
  type: SemanticTokenType;
}

/**
 * The tokens of an outline in document order: `property` for each key,
 * `comment` for each comment. `lineOffset` is the document line of the
 * outline's first line; `firstLineColumns` counts the code units before its
 * first column there, a byte order mark that `outline()` does not count.
 */
export function outlineTokens(
  limaOutline: LimaOutline,
  lineOffset = 0,
  firstLineColumns = 0,
): SemanticToken[] {
  const token = (span: LimaSpan, type: SemanticTokenType): SemanticToken => {
    // A key or a comment never spans lines; an editor token cannot either.
    if (span.start.line !== span.end.line) {
      throw new Error(
        `Lima outline: a ${type} span from line ${span.start.line} to line ${span.end.line}`,
      );
    }
    return {
      line: span.start.line - 1 + lineOffset,
      character:
        span.start.column - 1 + (span.start.line === 1 ? firstLineColumns : 0),
      length: span.end.offset - span.start.offset,
      type,
    };
  };
  return [
    ...limaOutline.keys.map(({ span }) => token(span, "property")),
    ...limaOutline.comments.map((span) => token(span, "comment")),
  ].sort((a, b) => a.line - b.line || a.character - b.character);
}

/**
 * The tokens of a `.lima` document, or of the front matter of a Markdown or
 * MDX document at its lines in that document; none for any other document.
 */
export function documentSemanticTokens(
  languageId: string,
  text: string,
): SemanticToken[] {
  const target = limaDocumentText(languageId, text);
  if (!target) return [];
  const byteOrderMark = target.text.startsWith("\uFEFF") ? 1 : 0;
  return outlineTokens(outline(target.text), target.lineOffset, byteOrderMark);
}

/**
 * Each open document's tokens for its latest version. `outline()` runs only
 * when an editor asks for them, and once per version, however often it asks.
 */
export class SemanticTokenCache {
  private readonly entries = new Map<
    string,
    { version: number; tokens: readonly SemanticToken[] }
  >();

  tokens(
    uri: string,
    version: number,
    languageId: string,
    text: () => string,
  ): readonly SemanticToken[] {
    const cached = this.entries.get(uri);
    if (cached?.version === version) return cached.tokens;
    const tokens = documentSemanticTokens(languageId, text());
    this.entries.set(uri, { version, tokens });
    return tokens;
  }

  delete(uri: string): void {
    this.entries.delete(uri);
  }

  clear(): void {
    this.entries.clear();
  }
}
