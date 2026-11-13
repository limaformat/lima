import { expect, test } from "bun:test";
import { Duplex } from "node:stream";
import {
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DefinitionRequest,
  HoverRequest,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  SemanticTokensRequest,
  ShutdownRequest,
  type PublishDiagnosticsParams,
  createProtocolConnection,
} from "vscode-languageserver/node.js";
import { createLimaLanguageServer } from "../src/server.js";

function duplexPair(): [Duplex, Duplex] {
  let left!: Duplex;
  let right!: Duplex;
  left = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      right.push(chunk);
      callback();
    },
  });
  right = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      left.push(chunk);
      callback();
    },
  });
  return [left, right];
}

test("diagnostics and references survive the LSP round trip", async () => {
  const [clientStream, serverStream] = duplexPair();
  const server = createLimaLanguageServer(serverStream, serverStream);
  const client = createProtocolConnection(clientStream, clientStream);
  const pending: Array<(params: PublishDiagnosticsParams) => void> = [];
  let notificationCount = 0;
  client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    notificationCount += 1;
    pending.shift()?.(params);
  });
  client.listen();

  const nextDiagnostics = () =>
    new Promise<PublishDiagnosticsParams>((resolve) => pending.push(resolve));
  const uri = "file:///broken.lima";

  try {
    const initializeResult = await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: {
        lima: { diagnostics: { strict: false } },
      },
    });
    expect(initializeResult.capabilities).toMatchObject({
      hoverProvider: true,
      definitionProvider: true,
      semanticTokensProvider: {
        legend: { tokenTypes: ["property", "comment"], tokenModifiers: [] },
        full: true,
      },
    });
    await client.sendNotification(InitializedNotification.type, {});

    const opened = nextDiagnostics();
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri,
        languageId: "lima",
        version: 1,
        text: "tags: [1, [2]]\n",
      },
    });
    expect(await opened).toMatchObject({
      uri,
      diagnostics: [
        {
          code: "INVALID_FLOW_SYNTAX",
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 14 },
          },
        },
      ],
    });

    const changed = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: "a: 1\na: 2\n" }],
    });
    expect(await changed).toMatchObject({
      uri,
      diagnostics: [
        {
          code: "DUPLICATE_KEY",
          severity: 2,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 4 },
          },
        },
      ],
    });

    const countBeforeIrrelevantConfig = notificationCount;
    await client.sendNotification(DidChangeConfigurationNotification.type, {
      settings: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notificationCount).toBe(countBeforeIrrelevantConfig);

    const changedAfterConfig = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: "a: 1\na: 3\n" }],
    });
    expect(await changedAfterConfig).toMatchObject({
      uri,
      diagnostics: [{ code: "DUPLICATE_KEY", severity: 2 }],
    });

    const referencesChanged = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 4 },
      contentChanges: [
        {
          text:
            "title: Hello\n" +
            "summary: ${title}\n" +
            "missing: ${nonexistent}\n",
        },
      ],
    });
    expect(await referencesChanged).toEqual({ uri, diagnostics: [] });

    const hover = await client.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line: 1, character: 12 },
    });
    expect(hover).toMatchObject({
      contents: {
        kind: "markdown",
        value: expect.stringContaining("defined on line 1"),
      },
      range: {
        start: { line: 1, character: 9 },
        end: { line: 1, character: 17 },
      },
    });

    expect(
      await client.sendRequest(DefinitionRequest.type, {
        textDocument: { uri },
        position: { line: 1, character: 12 },
      }),
    ).toEqual({
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    });

    const unresolvedHover = await client.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line: 2, character: 12 },
    });
    expect(unresolvedHover?.contents).toMatchObject({
      value: expect.stringContaining("No matching resolvable document path"),
    });
    expect(
      await client.sendRequest(DefinitionRequest.type, {
        textDocument: { uri },
        position: { line: 2, character: 12 },
      }),
    ).toBeNull();

    const partialChanged = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 5 },
      contentChanges: [{ text: "author: $(people/alice.name)\n" }],
    });
    expect(await partialChanged).toEqual({ uri, diagnostics: [] });

    const partialHover = await client.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line: 0, character: 14 },
    });
    expect(partialHover?.contents).toMatchObject({
      value: expect.stringContaining("supplied by the caller"),
    });
    expect(
      await client.sendRequest(DefinitionRequest.type, {
        textDocument: { uri },
        position: { line: 0, character: 14 },
      }),
    ).toBeNull();

    const strictConfigRefresh = nextDiagnostics();
    await client.sendNotification(DidChangeConfigurationNotification.type, {
      settings: { lima: { diagnostics: { strict: true } } },
    });
    expect(await strictConfigRefresh).toEqual({ uri, diagnostics: [] });

    const strictDocumentChanged = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 6 },
      contentChanges: [
        { text: "title: first\ntitle: second\nref: ${title}\n" },
      ],
    });
    expect(await strictDocumentChanged).toMatchObject({
      uri,
      diagnostics: [{ code: "DUPLICATE_KEY", severity: 1 }],
    });

    const strictHover = await client.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line: 2, character: 8 },
    });
    expect(strictHover?.contents).toMatchObject({
      value: expect.stringContaining("configured strict mode"),
    });
    expect(
      await client.sendRequest(DefinitionRequest.type, {
        textDocument: { uri },
        position: { line: 2, character: 8 },
      }),
    ).toBeNull();

    const unrecognisedChanged = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 7 },
      contentChanges: [{ text: "title: ok\nmissing separator\n" }],
    });
    expect(await unrecognisedChanged).toMatchObject({
      uri,
      diagnostics: [
        {
          code: "UNRECOGNIZED_LINE",
          message: expect.stringContaining('a key needs ": " after it'),
        },
      ],
    });

    const unsupportedYamlChanged = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 8 },
      contentChanges: [
        { text: "link: https://example.org/x#top\nbody: >\n  folded\n" },
      ],
    });
    expect(await unsupportedYamlChanged).toMatchObject({
      uri,
      diagnostics: [
        {
          code: "UNSUPPORTED_YAML",
          severity: 1,
          message: expect.stringContaining('Lima writes "|"'),
          range: { start: { line: 1, character: 0 } },
        },
      ],
    });

    const invalidDocumentChanged = nextDiagnostics();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 9 },
      contentChanges: [{ text: "title: \ud800\n" }],
    });
    expect(await invalidDocumentChanged).toMatchObject({
      uri,
      diagnostics: [{ code: "INVALID_DOCUMENT", severity: 1 }],
    });

    const closed = nextDiagnostics();
    await client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri },
    });
    expect(await closed).toEqual({ uri, diagnostics: [] });

    await client.sendRequest(ShutdownRequest.type);
  } finally {
    client.dispose();
    server.dispose();
  }
}, 5_000);

test("semantic tokens mark keys and comments as outline() reads them", async () => {
  const [clientStream, serverStream] = duplexPair();
  const server = createLimaLanguageServer(serverStream, serverStream);
  const client = createProtocolConnection(clientStream, clientStream);
  const opened = new Map<string, () => void>();
  client.onNotification(PublishDiagnosticsNotification.type, ({ uri }) =>
    opened.get(uri)?.(),
  );
  client.listen();
  const open = (uri: string, languageId: string, text: string) => {
    const published = new Promise<void>((resolve) => opened.set(uri, resolve));
    void client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId, version: 1, text },
    });
    return published;
  };
  const tokens = async (uri: string) =>
    (await client.sendRequest(SemanticTokensRequest.type, { textDocument: { uri } }))?.data;

  try {
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      capabilities: {},
    });
    await client.sendNotification(InitializedNotification.type, {});

    await open(
      "file:///tokens.lima",
      "lima",
      "author: # who\n  name: Alice\nlink: https://example.org/x#top\n",
    );
    // line delta, start delta, length, type (0 property, 1 comment), modifiers
    expect(await tokens("file:///tokens.lima")).toEqual([
      0, 0, 6, 0, 0,
      0, 8, 5, 1, 0,
      1, 2, 4, 0, 0,
      1, 0, 4, 0, 0,
    ]);

    await open("file:///post.md", "markdown", "---\ntitle: Hello # hi\n---\n# Post\n");
    expect(await tokens("file:///post.md")).toEqual([
      1, 0, 5, 0, 0,
      0, 13, 4, 1, 0,
    ]);

    expect(await tokens("file:///unopened.lima")).toEqual([]);

    await client.sendRequest(ShutdownRequest.type);
  } finally {
    client.dispose();
    server.dispose();
  }
}, 5_000);
