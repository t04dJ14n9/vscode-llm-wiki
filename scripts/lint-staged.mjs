import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

const lintableExtensions = new Set(['.cjs', '.js', '.mjs', '.ts']);
const stagedOutput = execFileSync(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
  { encoding: 'utf8' },
);
const stagedFiles = stagedOutput
  .split('\0')
  .filter(Boolean)
  .filter((file) => lintableExtensions.has(extname(file)));

if (stagedFiles.length === 0) {
  process.exit(0);
}

const eslint = new ESLint({
  errorOnUnmatchedPattern: false,
  warnIgnored: false,
});
const results = await eslint.lintFiles(stagedFiles);
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);

if (output) {
  process.stdout.write(output);
}

const problemCount = results.reduce(
  (count, result) => count + result.errorCount + result.warningCount,
  0,
);

if (problemCount > 0) {
  process.exitCode = 1;
}
