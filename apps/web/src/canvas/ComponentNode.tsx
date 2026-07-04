import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ComponentNodeData } from '@codeviz/shared';
import { SEVERITY_STYLE, TYPE_ICON, severityRank } from '../theme';

function worstSeverity(data: ComponentNodeData) {
  if (data.bottlenecks.length === 0) return null;
  return data.bottlenecks.reduce((worst, b) =>
    severityRank[b.severity] > severityRank[worst.severity] ? b : worst,
  );
}

/** Compact card for synthesized infrastructure nodes (databases, external APIs). */
export const InfraNode = memo(function InfraNode({
  data,
  selected,
}: NodeProps & { data: { component: ComponentNodeData } }) {
  const c = data.component;
  const isDb = c.type === 'database';
  const worst = worstSeverity(c);
  return (
    <div className={`infra-node${selected ? ' selected' : ''}${isDb ? ' db' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0.4 }} />
      {isDb && (
        <svg className="cyl" width="26" height="30" viewBox="0 0 26 30" aria-hidden>
          <ellipse cx="13" cy="6" rx="11" ry="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M2 6v18c0 2.8 4.9 5 11 5s11-2.2 11-5V6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )}
      {!isDb && <span className="cloud" aria-hidden>☁</span>}
      <div className="body">
        <div className="name">{c.name}</div>
        <div className="detail">{isDb ? c.kindDetail : 'external API'}</div>
        {worst && (
          <span
            className="bottleneck-badge"
            style={{ background: SEVERITY_STYLE[worst.severity].color }}
            title={worst.reason}
          >
            {SEVERITY_STYLE[worst.severity].icon} {SEVERITY_STYLE[worst.severity].label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0.4 }} />
    </div>
  );
});

export const ComponentNode = memo(function ComponentNode({
  data,
  selected,
}: NodeProps & { data: { component: ComponentNodeData } }) {
  const c = data.component;
  const worst = worstSeverity(c);
  return (
    <div className={`component-node${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0.4 }} />
      <div className="head">
        <span aria-hidden>{TYPE_ICON[c.type] ?? '·'}</span>
        <span className="name" title={c.name}>
          {c.name}
        </span>
        <span className="type-chip">{c.type}</span>
      </div>
      <div className="path" title={c.path}>
        {c.path}
      </div>
      <div className="stats">
        <span>
          <b>{c.metrics.loc.toLocaleString()}</b> loc
        </span>
        <span>
          <b>{c.metrics.fileCount}</b> files
        </span>
        <span>
          <b>{c.routes.length}</b> routes
        </span>
        <span>
          <b>{c.metrics.fanIn}</b>↓ <b>{c.metrics.fanOut}</b>↑
        </span>
      </div>
      <div className="badges">
        {c.languages.slice(0, 4).map((l) => (
          <span key={l} className="lang-chip">
            {l}
          </span>
        ))}
        {worst && (
          <span
            className="bottleneck-badge"
            style={{ background: SEVERITY_STYLE[worst.severity].color }}
            title={worst.reason}
          >
            {SEVERITY_STYLE[worst.severity].icon} {c.bottlenecks.length} bottleneck
            {c.bottlenecks.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0.4 }} />
    </div>
  );
});
