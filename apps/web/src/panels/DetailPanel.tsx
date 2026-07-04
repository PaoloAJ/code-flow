import { useMemo, useState } from 'react';
import type { ComponentNodeData } from '@codeviz/shared';
import { useStore } from '../store';
import { edgeStyle, SEVERITY_STYLE, TYPE_ICON } from '../theme';

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function DetailPanel() {
  const graph = useStore((s) => s.graph);
  const selection = useStore((s) => s.selection);
  const theme = useStore((s) => s.theme);

  if (!graph) {
    return (
      <aside className="detail-panel">
        <div className="empty-hint">
          Analyze a repository (or load the demo) to see its architecture here.
        </div>
      </aside>
    );
  }

  if (selection?.type === 'component') {
    const c = graph.components.find((x) => x.id === selection.id);
    if (c) return <ComponentDetail c={c} />;
  }
  if (selection?.type === 'edge') {
    const e = graph.edges.find((x) => x.id === selection.id);
    if (e) {
      const src = graph.components.find((c) => c.id === e.source);
      const dst = graph.components.find((c) => c.id === e.target);
      return (
        <aside className="detail-panel">
          <h2>
            {src?.name ?? e.source} → {dst?.name ?? e.target}
          </h2>
          <div className="subtitle">
            {edgeStyle(e.kind, theme).label} · {e.count} reference{e.count > 1 ? 's' : ''}
          </div>
          <h3>Call sites</h3>
          <table className="detail-table">
            <tbody>
              {e.details.map((d, i) => (
                <tr key={i}>
                  <td className="mono">
                    {d.file}:{d.line}
                    {d.note ? <span className="loc"> — {d.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>
      );
    }
  }

  return (
    <aside className="detail-panel">
      <h2>{graph.repo.name}</h2>
      <div className="subtitle">
        analyzed {new Date(graph.repo.analyzedAt).toLocaleString()}
      </div>
      <div className="stat-tiles">
        <Stat value={graph.components.length} label="components" />
        <Stat value={graph.edges.length} label="edges" />
        <Stat value={graph.components.reduce((a, c) => a + c.routes.length, 0)} label="routes" />
        <Stat
          value={graph.components.reduce((a, c) => a + c.bottlenecks.length, 0)}
          label="flags"
        />
      </div>
      <div className="empty-hint">Click a component or an edge for details.</div>
    </aside>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat-tile">
      <div className="value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function ComponentDetail({ c }: { c: ComponentNodeData }) {
  const theme = useStore((s) => s.theme);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const bottlenecks = useMemo(
    () => [...c.bottlenecks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [c.bottlenecks],
  );
  const routes = showAllRoutes ? c.routes : c.routes.slice(0, 12);

  return (
    <aside className="detail-panel">
      <h2>
        <span aria-hidden>{TYPE_ICON[c.type]}</span> {c.name}
        <span className="type-chip" style={{ marginLeft: 'auto' }}>
          {c.kindDetail ?? c.type}
        </span>
      </h2>
      <div className="subtitle mono">{c.path}</div>

      <div className="stat-tiles">
        <Stat value={c.metrics.loc} label="LOC" />
        <Stat value={c.metrics.fileCount} label="files" />
        <Stat value={c.metrics.fanIn} label="fan-in" />
        <Stat value={c.metrics.fanOut} label="fan-out" />
      </div>

      {c.roleCounts && Object.keys(c.roleCounts).length > 0 && (
        <>
          <h3>File roles</h3>
          <div className="role-chips">
            {Object.entries(c.roleCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([role, n]) => (
                <span key={role} className="lang-chip">
                  {role} · {n}
                </span>
              ))}
          </div>
        </>
      )}

      {c.summary && (
        <>
          <h3>Summary</h3>
          <p className="summary">{c.summary}</p>
          {c.responsibilities && c.responsibilities.length > 0 && (
            <ul className="summary" style={{ paddingLeft: 18, margin: '6px 0' }}>
              {c.responsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {bottlenecks.length > 0 && (
        <>
          <h3>Bottleneck signals</h3>
          {bottlenecks.map((b, i) => {
            const s = SEVERITY_STYLE[b.severity];
            return (
              <div key={i} className="bottleneck-item" style={{ borderLeftColor: s.color }}>
                <div className="head">
                  <span style={{ color: s.color }} aria-hidden>
                    {s.icon}
                  </span>
                  <span>{s.label}</span>
                  <span className="source-tag">{b.source === 'llm' ? 'Claude' : 'static'}</span>
                </div>
                <div>{b.reason}</div>
                <div className="evidence">{b.evidence}</div>
              </div>
            );
          })}
        </>
      )}

      {c.routes.length > 0 && (
        <>
          <h3>Routes ({c.routes.length})</h3>
          <table className="detail-table">
            <tbody>
              {routes.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 44 }}>
                    <span className="method-chip">{r.method}</span>
                  </td>
                  <td className="mono">
                    {r.path}
                    <div className="loc">
                      {r.file}:{r.line}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.routes.length > 12 && (
            <button onClick={() => setShowAllRoutes(!showAllRoutes)} style={{ marginTop: 6 }}>
              {showAllRoutes ? 'Show fewer' : `Show all ${c.routes.length}`}
            </button>
          )}
        </>
      )}

      {c.outboundCalls.length > 0 && (
        <>
          <h3>Outbound calls ({c.outboundCalls.length})</h3>
          <table className="detail-table">
            <tbody>
              {c.outboundCalls.slice(0, 20).map((o, i) => (
                <tr key={i}>
                  <td style={{ width: 60, color: edgeStyle(o.kind as never, theme).color }}>
                    {o.kind}
                  </td>
                  <td className="mono">
                    {o.target}
                    <div className="loc">
                      {o.file}:{o.line}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {c.files.length > 0 && (
        <>
          <h3>Files ({c.files.length})</h3>
          <details>
            <summary>Show file list</summary>
            <div className="file-list mono">
              {c.files.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
          </details>
        </>
      )}
    </aside>
  );
}
