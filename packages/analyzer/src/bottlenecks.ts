import type { Bottleneck, ComponentNodeData, GraphEdge } from '@codeviz/shared';
import type { FileFacts } from './types.js';

/**
 * Static bottleneck heuristics. These are signals, not verdicts — each carries
 * its evidence so the user (and the LLM pass) can judge.
 */
export function applyStaticBottlenecks(
  components: ComponentNodeData[],
  edges: GraphEdge[],
  factsByComponent: Map<string, FileFacts[]>,
): void {
  const push = (c: ComponentNodeData, b: Omit<Bottleneck, 'source'>) =>
    c.bottlenecks.push({ ...b, source: 'static' });

  // Dependency cycles (Tarjan SCC over import edges).
  const cycles = stronglyConnected(
    components.map((c) => c.id),
    edges.filter((e) => e.kind === 'import'),
  ).filter((scc) => scc.length > 1);
  for (const scc of cycles) {
    for (const id of scc) {
      const c = components.find((x) => x.id === id);
      if (c) {
        push(c, {
          severity: 'high',
          reason: 'Circular dependency between components',
          evidence: `cycle: ${scc.join(' ↔ ')}`,
        });
      }
    }
  }

  // Shared data stores: several components hitting the same database is a
  // classic contention/coupling bottleneck.
  for (const db of components.filter((c) => c.type === 'database')) {
    const writers = edges.filter((e) => e.kind === 'db' && e.target === db.id);
    if (writers.length >= 3) {
      push(db, {
        severity: writers.length >= 5 ? 'high' : 'medium',
        reason: `Shared ${db.kindDetail ?? 'database'} — ${writers.length} components depend on it directly`,
        evidence: writers.map((e) => e.source).join(', '),
      });
    }
  }

  for (const c of components) {
    if (c.type === 'database' || c.type === 'external') continue;
    if (c.metrics.fanIn >= 4) {
      push(c, {
        severity: 'medium',
        reason: `Hub component — ${c.metrics.fanIn} components depend on it`,
        evidence: 'high fan-in; changes here ripple widely and it can serialize work',
      });
    }

    const loops = (factsByComponent.get(c.id) ?? []).flatMap((f) =>
      f.callsInLoops.map((h) => `${f.file.relPath}:${h.line} ${h.note}`),
    );
    if (loops.length > 0) {
      push(c, {
        severity: 'medium',
        reason: `I/O or awaited calls inside loops (${loops.length} sites) — possible N+1 pattern`,
        evidence: loops.slice(0, 3).join(' | '),
      });
    }

    const httpOut = c.outboundCalls.filter((o) => o.kind === 'http');
    if (c.routes.length > 0 && httpOut.length >= 3) {
      push(c, {
        severity: 'medium',
        reason: `Handles ${c.routes.length} routes while making ${httpOut.length} outbound HTTP calls`,
        evidence: 'synchronous external calls in the request path add latency and failure coupling',
      });
    }

    if (c.outboundCalls.length >= 15) {
      push(c, {
        severity: 'medium',
        reason: `Chatty component — ${c.outboundCalls.length} outbound call sites`,
        evidence: 'many external dependencies concentrated in one place',
      });
    }

    if (c.metrics.loc > 10000 || c.metrics.fileCount > 60) {
      push(c, {
        severity: 'low',
        reason: `Very large component (${c.metrics.loc.toLocaleString()} LOC, ${c.metrics.fileCount} files)`,
        evidence: 'size alone slows builds, reviews, and onboarding',
      });
    }
  }
}

/** Tarjan's strongly connected components. */
function stronglyConnected(nodes: string[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  };

  for (const n of nodes) if (!idx.has(n)) visit(n);
  return result;
}
