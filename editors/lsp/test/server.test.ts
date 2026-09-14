import { expect, test } from "bun:test";
import { Duplex } from "node:stream";
import {
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
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

test("findings survive didOpen and debounced didChange over LSP", async () => {
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
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: {
        lima: { diagnostics: { strict: false } },
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
