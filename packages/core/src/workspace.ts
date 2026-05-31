import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

export const HlConfigSchema = z.object({
  version: z.number().default(1),
  name: z.string().optional(),
  embeddings: z.object({
    mode: z.enum(['disabled', 'remote', 'local']).default('disabled'),
    provider: z.enum(['openai-compatible', 'ollama', 'sentence-transformers', 'custom']).optional(),
    model: z.string().optional(),
    endpoint: z.string().optional(),
  }).default({}),
  security: z.object({
    activity_tracking: z.boolean().default(false),
    agent_mutations: z.boolean().default(false),
    remote_embeddings: z.boolean().default(false),
  }).default({}),
});

export type HlConfig = z.infer<typeof HlConfigSchema>;

export const DEFAULT_VAULT_LAYOUT = {
  directories: [
    'raw/pdf', 'raw/web', 'raw/code', 'raw/images', 'raw/text',
    'notes/Concepts', 'notes/Papers', 'notes/Projects',
    'notes/Daily Notes', 'notes/Literature Notes', 'notes/assets/ink',
    '.hl/agent', '.hl/anchors', '.hl/annotations/pdf',
    '.hl/references/pdf', '.hl/references/html', '.hl/references/code',
    '.hl/embeddings', '.hl/cache', '.hl/logs', '.hl/reports',
    '.hl/mobile-inbox',
    '.agents/skills/human-learning',
    '.claude/commands',
  ],
  files: {
    '.hl/config.yaml': '# Human Learning vault configuration\nversion: 1\n',
  },
};

export function detectVaultRoot(startPath: string): string | null {
  let current = resolve(startPath);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, '.hl'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function isVaultRoot(dir: string): boolean {
  return existsSync(join(dir, '.hl'));
}

export function initVault(rootPath: string, name?: string): { path: string; created: string[] } {
  const created: string[] = [];

  for (const dir of DEFAULT_VAULT_LAYOUT.directories) {
    const full = join(rootPath, dir);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
      created.push(dir + '/');
    }
  }

  for (const [filePath, content] of Object.entries(DEFAULT_VAULT_LAYOUT.files)) {
    const full = join(rootPath, filePath);
    if (!existsSync(full)) {
      const fileContent = filePath === '.hl/config.yaml' && name
        ? '# Human Learning vault configuration\n' + stringifyYaml({ version: 1, name })
        : content;
      writeFileSync(full, fileContent);
      created.push(filePath);
    }
  }

  return { path: rootPath, created };
}

export function readConfig(vaultPath: string): HlConfig {
  const configPath = join(vaultPath, '.hl', 'config.yaml');
  if (!existsSync(configPath)) {
    return HlConfigSchema.parse({});
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  return HlConfigSchema.parse(parsed ?? {});
}

export function writeConfig(vaultPath: string, config: HlConfig): void {
  const configPath = join(vaultPath, '.hl', 'config.yaml');
  const validated = HlConfigSchema.parse(config);
  writeFileSync(configPath, stringifyYaml(validated));
}
