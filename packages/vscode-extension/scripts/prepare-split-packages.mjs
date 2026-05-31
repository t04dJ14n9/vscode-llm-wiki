import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = resolve(extensionRoot, '..');
const outputRoot = join(extensionRoot, 'dist-split');

const variants = [
  {
    name: 'markdown',
    packageRoot: join(packagesRoot, 'vscode-markdown-extension'),
  },
  {
    name: 'pdf',
    packageRoot: join(packagesRoot, 'vscode-pdf-extension'),
  },
];

rmSync(outputRoot, { recursive: true, force: true });

for (const variant of variants) {
  const packageRoot = join(outputRoot, variant.name);
  const packageDist = join(packageRoot, 'dist');
  const sourceDist = join(variant.packageRoot, 'dist');
  mkdirSync(packageDist, { recursive: true });

  copyRequired(join(variant.packageRoot, 'package.json'), join(packageRoot, 'package.json'));
  copyDist(sourceDist, packageDist);
}

for (const variant of variants) {
  const files = readdirSync(join(outputRoot, variant.name, 'dist')).sort();
  process.stdout.write(`${variant.name}: ${files.join(', ')}\n`);
}

function copyRequired(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`Missing required split-package input: ${source}`);
  }
  copyFileSync(source, destination);
}

function copyDist(sourceDir, destinationDir) {
  if (!existsSync(sourceDir)) {
    throw new Error(`Missing required split-package dist: ${sourceDir}`);
  }
  for (const file of readdirSync(sourceDir)) {
    const source = join(sourceDir, file);
    const destination = join(destinationDir, file);
    if (statSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
      copyDist(source, destination);
      continue;
    }
    copyFileSync(source, destination);
  }
}
