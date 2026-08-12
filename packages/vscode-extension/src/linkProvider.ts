import * as vscode from 'vscode';
import { wikiLinkTargetToUri } from './wikiLinks';

export function registerLinkProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentLinkProvider = {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
      const links: vscode.DocumentLink[] = [];
      const text = document.getText();

      // Match native markdown links.
      const markdownLinkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = markdownLinkRegex.exec(text)) !== null) {
        const uri = normalizeMarkdownDestination(match[2]!);
        if (!uri) continue;
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);

        const link = new vscode.DocumentLink(
          new vscode.Range(startPos, endPos),
          vscode.Uri.parse(`command:llm-wiki.openAnchor?${encodeURIComponent(JSON.stringify([uri]))}`)
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
          vscode.Uri.parse(`command:llm-wiki.openAnchor?${encodeURIComponent(JSON.stringify([uri]))}`)
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

function normalizeMarkdownDestination(raw: string): string | undefined {
  const destination = raw.trim();
  if (!destination) return undefined;
  if (destination.startsWith('<')) {
    const end = destination.indexOf('>');
    return end > 1 ? destination.slice(1, end) : undefined;
  }
  const match = destination.match(/^(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  return match?.[1];
}
