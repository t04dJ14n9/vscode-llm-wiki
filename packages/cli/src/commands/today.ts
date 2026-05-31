import { Command } from 'commander';
import {
  detectVaultRoot, openDatabase, closeDatabase, runMigrations,
} from '@human-learning/core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export function todayCommand(): Command {
  return new Command('today')
    .description('Generate a daily study summary')
    .option('--date <YYYY-MM-DD>', 'Date to summarize (default: today)')
    .option('--write', 'Write summary to .hl/agent/today.md')
    .option('--json', 'Output JSON')
    .action(async (options: { date?: string; write?: boolean; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const targetDate = options.date || new Date().toISOString().split('T')[0]!;
      const db = await openDatabase(vaultRoot);
      runMigrations(db);

      // Count activity for the target date
      const activityCount = (db.prepare(`
        SELECT COUNT(*) as c FROM activity WHERE date(timestamp) = ?
      `).get(targetDate) as { c: number })?.c ?? 0;

      // Recent sources
      const recentSources = db.prepare(`
        SELECT path, kind, title, added_at FROM sources
        WHERE date(added_at) = ?
        ORDER BY added_at DESC LIMIT 20
      `).all(targetDate) as Array<{ path: string; kind: string; title: string; added_at: string }>;

      // Recent anchors
      const recentAnchors = db.prepare(`
        SELECT id, uri, kind, created_at FROM anchors
        WHERE date(created_at) = ?
        ORDER BY created_at DESC LIMIT 20
      `).all(targetDate) as Array<{ id: string; uri: string; kind: string; created_at: string }>;

      // Link stats
      const totalLinks = (db.prepare(
        'SELECT COUNT(*) as c FROM links'
      ).get() as { c: number })?.c ?? 0;
      const brokenLinks = (db.prepare(
        "SELECT COUNT(*) as c FROM links WHERE status != 'resolved'"
      ).get() as { c: number })?.c ?? 0;

      // Note count
      const noteCount = (db.prepare(
        "SELECT COUNT(*) as c FROM sources WHERE kind = 'markdown'"
      ).get() as { c: number })?.c ?? 0;

      // Source count
      const sourceCount = (db.prepare(
        'SELECT COUNT(*) as c FROM sources'
      ).get() as { c: number })?.c ?? 0;

      closeDatabase(db);

      const summary = {
        date: targetDate,
        vault: vaultRoot,
        counts: {
          sources: sourceCount,
          notes: noteCount,
          links: totalLinks,
          broken_links: brokenLinks,
          activity_events: activityCount,
        },
        recent_ingested: recentSources.length,
        recent_anchors: recentAnchors.length,
      };

      if (options.write) {
        const agentDir = join(vaultRoot, '.hl', 'agent');
        if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

        const mdContent = `# Daily Summary — ${targetDate}

## Vault Stats
- **Sources**: ${sourceCount} total
- **Notes**: ${noteCount}
- **Links**: ${totalLinks} (${brokenLinks} broken)
- **Activity**: ${activityCount} events

## Recently Ingested
${recentSources.length === 0 ? '- None' : recentSources.map(s => `- \`${s.path}\` (${s.kind})`).join('\n')}

## Recent Anchors
${recentAnchors.length === 0 ? '- None' : recentAnchors.map(a => `- \`${a.uri}\``).join('\n')}

## Link Health
- Broken links: ${brokenLinks}
- Run \`hl links check --fix\` to repair.
`;

        writeFileSync(join(agentDir, 'today.md'), mdContent);
      }

      console.log(JSON.stringify(summary, null, options.json ? 0 : 2));
    });
}
