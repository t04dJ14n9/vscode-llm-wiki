import * as vscode from 'vscode';

export class MarkdownDocumentBridge {
  private applying = false;
  private pendingText: string | undefined;
  private latestText: string;
  private expectedText: string | undefined;
  private acknowledgedText: string | undefined;
  private queuedEdits: Promise<void> | undefined;
  private unappliedText: string | undefined;

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly reportEditFailure: (error: unknown) => void,
  ) {
    this.latestText = document.getText();
  }

  get webviewText(): string {
    return this.latestText;
  }

  rememberHostText(text: string): void {
    this.latestText = text;
  }

  queueWebviewText(text: string): void {
    this.latestText = text;
    this.pendingText = text;
    void this.queueEdits().catch(this.reportEditFailure);
  }

  hostDocumentChanged(): boolean {
    const currentText = this.document.getText();
    if (currentText === this.expectedText) {
      this.acknowledgedText = currentText;
      this.expectedText = undefined;
      return false;
    }
    if (currentText === this.acknowledgedText) return false;
    this.expectedText = undefined;
    this.acknowledgedText = undefined;
    return true;
  }

  async flushBeforeSave(): Promise<boolean> {
    const attempt = async (): Promise<boolean> => {
      try {
        await this.flushQueuedEdits();
      } catch {
        return false;
      }
      return this.unappliedText === undefined;
    };

    if (await attempt()) return true;
    if (this.unappliedText !== undefined) {
      this.pendingText = this.unappliedText;
      if (await attempt()) return true;
    }
    vscode.window.showErrorMessage(
      'Markdown note not saved because the latest edit could not be applied.',
    );
    return false;
  }

  private queueEdits(): Promise<void> {
    this.queuedEdits ??= this.applyQueuedEdits().finally(() => {
      this.queuedEdits = undefined;
      if (this.pendingText !== undefined) {
        void this.queueEdits().catch(this.reportEditFailure);
      }
    });
    return this.queuedEdits;
  }

  private async flushQueuedEdits(): Promise<void> {
    while (this.queuedEdits || this.pendingText !== undefined) {
      await (this.queuedEdits ?? this.queueEdits());
    }
  }

  private async applyQueuedEdits(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.pendingText !== undefined) {
        const nextText = this.pendingText;
        this.pendingText = undefined;
        this.latestText = nextText;
        if (nextText === this.document.getText()) continue;
        this.expectedText = nextText;
        try {
          await replaceDocument(this.document, nextText);
        } catch (error) {
          this.expectedText = undefined;
          this.unappliedText = nextText;
          throw error;
        }
        this.unappliedText = undefined;
      }
    } finally {
      this.applying = false;
    }
  }
}

async function replaceDocument(document: vscode.TextDocument, text: string): Promise<void> {
  const current = document.getText();
  if (current === text) return;
  const replacement = minimalDocumentReplacement(current, text);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(replacement.from),
      document.positionAt(replacement.currentTo),
    ),
    text.slice(replacement.from, replacement.nextTo),
  );
  if (!await vscode.workspace.applyEdit(edit)) {
    throw new Error('VS Code rejected the markdown edit');
  }
}

function minimalDocumentReplacement(
  current: string,
  next: string,
): { from: number; currentTo: number; nextTo: number } {
  let from = 0;
  const sharedLength = Math.min(current.length, next.length);
  while (from < sharedLength && current[from] === next[from]) from++;

  let currentTo = current.length;
  let nextTo = next.length;
  while (
    currentTo > from
    && nextTo > from
    && current[currentTo - 1] === next[nextTo - 1]
  ) {
    currentTo--;
    nextTo--;
  }
  return { from, currentTo, nextTo };
}
