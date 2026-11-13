/**
 * Lima for VS Code — live diagnostics and reference navigation.
 *
 * Runs the real Lima parser (bundled from the monorepo) over `.lima`
 * documents and the frontmatter block of Markdown / MDX, and reports the
 * spec's diagnostics — codes, messages, positions — as editor squiggles.
 * Active References 2.0 tokens also provide hover information, and
 * document references can navigate to their target line. Semantic tokens
 * mark keys and comments as the parser's outline() reads them, over the
 * TextMate grammar's colours.
 */

import * as vscode from "vscode";
import { DEBOUNCE_MS, MARKDOWN_LANGS } from "../../shared/constants.js";
import { KeyedDebouncer } from "../../shared/debounce.js";
import { check, type LimaFinding } from "../../shared/diagnostics.js";
import { limaDocumentText } from "../../shared/document-text.js";
import { findingRange } from "../../shared/finding-range.js";
import { ReferenceResolver } from "../../shared/references.js";
import {
  SEMANTIC_TOKEN_TYPES,
  SemanticTokenCache,
} from "../../shared/semantic-tokens.js";

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("lima");
  context.subscriptions.push(collection);

  const debouncer = new KeyedDebouncer<string>(DEBOUNCE_MS);
  context.subscriptions.push({ dispose: () => debouncer.disposeAll() });
  const references = new ReferenceResolver();
  context.subscriptions.push({ dispose: () => references.clear() });
  const semanticTokens = new SemanticTokenCache();
  context.subscriptions.push({ dispose: () => semanticTokens.clear() });

  const schedule = (document: vscode.TextDocument) => {
    const key = document.uri.toString();
    debouncer.schedule(
      key,
      () => refresh(document, collection),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc, collection)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      collection.delete(doc.uri);
      references.delete(doc.uri.toString());
      semanticTokens.delete(doc.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("lima.diagnostics")) {
        for (const doc of vscode.workspace.textDocuments) refresh(doc, collection);
      }
    }),
  );

  const documentSelector: vscode.DocumentSelector = [
    { language: "lima" },
    ...[...MARKDOWN_LANGS].map((language) => ({ language })),
  ];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(documentSelector, {
      provideHover(document, position) {
        const reference = references.referenceAt(
          document,
          position,
          documentStrict(document),
        );
        return reference
          ? new vscode.Hover(
              new vscode.MarkdownString(reference.hover),
              toVscodeRange(reference.range),
            )
          : null;
      },
    }),
    vscode.languages.registerDefinitionProvider(documentSelector, {
      provideDefinition(document, position) {
        const definition = references.referenceAt(
          document,
          position,
          documentStrict(document),
        )?.definition;
        return definition
          ? new vscode.Location(document.uri, toVscodeRange(definition))
          : null;
      },
    }),
  );

  const legend = new vscode.SemanticTokensLegend([...SEMANTIC_TOKEN_TYPES], []);
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      documentSelector,
      {
        provideDocumentSemanticTokens(document) {
          const builder = new vscode.SemanticTokensBuilder(legend);
          const tokens = semanticTokens.tokens(
            document.uri.toString(),
            document.version,
            document.languageId,
            () => document.getText(),
          );
          for (const token of tokens) {
            builder.push(
              token.line,
              token.character,
              token.length,
              SEMANTIC_TOKEN_TYPES.indexOf(token.type),
            );
          }
          return builder.build();
        },
      },
      legend,
    ),
  );

  for (const doc of vscode.workspace.textDocuments) refresh(doc, collection);
}

export function deactivate(): void {
  /* the DiagnosticCollection is disposed via context.subscriptions */
}

function refresh(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void {
  const cfg = vscode.workspace.getConfiguration("lima", document);
  if (!cfg.get<boolean>("diagnostics.enable", true)) {
    collection.delete(document.uri);
    return;
  }

  const target = limaDocumentText(document.languageId, document.getText());
  if (!target) {
    collection.delete(document.uri);
    return;
  }

  const findings = check(target.text, {
    strict: documentStrict(document),
    ignoreUnresolvedReferences: cfg.get<boolean>(
      "diagnostics.ignoreUnresolvedReferences",
      true,
    ),
  });

  collection.set(
    document.uri,
    findings.map((f) => toVscode(f, document, target.lineOffset)),
  );
}

function documentStrict(document: vscode.TextDocument): boolean {
  return vscode.workspace
    .getConfiguration("lima", document)
    .get<boolean>("diagnostics.strict", true);
}

function toVscode(
  f: LimaFinding,
  document: vscode.TextDocument,
  lineOffset: number,
): vscode.Diagnostic {
  const range = findingRange(f, lineOffset, (line) =>
    safeLineText(document, line),
  );

  const d = new vscode.Diagnostic(
    toVscodeRange(range),
    f.message,
    f.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning,
  );
  d.source = "lima";
  d.code = f.code;
  return d;
}

function toVscodeRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

function safeLineText(document: vscode.TextDocument, line: number): string {
  if (line < 0 || line >= document.lineCount) return "";
  return document.lineAt(line).text;
}
