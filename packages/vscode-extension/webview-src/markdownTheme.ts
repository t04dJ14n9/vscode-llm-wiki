import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const editorForeground = 'var(--vscode-editor-foreground)';
const descriptionForeground = 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))';
const linkForeground = 'var(--vscode-textLink-foreground, var(--vscode-editor-foreground))';
const preformattedForeground = 'var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground))';

export const humanLearningHighlightStyle = HighlightStyle.define([
  { tag: [tags.meta, tags.punctuation, tags.comment], color: descriptionForeground },
  { tag: tags.link, color: linkForeground, textDecoration: 'underline' },
  { tag: tags.url, color: descriptionForeground },
  { tag: tags.heading, color: editorForeground, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: preformattedForeground },
  {
    tag: tags.keyword,
    color: 'var(--vscode-symbolIcon-keywordForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: [tags.atom, tags.bool],
    color: 'var(--vscode-symbolIcon-booleanForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: [tags.literal, tags.string, tags.regexp, tags.escape],
    color: 'var(--vscode-symbolIcon-stringForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: [tags.number, tags.integer, tags.float],
    color: 'var(--vscode-symbolIcon-numberForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: tags.variableName,
    color: 'var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: tags.function(tags.variableName),
    color: 'var(--vscode-symbolIcon-functionForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: [tags.typeName, tags.className],
    color: 'var(--vscode-symbolIcon-classForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: tags.namespace,
    color: 'var(--vscode-symbolIcon-namespaceForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: tags.propertyName,
    color: 'var(--vscode-symbolIcon-propertyForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: tags.operator,
    color: 'var(--vscode-symbolIcon-operatorForeground, var(--vscode-editor-foreground))',
  },
  {
    tag: [tags.invalid, tags.deleted],
    color: 'var(--vscode-errorForeground, var(--vscode-editor-foreground))',
  },
]);
