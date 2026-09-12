/**
 * Lima for VS Code — live diagnostics.
 *
 * Runs the real Lima parser (bundled from the monorepo) over `.lima`
 * documents and the frontmatter block of Markdown / MDX, and reports the
 * spec's diagnostics — codes, messages, positions — as editor squiggles.
 */

import * as vscode from "vscode";
import { check, type LimaFinding } from "./diagnostics.js";
import { extractFrontmatter } from "./frontmatter.js";

const DEBOUNCE_MS = 300;
const MARKDOWN_LANGS = new Set(["markdown", "mdx"]);

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("lima");
  context.subscriptions.push(collection);

  const timers = new Map<string, NodeJS.Timeout>();

  const schedule = (document: vscode.TextDocument) => {
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(document, collection);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc, collection)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("lima.diagnostics")) {
        for (const doc of vscode.workspace.textDocuments) refresh(doc, collection);
      }
    }),
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

  const target = limaText(document);
  if (!target) {
    collection.delete(document.uri);
    return;
  }

  const findings = check(target.text, {
    strict: cfg.get<boolean>("diagnostics.strict", true),
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

/** The Lima text to check, and the line offset to add to every finding. */
function limaText(
  document: vscode.TextDocument,
): { text: string; lineOffset: number } | null {
  if (document.languageId === "lima") {
    return { text: document.getText(), lineOffset: 0 };
  }
  if (MARKDOWN_LANGS.has(document.languageId)) {
    const fm = extractFrontmatter(document.getText());
    return fm ? { text: fm.text, lineOffset: fm.startLine } : null;
  }
  return null;
}

function toVscode(
  f: LimaFinding,
  document: vscode.TextDocument,
  lineOffset: number,
): vscode.Diagnostic {
  const line = Math.max(0, f.line - 1 + lineOffset);
  const startCol = Math.max(0, f.column - 1);
  const lineLength = safeLineLength(document, line);
  const endCol =
    f.length && f.length > 0
      ? Math.min(lineLength, startCol + f.length)
      : lineLength;

  const range = new vscode.Range(
    line,
    Math.min(startCol, lineLength),
    line,
    Math.max(endCol, Math.min(startCol + 1, lineLength)),
  );

  const d = new vscode.Diagnostic(
    range,
    f.message,
    f.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning,
  );
  d.source = "lima";
  d.code = f.code;
  return d;
}

function safeLineLength(document: vscode.TextDocument, line: number): number {
  if (line < 0 || line >= document.lineCount) return 0;
  return document.lineAt(line).text.length;
}
