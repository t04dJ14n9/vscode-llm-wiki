import { Command } from 'commander';
import {
  detectVaultRoot,
  openDatabase,
  closeDatabase,
  runMigrations,
  createLearningObject,
  listLearningObjects,
  getDueCards,
  recordReview,
  getReviewHistory,
  suspendLearningObject,
} from '@human-learning/core';

export function reviewCommand(): Command {
  const cmd = new Command('review').description('Spaced repetition review queue');

  cmd.command('add')
    .description('Create a new learning card')
    .requiredOption('--kind <kind>', 'Card kind (concept_card, cloze_card, etc.)')
    .requiredOption('--title <title>', 'Card title')
    .requiredOption('--prompt <prompt>', 'Review prompt')
    .option('--answer <answer>', 'Ideal answer')
    .option('--anchor <id>', 'Anchor ID to attach')
    .option('--tag <tag>', 'Tag (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
    .option('--json', 'Output JSON')
    .action(async (options: {
      kind: string; title: string; prompt: string;
      answer?: string; anchor?: string; tag: string[]; json?: boolean;
    }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const card = createLearningObject(db, {
        kind: options.kind,
        title: options.title,
        prompt: options.prompt,
        ideal_answer: options.answer,
        anchor_ids: options.anchor ? [options.anchor] : [],
        tags: options.tag,
      });
      closeDatabase(db);
      console.log(JSON.stringify({ status: 'ok', card }, null, options.json ? 0 : 2));
    });

  cmd.command('list')
    .description('List learning cards')
    .option('--status <status>', 'Filter by status (active, suspended, retired, draft)')
    .option('--json', 'Output JSON')
    .action(async (options: { status?: string; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const cards = listLearningObjects(db, { status: options.status });
      closeDatabase(db);
      console.log(JSON.stringify({ status: 'ok', count: cards.length, cards }, null, options.json ? 0 : 2));
    });

  cmd.command('due')
    .description('List cards due for review')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const cards = getDueCards(db);
      closeDatabase(db);
      console.log(JSON.stringify({ status: 'ok', count: cards.length, cards }, null, options.json ? 0 : 2));
    });

  cmd.command('record')
    .description('Record a review result')
    .argument('<id>', 'Learning object ID')
    .argument('<confidence>', 'Confidence score 0.0–1.0')
    .option('--latency <ms>', 'Response latency in milliseconds')
    .option('--json', 'Output JSON')
    .action(async (id: string, confidenceStr: string, options: { latency?: string; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      const confidence = parseFloat(confidenceStr);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        console.log(JSON.stringify({ status: 'error', message: 'confidence must be 0.0–1.0' }));
        process.exit(1);
      }
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const review = recordReview(db, {
        learning_object_id: id,
        confidence,
        latency_ms: options.latency ? parseInt(options.latency, 10) : undefined,
      });
      closeDatabase(db);
      console.log(JSON.stringify({ status: 'ok', review }, null, options.json ? 0 : 2));
    });

  cmd.command('history')
    .description('Show review history for a card')
    .argument('<id>', 'Learning object ID')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const history = getReviewHistory(db, id);
      closeDatabase(db);
      console.log(JSON.stringify({ status: 'ok', count: history.length, history }, null, options.json ? 0 : 2));
    });

  cmd.command('suspend')
    .description('Suspend a learning card')
    .argument('<id>', 'Learning object ID')
    .option('--json', 'Output JSON')
    .action(async (id: string, _options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      suspendLearningObject(db, id);
      closeDatabase(db);
      console.log(JSON.stringify({ status: 'ok', id }));
    });

  return cmd;
}
