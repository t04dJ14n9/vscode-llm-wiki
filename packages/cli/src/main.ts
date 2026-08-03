#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { statusCommand } from './commands/status';
import { doctorCommand } from './commands/doctor';
import { ingestCommand } from './commands/ingest';
import { searchCommand } from './commands/search';
import { linksCommand } from './commands/links';
import { embeddingsCommand } from './commands/embeddings';
import { anchorCommand } from './commands/anchor';
import { contextCommand } from './commands/context';
import { skillsCommand } from './commands/skills';
import { hooksCommand } from './commands/hooks';
import { todayCommand } from './commands/today';
import { webCommand } from './commands/web';
import { mcpCommand } from './commands/mcp';
import { reviewCommand } from './commands/review';

const program = new Command();

program
  .name('hl')
  .description('Human Learning — CLI for headless vault operations')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(statusCommand());
program.addCommand(doctorCommand());
program.addCommand(ingestCommand());
program.addCommand(searchCommand());
program.addCommand(linksCommand());
program.addCommand(embeddingsCommand());
program.addCommand(anchorCommand());
program.addCommand(contextCommand());
program.addCommand(skillsCommand());
program.addCommand(hooksCommand());
program.addCommand(todayCommand());
program.addCommand(webCommand());
program.addCommand(mcpCommand());
program.addCommand(reviewCommand());

program.parse(process.argv);
