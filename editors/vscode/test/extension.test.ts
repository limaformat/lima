import { expect, mock, test } from "bun:test";

type Provider = Record<string, (...args: unknown[]) => unknown>;

let hoverProvider: Provider | undefined;
let definitionProvider: Provider | undefined;
let semanticTokensProvider: Provider | undefined;
let hoverSelector: unknown;
let definitionSelector: unknown;
let semanticTokensSelector: unknown;
let semanticTokensLegend: unknown;
let strict = true;
let openDocument: ((document: unknown) => void) | undefined;
const published = new Map<string, unknown[]>();

const disposable = { dispose() {} };

mock.module("vscode", () => ({
  Range: class Range {
    constructor(
      readonly startLine: number,
      readonly startCharacter: number,
      readonly endLine: number,
      readonly endCharacter: number,
    ) {}
  },
  MarkdownString: class MarkdownString {
    constructor(readonly value: string) {}
  },
  Hover: class Hover {
    constructor(
      readonly contents: { value: string },
      readonly range: unknown,
    ) {}
  },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  SemanticTokensLegend: class SemanticTokensLegend {
    constructor(
      readonly tokenTypes: string[],
      readonly tokenModifiers: string[],
    ) {}
  },
  SemanticTokensBuilder: class SemanticTokensBuilder {
    private readonly tokens: number[][] = [];
    push(...token: number[]) {
      this.tokens.push(token);
    }
    build() {
      return this.tokens;
    }
  },
  Diagnostic: class Diagnostic {
    source?: string;
    code?: string;
    constructor(
      readonly range: unknown,
      readonly message: string,
      readonly severity: number,
    ) {}
  },
  Location: class Location {
    constructor(
      readonly uri: unknown,
      readonly range: unknown,
    ) {}
  },
  languages: {
    createDiagnosticCollection: () => ({
      ...disposable,
      set: (uri: { toString(): string }, diagnostics: unknown[]) =>
        published.set(uri.toString(), diagnostics),
      delete: (uri: { toString(): string }) => published.delete(uri.toString()),
    }),
    registerHoverProvider: (selector: unknown, provider: Provider) => {
      hoverSelector = selector;
      hoverProvider = provider;
      return disposable;
    },
    registerDefinitionProvider: (selector: unknown, provider: Provider) => {
      definitionSelector = selector;
      definitionProvider = provider;
      return disposable;
    },
    registerDocumentSemanticTokensProvider: (
      selector: unknown,
      provider: Provider,
      legend: unknown,
    ) => {
      semanticTokensSelector = selector;
      semanticTokensProvider = provider;
      semanticTokensLegend = legend;
      return disposable;
    },
  },
  workspace: {
    textDocuments: [],
    onDidChangeTextDocument: () => disposable,
    onDidOpenTextDocument: (listener: (document: unknown) => void) => {
      openDocument = listener;
      return disposable;
    },
    onDidCloseTextDocument: () => disposable,
    onDidChangeConfiguration: () => disposable,
    getConfiguration: () => ({
      get: (_setting: string, fallback: boolean) => strict ?? fallback,
    }),
  },
}));

test("activate registers hover, definition and semantic token providers", async () => {
  const { activate } = await import("../src/extension.js");
  const subscriptions: unknown[] = [];

  activate({ subscriptions } as never);

  const expectedSelector = [
    { language: "lima" },
    { language: "markdown" },
    { language: "mdx" },
  ];
  expect(hoverSelector).toEqual(expectedSelector);
  expect(definitionSelector).toEqual(expectedSelector);
  expect(semanticTokensSelector).toEqual(expectedSelector);
  expect(semanticTokensLegend).toEqual({
    tokenTypes: ["property", "comment"],
    tokenModifiers: [],
  });
  expect(hoverProvider?.provideHover).toBeFunction();
  expect(definitionProvider?.provideDefinition).toBeFunction();
  expect(subscriptions).toHaveLength(11);

  const document = {
    uri: { toString: () => "file:///strict.lima" },
    languageId: "lima",
    version: 1,
    getText: () => "title: first\ntitle: second\nref: ${title}\n",
  };
  const position = { line: 2, character: 8 };
  const hover = hoverProvider?.provideHover(document, position) as {
    contents: { value: string };
  };
  expect(hover.contents.value).toContain("configured strict mode");
  expect(
    definitionProvider?.provideDefinition(document, position),
  ).toBeNull();

  strict = false;
  expect(
    definitionProvider?.provideDefinition(document, position),
  ).not.toBeNull();
});

/** A document as the extension reads it. */
function textDocument(uri: string, languageId: string, text: string) {
  const lines = text.split("\n");
  return {
    uri: { toString: () => uri },
    languageId,
    version: 1,
    lineCount: lines.length,
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] }),
  };
}

test("Core 1.3 diagnostics reach the editor with code, line and hint", async () => {
  strict = true;
  const { activate } = await import("../src/extension.js");
  activate({ subscriptions: [] } as never);

  openDocument?.(textDocument("file:///yaml.lima", "lima", "note: *new*\n"));
  expect(published.get("file:///yaml.lima")).toMatchObject([
    {
      code: "UNSUPPORTED_YAML",
      source: "lima",
      severity: 0,
      message: expect.stringContaining("quote the value"),
      range: { startLine: 0, startCharacter: 0 },
    },
  ]);

  // in front matter, the line counts from the start of the Markdown file
  openDocument?.(
    textDocument("file:///post.md", "markdown", "---\ntitle: ok\nbody: >\n---\n# Post\n"),
  );
  expect(published.get("file:///post.md")).toMatchObject([
    { code: "UNSUPPORTED_YAML", range: { startLine: 2 } },
  ]);

  openDocument?.(
    textDocument("file:///ok.lima", "lima", "link: https://example.org/x#top\nauthor: # who\n  name: Alice\n"),
  );
  expect(published.get("file:///ok.lima")).toEqual([]);
});

test("semantic tokens mark keys and comments, in front matter at the document's lines", async () => {
  const { activate } = await import("../src/extension.js");
  activate({ subscriptions: [] } as never);

  // line, character, length, type (0 property, 1 comment)
  expect(
    semanticTokensProvider?.provideDocumentSemanticTokens(
      textDocument("file:///tokens.lima", "lima", "author: # who\n  name: Alice\n"),
    ),
  ).toEqual([
    [0, 0, 6, 0],
    [0, 8, 5, 1],
    [1, 2, 4, 0],
  ]);
  expect(
    semanticTokensProvider?.provideDocumentSemanticTokens(
      textDocument("file:///post.mdx", "mdx", "---\ntitle: Hello # hi\n---\n# Post\n"),
    ),
  ).toEqual([
    [1, 0, 5, 0],
    [1, 13, 4, 1],
  ]);
});

