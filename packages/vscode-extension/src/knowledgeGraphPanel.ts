import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type {
  ConceptGraph,
  ConceptGraphEdge,
  ConceptGraphNode,
} from './filesystemWiki';

export class KnowledgeGraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  show(graph: ConceptGraph): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'llm-wiki.knowledgeGraph',
        'LLM Wiki Graph',
        vscode.ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.webview.html = renderKnowledgeGraphHtml(graph);
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

/**
 * Render a static graph document. It deliberately contains no script or runtime
 * dependency, so it remains useful in a locked-down VS Code webview.
 */
export function renderKnowledgeGraphHtml(
  graph: ConceptGraph,
  nonce = randomBytes(16).toString('base64'),
): string {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...graph.edges]
    .filter(edge => nodes.some(node => node.id === edge.source)
      && nodes.some(node => node.id === edge.target))
    .sort((a, b) => a.id.localeCompare(b.id));
  const positions = layout(nodes);
  const width = 960;
  const height = Math.max(520, Math.ceil(nodes.length / 12) * 220);
  const noteCount = nodes.filter(node => node.kind === 'note').length;
  const conceptCount = nodes.filter(node => node.kind === 'concept').length;
  const entityCount = nodes.filter(node => node.kind === 'entity').length;

  const edgeSvg = edges.map(edge =>
    renderEdge(edge, positions, nodes)
  ).join('');
  const nodeSvg = nodes.map(node =>
    renderNode(node, positions.get(node.id)!)
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeHtml(nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Wiki Graph</title>
  <style nonce="${escapeHtml(nonce)}">
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: 13px var(--vscode-font-family, sans-serif); }
    header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
    h1 { margin: 0; font-size: 18px; } .meta { color: var(--vscode-descriptionForeground); }
    .explanation { margin: 0 0 10px; color: var(--vscode-descriptionForeground); }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 12px; color: var(--vscode-descriptionForeground); }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { box-sizing: border-box; width: 22px; height: 13px; border: 2px solid; background: transparent; }
    .swatch.note { border-color: var(--vscode-focusBorder); border-radius: 3px; background: var(--vscode-button-secondaryBackground); }
    .swatch.concept { border-color: var(--vscode-charts-blue, #3794ff); border-radius: 50%; }
    .swatch.entity { border-color: var(--vscode-charts-orange, #cca700); border-radius: 8px; border-style: dashed; }
    .canvas { overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); }
    svg { display: block; width: 100%; min-width: 680px; height: auto; }
    .edge { stroke: var(--vscode-descriptionForeground); stroke-opacity: .48; stroke-width: 1.4; }
    .edge.concept { stroke: var(--vscode-charts-blue, #3794ff); stroke-dasharray: 5 3; }
    .edge.entity { stroke: var(--vscode-charts-orange, #cca700); stroke-dasharray: 2 3; }
    .edge-count { fill: var(--vscode-descriptionForeground); font-size: 11px; paint-order: stroke; stroke: var(--vscode-editorWidget-background); stroke-width: 4px; }
    .node { fill: var(--vscode-editorWidget-background); stroke-width: 1.8; }
    .node.note { fill: var(--vscode-button-secondaryBackground); stroke: var(--vscode-focusBorder); }
    .node.concept { stroke: var(--vscode-charts-blue, #3794ff); }
    .node.entity { stroke: var(--vscode-charts-orange, #cca700); stroke-dasharray: 4 2; }
    .node-label { fill: var(--vscode-editor-foreground); font-size: 12px; font-weight: 600; text-anchor: middle; }
    details { margin-top: 14px; } summary { cursor: pointer; font-weight: 600; }
    ul { line-height: 1.55; } code { color: var(--vscode-textLink-foreground); }
    .empty { fill: var(--vscode-descriptionForeground); text-anchor: middle; font-size: 15px; }
  </style>
</head>
<body>
  <header><h1>Markdown knowledge graph</h1><span class="meta">${noteCount} notes · ${conceptCount} concepts · ${entityCount} entities · ${edges.length} relationships</span></header>
  <p class="explanation">Built locally from Markdown links and the <code>concepts</code> / <code>entities</code> frontmatter lists. It does not infer missing relationships.</p>
  <div class="legend" aria-label="Graph legend">
    <span class="legend-item"><span class="swatch note"></span>Note</span>
    <span class="legend-item"><span class="swatch concept"></span>Concept from frontmatter</span>
    <span class="legend-item"><span class="swatch entity"></span>Entity from frontmatter</span>
  </div>
  <div class="canvas">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="graph-title graph-description">
      <title id="graph-title">Markdown knowledge graph</title>
      <desc id="graph-description">${noteCount} notes, ${conceptCount} concepts, and ${entityCount} entities with ${edges.length} explicit relationships. A text list follows the graph.</desc>
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
      ${nodes.length === 0 ? '<text class="empty" x="480" y="260">No Markdown notes or frontmatter metadata yet</text>' : `${edgeSvg}${nodeSvg}`}
    </svg>
  </div>
  ${renderAccessibleList(nodes, edges)}
</body>
</html>`;
}

type Point = { x: number; y: number };

function layout(nodes: readonly ConceptGraphNode[]): Map<string, Point> {
  const points = new Map<string, Point>();
  const center = { x: 480, y: Math.max(260, Math.ceil(nodes.length / 12) * 110) };
  const radius = Math.min(390, Math.max(120, 35 * Math.sqrt(nodes.length)));
  nodes.forEach((node, index) => {
    const angle = nodes.length === 1 ? 0 : (2 * Math.PI * index / nodes.length) - Math.PI / 2;
    const distance = nodes.length === 1 ? 0 : radius;
    points.set(node.id, {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance,
    });
  });
  return points;
}

function renderEdge(
  edge: ConceptGraphEdge,
  positions: ReadonlyMap<string, Point>,
  nodes: readonly ConceptGraphNode[],
): string {
  const start = positions.get(edge.source)!;
  const end = positions.get(edge.target)!;
  const source = nodes.find(node => node.id === edge.source)?.label ?? edge.source;
  const target = nodes.find(node => node.id === edge.target)?.label ?? edge.target;
  const count = Math.max(1, edge.count);
  const relationship = edgeRelationship(edge, source, target, count);
  const edgeClass = edge.kind ? `edge ${edge.kind}` : 'edge';
  return `<g><title>${escapeHtml(relationship)}</title><line class="${edgeClass}" x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" marker-end="url(#arrow)"/><text class="edge-count" x="${((start.x + end.x) / 2).toFixed(1)}" y="${((start.y + end.y) / 2 - 5).toFixed(1)}">×${count}</text></g>`;
}

function renderNode(node: ConceptGraphNode, point: Point): string {
  const title = node.kind === 'note'
    ? `Note: ${node.label} — ${node.path ?? node.id}`
    : `${capitalize(node.kind)}: ${node.label}`;
  const shape = node.kind === 'concept'
    ? `<ellipse class="node concept" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" rx="72" ry="22"/>`
    : `<rect class="node ${node.kind}" x="${(point.x - 72).toFixed(1)}" y="${(point.y - 22).toFixed(1)}" width="144" height="44" rx="${node.kind === 'entity' ? 22 : 9}"/>`;
  return `<g><title>${escapeHtml(title)}</title>${shape}<text class="node-label" x="${point.x.toFixed(1)}" y="${(point.y + 4).toFixed(1)}">${escapeHtml(shortLabel(node.label))}</text></g>`;
}

function renderAccessibleList(
  nodes: readonly ConceptGraphNode[],
  edges: readonly ConceptGraphEdge[],
): string {
  const labels = new Map(nodes.map(node => [node.id, node.label]));
  const nodeItems = nodes.map(node => {
    const path = node.kind === 'note' ? ` <code>${escapeHtml(node.path ?? node.id)}</code>` : '';
    return `<li>${escapeHtml(capitalize(node.kind))}: ${escapeHtml(node.label)}${path}</li>`;
  }).join('');
  const edgeItems = edges.map(edge => {
    const count = Math.max(1, edge.count);
    const source = labels.get(edge.source) ?? edge.source;
    const target = labels.get(edge.target) ?? edge.target;
    const relationship = edge.kind
      ? edgeRelationship(edge, source, target, count)
      : `${source} → ${target} (${count} ${count === 1 ? 'reference' : 'references'})`;
    return `<li>${escapeHtml(relationship)}</li>`;
  }).join('');
  return `<details><summary>Accessible graph list</summary><h2>Nodes</h2><ul>${nodeItems || '<li>No nodes</li>'}</ul><h2>Relationships</h2><ul>${edgeItems || '<li>No relationships</li>'}</ul></details>`;
}

function edgeRelationship(
  edge: ConceptGraphEdge,
  source: string,
  target: string,
  count: number,
): string {
  if (edge.kind === 'concept') return `${source} → concept: ${target}`;
  if (edge.kind === 'entity') return `${source} → entity: ${target}`;
  return `${source} → ${target}: ${count} ${count === 1 ? 'reference' : 'references'}`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function shortLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
