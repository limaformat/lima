import {
  parseCoreWithPositionedReferences,
  type PositionedReferenceParse,
  type PositionedValue,
} from "../../js/src/core.js";
import {
  codepointOffsetToUtf16,
  utf16OffsetToCodepoint,
  type ReferenceToken2,
} from "../../js/src/reference-tokens2.js";
import {
  resolveDocumentReferenceTarget,
  type DocumentReferenceTargetResolution,
} from "../../js/src/references2.js";
import { limaDocumentText } from "./document-text.js";
import type { RangeLike } from "./finding-range.js";

export interface PositionLike {
  line: number;
  character: number;
}

export interface LimaReference {
  kind: "document" | "partial";
  path: string;
  token: string;
  range: RangeLike;
  hover: string;
  /** Present only for document references whose path resolves. */
  definition?: RangeLike;
}

export interface ReferenceOptions {
  lineOffset?: number;
  /** Must match the document's diagnostic strictness. Default: `true`. */
  strict?: boolean;
}

export interface ReferenceDocument {
  uri: string | { toString(): string };
  languageId: string;
  version: number;
  getText(): string;
}

type ReferenceIndex = PositionedReferenceParse & {
  referencesByLine: Map<number, ReferenceToken2[]>;
  lines: string[];
  strictInvalid: boolean;
  targets: Map<string, DocumentReferenceTargetResolution>;
};

type CachedDocument = {
  version: number;
  languageId: string;
  strict: boolean;
  source: { index: ReferenceIndex; lineOffset: number } | null;
};

/**
 * Version-keyed navigation cache shared by direct and LSP editor adapters.
 * Hover followed by definition therefore parses a document only once.
 */
export class ReferenceResolver {
  private readonly documents = new Map<string, CachedDocument>();

  referenceAt(
    document: ReferenceDocument,
    position: PositionLike,
    strict = true,
  ): LimaReference | null {
    const source = this.sourceFor(document, strict);
    return source
      ? referenceFromIndex(source.index, position, source.lineOffset)
      : null;
  }

  delete(uri: string): void {
    this.documents.delete(uri);
  }

  clear(): void {
    this.documents.clear();
  }

  private sourceFor(
    document: ReferenceDocument,
    strict: boolean,
  ): CachedDocument["source"] {
    const uri = document.uri.toString();
    const cached = this.documents.get(uri);
    if (
      cached?.version === document.version &&
      cached.languageId === document.languageId &&
      cached.strict === strict
    ) {
      return cached.source;
    }

    const selected = limaDocumentText(document.languageId, document.getText());
    const index = selected ? createReferenceIndex(selected.text, strict) : null;
    const source =
      selected && index
        ? { index, lineOffset: selected.lineOffset }
        : null;
    this.documents.set(uri, {
      version: document.version,
      languageId: document.languageId,
      strict,
      source,
    });
    return source;
  }
}

/** Pure, uncached entry point used by unit tests and non-document callers. */
export function referenceAtPosition(
  text: string,
  position: PositionLike,
  options: ReferenceOptions = {},
): LimaReference | null {
  const index = createReferenceIndex(text, options.strict ?? true);
  return index
    ? referenceFromIndex(index, position, options.lineOffset ?? 0)
    : null;
}

function createReferenceIndex(
  text: string,
  strict: boolean,
): ReferenceIndex | null {
  try {
    const located = parseCoreWithPositionedReferences(text, { strict });
    return referenceIndex(located, text, false);
  } catch {
    if (!strict) return null;
    try {
      const located = parseCoreWithPositionedReferences(text, {
        strict: false,
      });
      return referenceIndex(located, text, true);
    } catch {
      return null;
    }
  }
}

function referenceIndex(
  located: PositionedReferenceParse,
  text: string,
  strictInvalid: boolean,
): ReferenceIndex {
  return {
    document: located.document,
    references: located.references,
    referencesByLine: indexReferencesByLine(located.references),
    lines: text.split(/\r\n|\r|\n/),
    strictInvalid,
    targets: new Map(),
  };
}

function referenceFromIndex(
  index: ReferenceIndex,
  position: PositionLike,
  lineOffset: number,
): LimaReference | null {
  const localLine = position.line - lineOffset;
  if (localLine < 0) return null;

  const line = index.lines[localLine] ?? "";
  const cursorCodepoint = utf16OffsetToCodepoint(line, position.character);
  for (const token of index.referencesByLine.get(localLine) ?? []) {
    // Reference-token syntax is ASCII, so its UTF-16 and codepoint lengths
    // are identical. Rule out non-matches before converting the token offset.
    if (
      cursorCodepoint < token.offset ||
      cursorCodepoint >= token.offset + token.token.length
    ) {
      continue;
    }
    const startCharacter = codepointOffsetToUtf16(line, token.offset);
    return describeReference(index, token, lineOffset, startCharacter);
  }

  return null;
}

function indexReferencesByLine(
  references: ReferenceToken2[],
): Map<number, ReferenceToken2[]> {
  const byLine = new Map<number, ReferenceToken2[]>();
  for (const reference of references) {
    const line = reference.line - 1;
    const lineReferences = byLine.get(line);
    if (lineReferences) {
      lineReferences.push(reference);
    } else {
      byLine.set(line, [reference]);
    }
  }
  for (const lineReferences of byLine.values()) {
    lineReferences.sort((left, right) => left.offset - right.offset);
  }
  return byLine;
}

function describeReference(
  index: ReferenceIndex,
  token: ReferenceToken2,
  lineOffset: number,
  startCharacter: number,
): LimaReference {
  const tokenLine = token.line - 1 + lineOffset;
  const range = lineRange(
    tokenLine,
    startCharacter,
    startCharacter + token.token.length,
  );
  if (token.partialPath !== undefined) {
    return {
      kind: "partial",
      path: token.partialPath,
      token: token.token,
      range,
      hover:
        `**Lima partial reference** \`${token.token}\`\n\n` +
        "Value supplied by the caller; not resolvable in this document.",
    };
  }

  const path = token.documentPath!;
  if (index.strictInvalid) {
    return {
      kind: "document",
      path,
      token: token.token,
      range,
      hover:
        `**Lima document reference** \`${token.token}\`\n\n` +
        "Target resolution is unavailable because this document does not " +
        "parse in the configured strict mode.",
    };
  }
  let resolution: DocumentReferenceTargetResolution;
  if (index.targets.has(path)) {
    resolution = index.targets.get(path)!;
  } else {
    resolution = resolveDocumentReferenceTarget(index, path);
    index.targets.set(path, resolution);
  }
  if (resolution.status === "unverifiable-partials") {
    return {
      kind: "document",
      path,
      token: token.token,
      range,
      hover:
        `**Lima document reference** \`${token.token}\`\n\n` +
        `Target \`${path}\` exists, but resolution cannot be verified because ` +
        "this document contains partial values supplied by the caller.",
    };
  }
  if (resolution.status === "unresolved") {
    return {
      kind: "document",
      path,
      token: token.token,
      range,
      hover:
        `**Lima document reference** \`${token.token}\`\n\n` +
        `No matching resolvable document path \`${path}\` was found.`,
    };
  }

  const target = resolution.target;
  const definitionLine = Math.max(0, target.line - 1 + lineOffset);
  return {
    kind: "document",
    path,
    token: token.token,
    range,
    definition: lineRange(definitionLine, 0, 0),
    hover:
      `**Lima document reference** \`${token.token}\`\n\n` +
      `Target \`${path}\` (${valueKind(target)}), defined on line ` +
      `${definitionLine + 1}.`,
  };
}

function lineRange(
  line: number,
  startCharacter: number,
  endCharacter: number,
): RangeLike {
  return {
    start: { line, character: startCharacter },
    end: { line, character: endCharacter },
  };
}

function valueKind(value: PositionedValue): string {
  switch (value.kind) {
    case "array":
      return "sequence";
    case "bool":
      return "boolean";
    case "instant":
      return "instant";
    case "int":
      return "integer";
    default:
      return value.kind;
  }
}
