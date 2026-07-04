import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { EdgeKind } from '@codeviz/shared';
import { edgeStyle } from '../theme';
import { useStore } from '../store';

/** Generated-graph edge: color + dash pattern encode the relationship kind. */
export const KindEdge = memo(function KindEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const kind = (props.data?.kind ?? 'import') as EdgeKind;
  const count = (props.data?.count as number | undefined) ?? 1;
  const theme = useStore((s) => s.theme);
  const style = edgeStyle(kind, theme);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: style.color,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: style.dash,
          opacity: selected ? 1 : 0.85,
        }}
        markerEnd={props.markerEnd}
      />
      {(selected || count > 3) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              color: 'var(--text-secondary)',
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '0 5px',
              pointerEvents: 'none',
            }}
          >
            {style.label}
            {count > 1 ? ` ×${count}` : ''}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
