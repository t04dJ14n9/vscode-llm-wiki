import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  closeDatabase,
  detectVaultRoot,
  openDatabase,
  persistWebPageSnapshot,
  runMigrations,
} from '@human-learning/core';

interface PersistOptions {
  title?: string;
  selectedText?: string;
  textFragment?: string;
  selector?: string;
  xpath?: string;
  htmlFile?: string;
  json?: boolean;
}

export function webCommand(): Command {
  const cmd = new Command('web')
    .description('Persist and inspect web sources');

  cmd.command('persist')
    .description('Persist a web page snapshot and emit a durable markdown link')
    .argument('<url>', 'HTTP(S) URL to persist')
    .option('--title <title>', 'Page title')
    .option('--selected-text <text>', 'Selected text to anchor')
    .option('--text-fragment <url>', 'Browser text-fragment URL for the selected text')
    .option('--selector <selector>', 'CSS selector for the selected element')
    .option('--xpath <xpath>', 'XPath for the selected element')
    .option('--html-file <path>', 'Read HTML from a local file instead of fetching the URL')
    .option('--json', 'Output JSON')
    .action(async (url: string, options: PersistOptions) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const html = await loadHtml(url, options.htmlFile);
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const result = persistWebPageSnapshot(db, vaultRoot, {
        url,
        title: options.title,
        html,
        selectedText: options.selectedText,
        textFragment: options.textFragment,
        cssSelector: options.selector,
        xpath: options.xpath,
      });
      closeDatabase(db);

      console.log(JSON.stringify({
        status: result.status,
        persisted_path: result.persistedPath,
        source: result.source,
        target: result.target,
        anchor: result.anchor,
        href: result.href,
        markdown: result.markdownLink,
        quote_markdown: result.quoteMarkdown,
      }, null, options.json ? 0 : 2));
    });

  return cmd;
}

async function loadHtml(url: string, htmlFile: string | undefined): Promise<string> {
  if (htmlFile) {
    return readFileSync(resolve(htmlFile), 'utf8');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}
