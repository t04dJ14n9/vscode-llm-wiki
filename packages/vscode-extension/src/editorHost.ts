import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  AgentHandoffCapability,
  AgentSurfaceCapabilities,
  ExternalAgentId,
} from './agentHandoff';
import { isQueryPagePath } from './queryAnnotationIndex';

export interface AgentHandoffCapabilitiesMessage {
  type: 'agentHandoffCapabilities';
  cursorAgent: boolean;
  providers: AgentHandoffCapability[];
}

export function agentHandoffCapabilitiesMessage(
  capabilities: AgentSurfaceCapabilities,
): AgentHandoffCapabilitiesMessage {
  const seen = new Set<ExternalAgentId>();
  const providers = Array.isArray(capabilities?.providers)
    ? capabilities.providers.flatMap(provider => {
        if (
          !isExternalAgentId(provider?.id)
          || typeof provider.label !== 'string'
          || !provider.label.trim()
          || seen.has(provider.id)
        ) return [];
        seen.add(provider.id);
        return [{ id: provider.id, label: provider.label.trim() }];
      })
    : [];
  return {
    type: 'agentHandoffCapabilities',
    cursorAgent: capabilities?.cursorAgent === true,
    providers,
  };
}

export function messageRecord(message: unknown): Record<string, unknown> | undefined {
  return message && typeof message === 'object' && !Array.isArray(message)
    ? message as Record<string, unknown>
    : undefined;
}

export function queryNavigationPath(value: unknown): string | undefined {
  const target = messageRecord(value);
  const queryPath = target?.queryPath;
  if (
    target?.kind !== 'query'
    || typeof queryPath !== 'string'
    || path.isAbsolute(queryPath)
    || queryPath.includes('\\')
    || queryPath.split('/').includes('..')
    || !queryPath.toLowerCase().endsWith('.md')
    || !isQueryPagePath(queryPath)
  ) return undefined;
  return queryPath;
}

export async function lookupSelectionInDictionary(rawText: unknown): Promise<void> {
  const text = normalizeLookupText(rawText);
  if (!text) return;
  const opened = await vscode.env.openExternal(
    vscode.Uri.parse(`dict://${encodeURIComponent(text)}`),
  );
  if (opened) {
    vscode.window.showInformationMessage(`Looking up "${text}" in Dictionary`);
    return;
  }
  await vscode.env.clipboard.writeText(text);
  vscode.window.showWarningMessage(
    'Dictionary lookup was not available. Selected text copied to clipboard.',
  );
}

function normalizeLookupText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 200) : undefined;
}

function isExternalAgentId(value: unknown): value is ExternalAgentId {
  return value === 'codex' || value === 'claude' || value === 'codebuddy';
}
