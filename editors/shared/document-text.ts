import { MARKDOWN_LANGS } from "./constants.js";
import { extractFrontmatter } from "./frontmatter.js";

export interface LimaDocumentText {
  text: string;
  lineOffset: number;
}

/** Selects standalone Lima text or a leading Markdown/MDX frontmatter body. */
export function limaDocumentText(
  languageId: string,
  text: string,
): LimaDocumentText | null {
  if (languageId === "lima") return { text, lineOffset: 0 };
  if (!MARKDOWN_LANGS.has(languageId)) return null;
  const frontmatter = extractFrontmatter(text);
  return frontmatter
    ? { text: frontmatter.text, lineOffset: frontmatter.startLine }
    : null;
}
