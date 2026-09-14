import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { scanReferenceTokens2 } from "../../js/src/reference-tokens2.js";

type TokenKind = "document" | "partial";

const CASES: { token: string; kind: TokenKind; valid: boolean }[] = [
  { token: "${key}", kind: "document", valid: true },
  { token: "${site.default.claim}", kind: "document", valid: true },
  { token: "${a:b-c_1.0}", kind: "document", valid: true },
  { token: "${_private.9lives}", kind: "document", valid: true },
  { token: "$(key)", kind: "partial", valid: true },
  { token: "$(people/alice.name)", kind: "partial", valid: true },
  { token: "$(a:b-c/path.more:x)", kind: "partial", valid: true },
  { token: "$(_root/name-space:part.child_2)", kind: "partial", valid: true },
  { token: "$key", kind: "document", valid: false },
  { token: "${}", kind: "document", valid: false },
  { token: "${.key}", kind: "document", valid: false },
  { token: "${key.}", kind: "document", valid: false },
  { token: "${key/path}", kind: "document", valid: false },
  { token: "${key}suffix", kind: "document", valid: false },
  { token: "$()", kind: "partial", valid: false },
  { token: "$(key..value)", kind: "partial", valid: false },
  { token: "$(key.value/path)", kind: "partial", valid: false },
  { token: "$(-leading)", kind: "partial", valid: false },
  { token: "$(name.:child)", kind: "partial", valid: false },
  { token: "prefix$(key)", kind: "partial", valid: false },
];

const root = resolve(__dirname, "../..");

test("all editor grammars agree with the References 2.0 scanner", async () => {
  const patterns = await editorPatterns();

  for (const example of CASES) {
    const scanned = scanReferenceTokens2(example.token, undefined);
    const scannerAccepts =
      scanned.length === 1 &&
      scanned[0].token === example.token &&
      (scanned[0].documentPath === undefined ? "partial" : "document") ===
        example.kind;
    expect(scannerAccepts, `scanner: ${example.token}`).toBe(example.valid);

    for (const [editor, byKind] of Object.entries(patterns)) {
      for (const kind of ["document", "partial"] as const) {
        expect(
          fullMatch(byKind[kind], example.token),
          `${editor}/${kind}: ${example.token}`,
        ).toBe(example.valid && example.kind === kind);
      }
    }
  }
});

async function editorPatterns(): Promise<
  Record<string, Record<TokenKind, string>>
> {
  const textMate = JSON.parse(
    await Bun.file(
      resolve(root, "editors/vscode/syntaxes/lima.tmLanguage.json"),
    ).text(),
  ) as {
    repository: Record<string, { match: string }>;
  };
  const sublime = await Bun.file(
    resolve(root, "editors/lsp/syntaxes/lima.sublime-syntax"),
  ).text();
  const emacs = await Bun.file(
    resolve(root, "editors/lsp/emacs/lima-mode.el"),
  ).text();

  return {
    vscode: {
      document: textMate.repository["reference-document"].match,
      partial: textMate.repository["reference-partial"].match,
    },
    sublime: {
      document: sublimePattern(sublime, "reference-document"),
      partial: sublimePattern(sublime, "reference-partial"),
    },
    emacs: {
      document: emacsPattern(emacs, "document-reference"),
      partial: emacsPattern(emacs, "partial-reference"),
    },
  };
}

function sublimePattern(source: string, context: string): string {
  const section = source.slice(source.indexOf(`\n  ${context}:`));
  const match = section.match(/\n    - match: '([^']+)'/);
  if (!match) throw new Error(`missing Sublime pattern for ${context}`);
  return match[1];
}

function emacsPattern(source: string, name: string): string {
  const marker = `(defconst lima--${name}-regexp`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing Emacs pattern for ${name}`);
  const literal = source
    .slice(start + marker.length)
    .match(/^\s*"((?:\\.|[^"])*)"/);
  if (!literal) throw new Error(`invalid Emacs pattern for ${name}`);
  return emacsToJavaScript(JSON.parse(`"${literal[1]}"`) as string);
}

function emacsToJavaScript(pattern: string): string {
  const openGroup = "__LIMA_OPEN_GROUP__";
  const closeGroup = "__LIMA_CLOSE_GROUP__";
  let translated = pattern
    .replaceAll("\\(?:", openGroup)
    .replaceAll("\\)", closeGroup)
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll(openGroup, "(?:")
    .replaceAll(closeGroup, ")");
  if (translated.startsWith("\\${")) {
    translated = `\\$\\{${translated.slice(3, -1)}\\}`;
  }
  return translated;
}

function fullMatch(pattern: string, token: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(token);
}
