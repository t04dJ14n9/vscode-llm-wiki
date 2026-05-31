import * as vscode from 'vscode';
import { wikiLinkTargetToUri } from './wikiLinks';

export function registerLinkProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentLinkProvider = {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
      const links: vscode.DocumentLink[] = [];
      const text = document.getText();

      // Match [label](hl://...)
      const hlLinkRegex = /\[([^\]]*)\]\((hl:\/\/[^)]+)\)/g;
      let match;
      while ((match = hlLinkRegex.exec(text)) !== null) {
        const uri = match[2]!;
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);

        const link = new vscode.DocumentLink(
          new vscode.Range(startPos, endPos),
          vscode.Uri.parse(`command:human-learning.openAnchor?${encodeURIComponent(JSON.stringify([uri]))}`)
        );
        link.tooltip = `Open: ${uri}`;
        links.push(link);
      }

      // Match [[wikilinks]]
      const wikiRegex = /\[\[([^\]]+)\]\]/g;
      while ((match = wikiRegex.exec(text)) !== null) {
        if (match.index > 0 && text[match.index - 1] === '!') continue;
        const target = match[1]!.trim();
        const uri = wikiLinkTargetToUri(target, vscode.workspace.asRelativePath(document.uri, false));
        if (!uri) continue;
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);

        const link = new vscode.DocumentLink(
          new vscode.Range(startPos, endPos),
          vscode.Uri.parse(`command:human-learning.openAnchor?${encodeURIComponent(JSON.stringify([uri]))}`)
        );
        link.tooltip = `Open: ${target}`;
        links.push(link);
      }

      return links;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { scheme: 'file', language: 'markdown' },
      provider,
    ),
  );
}
