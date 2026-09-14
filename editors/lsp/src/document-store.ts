import type { Connection } from "vscode-languageserver/node.js";
import { TextDocuments } from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DEBOUNCE_MS } from "../../shared/constants.js";
import { KeyedDebouncer } from "../../shared/debounce.js";

/** Tracks open documents and debounces each URI independently. */
export class DocumentStore {
  readonly documents = new TextDocuments(TextDocument);
  private readonly debouncer: KeyedDebouncer<string>;

  constructor(
    private readonly refresh: (document: TextDocument) => void,
    private readonly close: (uri: string) => void,
    debounceMs = DEBOUNCE_MS,
  ) {
    this.debouncer = new KeyedDebouncer(debounceMs);
  }

  listen(connection: Connection): void {
    this.documents.onDidOpen(({ document }) => this.refreshNow(document));
    this.documents.onDidChangeContent(({ document }) => this.schedule(document));
    this.documents.onDidClose(({ document }) => {
      this.debouncer.cancel(document.uri);
      this.close(document.uri);
    });
    this.documents.listen(connection);
  }

  refreshAll(): void {
    for (const document of this.documents.all()) this.refreshNow(document);
  }

  dispose(): void {
    this.debouncer.disposeAll();
  }

  private schedule(document: TextDocument): void {
    this.debouncer.schedule(
      document.uri,
      () => this.refresh(document),
    );
  }

  private refreshNow(document: TextDocument): void {
    this.debouncer.cancel(document.uri);
    this.refresh(document);
  }
}
