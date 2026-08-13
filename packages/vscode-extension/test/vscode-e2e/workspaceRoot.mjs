import { resolve } from 'path';

const WORKSPACE_ENV = 'LLM_WIKI_E2E_VAULT';

export function resolveVsCodeE2eWorkspace({
  env = process.env,
  defaultWorkspace,
  cwd = process.cwd(),
}) {
  const configured = env[WORKSPACE_ENV]?.trim();
  return configured ? resolve(cwd, configured) : resolve(defaultWorkspace);
}

export function isCustomVsCodeE2eWorkspace({ env = process.env } = {}) {
  return Boolean(env[WORKSPACE_ENV]?.trim());
}
