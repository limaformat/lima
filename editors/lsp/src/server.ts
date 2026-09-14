import { realpathSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  DiagnosticSeverity,
  type Diagnostic,
  type InitializeResult,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { DEBOUNCE_MS, MARKDOWN_LANGS } from "../../shared/constants.js";
import {
  check,
  type CheckOptions,
  type LimaFinding,
} from "../../shared/diagnostics.js";
import { findingRange } from "../../shared/finding-range.js";
import { extractFrontmatter } from "../../shared/frontmatter.js";
import { DocumentStore } from "./document-store.js";

const DEFAULT_CONFIG: Required<CheckOptions> = {
  strict: true,
  ignoreUnresolvedReferences: true,
};

export interface ServerOptions {
  /** The production default is 300 ms; tests may shorten it. */
  debounceMs?: number;
}

/** Create, register, and start a Lima language server on the supplied streams. */
export function createLimaLanguageServer(
  input: Readable,
  output: Writable,
  options: ServerOptions = {},
) {
  const connection = createConnection(input, output);
  let config = DEFAULT_CONFIG;

  const refresh = (document: TextDocument): void => {
    const target = limaText(document);
    const diagnostics = target
      ? check(target.text, config).map((finding) =>
          toDiagnostic(finding, document, target.lineOffset),
        )
      : [];
    void connection.sendDiagnostics({ uri: document.uri, diagnostics });
  };

  const documents = new DocumentStore(
    refresh,
    (uri) => void connection.sendDiagnostics({ uri, diagnostics: [] }),
    options.debounceMs ?? DEBOUNCE_MS,
  );

  connection.onInitialize(
    (params): InitializeResult => {
      if (params.initializationOptions !== undefined) {
        config = readConfig(params.initializationOptions);
      }
      return {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Incremental,
        },
        serverInfo: {
          name: "lima-language-server",
          version: "0.1.0",
        },
      };
    },
  );

  connection.onDidChangeConfiguration(({ settings }) => {
    const next = readConfig(settings, config);
    if (
      next.strict !== config.strict ||
      next.ignoreUnresolvedReferences !== config.ignoreUnresolvedReferences
    ) {
      config = next;
      documents.refreshAll();
    }
  });

  connection.onShutdown(() => {
    documents.dispose();
  });
  connection.onExit(() => documents.dispose());

  documents.listen(connection);
  connection.listen();

  return {
    connection,
    documents,
    dispose(): void {
      documents.dispose();
      connection.dispose();
    },
  };
}

function limaText(
  document: TextDocument,
): { text: string; lineOffset: number } | null {
  if (document.languageId === "lima") {
    return { text: document.getText(), lineOffset: 0 };
  }
  if (MARKDOWN_LANGS.has(document.languageId)) {
    const frontmatter = extractFrontmatter(document.getText());
    return frontmatter
      ? { text: frontmatter.text, lineOffset: frontmatter.startLine }
      : null;
  }
  return null;
}

function toDiagnostic(
  finding: LimaFinding,
  document: TextDocument,
  lineOffset: number,
): Diagnostic {
  return {
    range: findingRange(finding, lineOffset, (line) =>
      lspLineLength(document, line),
    ),
    severity:
      finding.severity === "error"
        ? DiagnosticSeverity.Error
        : DiagnosticSeverity.Warning,
    source: "lima",
    code: finding.code,
    message: finding.message,
  };
}

function lspLineLength(document: TextDocument, line: number): number {
  if (line < 0 || line >= document.lineCount) return 0;
  const start = { line, character: 0 };
  const endOffset =
    line + 1 < document.lineCount
      ? document.offsetAt({ line: line + 1, character: 0 })
      : document.getText().length;
  const text = document.getText({
    start,
    end: document.positionAt(endOffset),
  });
  return text.replace(/\r?\n$/, "").length;
}

function readConfig(
  settings: unknown,
  base: Required<CheckOptions> = DEFAULT_CONFIG,
): Required<CheckOptions> {
  const diagnostics = nestedDiagnostics(settings);
  return {
    strict:
      typeof diagnostics?.strict === "boolean"
        ? diagnostics.strict
        : base.strict,
    ignoreUnresolvedReferences:
      typeof diagnostics?.ignoreUnresolvedReferences === "boolean"
        ? diagnostics.ignoreUnresolvedReferences
        : base.ignoreUnresolvedReferences,
  };
}

function nestedDiagnostics(
  settings: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(settings) || !isRecord(settings.lima)) return undefined;
  const diagnostics = settings.lima.diagnostics;
  return isRecord(diagnostics) ? diagnostics : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (args.length > 0 && !args.every((argument) => argument === "--stdio")) {
    process.stderr.write(
      `lima-language-server: only --stdio is supported; got: ${args.join(" ")}\n`,
    );
    process.exit(1);
  }
  createLimaLanguageServer(process.stdin, process.stdout);
}
