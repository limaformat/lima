import { expect, mock, test } from "bun:test";

type Provider = Record<string, (...args: unknown[]) => unknown>;

let hoverProvider: Provider | undefined;
let definitionProvider: Provider | undefined;
let hoverSelector: unknown;
let definitionSelector: unknown;
let strict = true;

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
  Location: class Location {
    constructor(
      readonly uri: unknown,
      readonly range: unknown,
    ) {}
  },
  languages: {
    createDiagnosticCollection: () => ({ ...disposable }),
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
  },
  workspace: {
    textDocuments: [],
    onDidChangeTextDocument: () => disposable,
    onDidOpenTextDocument: () => disposable,
    onDidCloseTextDocument: () => disposable,
    onDidChangeConfiguration: () => disposable,
    getConfiguration: () => ({
      get: (_setting: string, fallback: boolean) => strict ?? fallback,
    }),
  },
}));

test("activate registers hover and definition providers", async () => {
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
  expect(hoverProvider?.provideHover).toBeFunction();
  expect(definitionProvider?.provideDefinition).toBeFunction();
  expect(subscriptions).toHaveLength(9);

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
