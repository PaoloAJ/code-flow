import type { AnalysisGraph, XY } from '@codeviz/shared';

export const NODE_WIDTH = 250;
export const NODE_HEIGHT = 118;

/** Layered auto-layout for the generated graph. Returns component id → position. */
export async function autoLayout(graph: AnalysisGraph): Promise<Record<string, XY>> {
  // elkjs is ~1.4 MB minified and only needed once a graph exists — load it
  // on demand so vite splits it out of the initial bundle.
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: graph.components.map((c) => ({
      id: c.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(elkGraph);
  const positions: Record<string, XY> = {};
  for (const child of res.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return positions;
}
