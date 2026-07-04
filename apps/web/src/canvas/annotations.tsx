import { memo, useMemo, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { getStroke } from 'perfect-freehand';
import rough from 'roughjs/bin/rough';
import type { AnnotationNode } from '@codeviz/shared';
import { useStore } from '../store';

const generator = rough.generator();

type StickyData = { annotation: Extract<AnnotationNode, { type: 'sticky' }> };
type LabelData = { annotation: Extract<AnnotationNode, { type: 'label' }> };
type ShapeData = { annotation: Extract<AnnotationNode, { type: 'shape' }> };
type FreehandData = { annotation: Extract<AnnotationNode, { type: 'freehand' }> };
type ArrowData = { annotation: Extract<AnnotationNode, { type: 'arrow' }> };

/** Render a roughjs drawable as React <path> elements. */
function RoughPaths({ drawable }: { drawable: ReturnType<typeof generator.rectangle> }) {
  const paths = useMemo(() => generator.toPaths(drawable), [drawable]);
  return (
    <>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke === 'none' ? undefined : p.stroke}
          strokeWidth={p.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={p.fill && p.fill !== 'none' ? p.fill : 'none'}
        />
      ))}
    </>
  );
}

function EditableText({
  id,
  text,
  className,
}: {
  id: string;
  text: string;
  className?: string;
}) {
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const [editing, setEditing] = useState(text === '');
  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={text}
        className={className}
        onBlur={(e) => {
          updateAnnotation(id, { text: e.target.value } as Partial<AnnotationNode>);
          setEditing(false);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div className={className} onDoubleClick={() => setEditing(true)} style={{ whiteSpace: 'pre-wrap' }}>
      {text || 'double-click to edit'}
    </div>
  );
}

export const StickyNode = memo(function StickyNode({ id, data, selected }: NodeProps & { data: StickyData }) {
  const a = data.annotation;
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={100}
        minHeight={60}
        onResize={(_e, params) =>
          updateAnnotation(id, { width: params.width, height: params.height } as Partial<AnnotationNode>)
        }
      />
      <div
        className="sticky-node handwritten"
        style={{ background: a.color, width: a.width, height: a.height, opacity: a.opacity ?? 1 }}
      >
        <EditableText id={id} text={a.text} />
      </div>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
});

export const LabelNode = memo(function LabelNode({ id, data }: NodeProps & { data: LabelData }) {
  const a = data.annotation;
  return (
    <div
      className="label-node handwritten"
      style={{ fontSize: a.fontSize, color: a.color, opacity: a.opacity ?? 1 }}
    >
      <EditableText id={id} text={a.text} />
    </div>
  );
});

export const ShapeNode = memo(function ShapeNode({ id, data, selected }: NodeProps & { data: ShapeData }) {
  const a = data.annotation;
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const pad = 6;
  const drawable = useMemo(() => {
    const opts = {
      seed: a.seed || 1,
      stroke: a.stroke,
      strokeWidth: a.strokeWidth ?? 2,
      roughness: 1,
      bowing: 1,
      disableMultiStroke: true,
      disableMultiStrokeFill: true,
      fill: a.fillStyle !== 'none' && a.fill !== 'transparent' ? a.fill : undefined,
      fillStyle: a.fillStyle === 'solid' ? 'solid' : 'hachure',
      hachureGap: 7,
    };
    if (a.shape === 'ellipse') {
      return generator.ellipse(pad + a.width / 2, pad + a.height / 2, a.width, a.height, opts);
    }
    if (a.shape === 'diamond') {
      return generator.polygon(
        [
          [pad + a.width / 2, pad],
          [pad + a.width, pad + a.height / 2],
          [pad + a.width / 2, pad + a.height],
          [pad, pad + a.height / 2],
        ],
        opts,
      );
    }
    return generator.rectangle(pad, pad, a.width, a.height, opts);
  }, [a.shape, a.width, a.height, a.stroke, a.strokeWidth, a.fill, a.fillStyle, a.seed]);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={24}
        minHeight={24}
        onResize={(_e, params) =>
          updateAnnotation(id, { width: params.width, height: params.height } as Partial<AnnotationNode>)
        }
      />
      <svg
        width={a.width + pad * 2}
        height={a.height + pad * 2}
        style={{ display: 'block', overflow: 'visible', opacity: a.opacity ?? 1, margin: -pad }}
      >
        <RoughPaths drawable={drawable} />
      </svg>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
});

function strokePath(points: [number, number, number][], size: number): string {
  const stroke = getStroke(points, { size, thinning: 0.6, smoothing: 0.6, streamline: 0.4 });
  if (stroke.length === 0) return '';
  const d = stroke.reduce(
    (acc, [x, y], i, arr) => {
      const [nx, ny] = arr[(i + 1) % arr.length];
      acc.push(x, y, (x + nx) / 2, (y + ny) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q'] as (string | number)[],
  );
  return [...d, 'Z'].join(' ');
}

export const FreehandNode = memo(function FreehandNode({ data }: NodeProps & { data: FreehandData }) {
  const a = data.annotation;
  const maxX = Math.max(...a.points.map((p) => p[0]), 1);
  const maxY = Math.max(...a.points.map((p) => p[1]), 1);
  return (
    <svg
      width={maxX + 10}
      height={maxY + 10}
      style={{ display: 'block', pointerEvents: 'none', opacity: a.opacity ?? 1 }}
    >
      <path d={strokePath(a.points, 3 + (a.strokeWidth ?? 2) * 1.5)} fill={a.stroke} />
    </svg>
  );
});

export const ArrowNode = memo(function ArrowNode({ data, selected }: NodeProps & { data: ArrowData }) {
  const a = data.annotation;
  const pad = 14;
  const minX = Math.min(0, a.end.x);
  const minY = Math.min(0, a.end.y);
  const w = Math.abs(a.end.x);
  const h = Math.abs(a.end.y);
  // Line from (start) to (end) in local svg coords.
  const sx = -minX + pad;
  const sy = -minY + pad;
  const ex = a.end.x - minX + pad;
  const ey = a.end.y - minY + pad;

  const drawable = useMemo(() => {
    const opts = {
      seed: a.seed || 1,
      stroke: a.stroke,
      strokeWidth: a.strokeWidth ?? 2,
      roughness: 1,
      bowing: 1,
      disableMultiStroke: true,
    };
    return generator.line(sx, sy, ex, ey, opts);
  }, [sx, sy, ex, ey, a.stroke, a.strokeWidth, a.seed]);

  const head = useMemo(() => {
    if (a.head === false) return [];
    const angle = Math.atan2(ey - sy, ex - sx);
    const len = 12 + (a.strokeWidth ?? 2) * 2;
    const mk = (da: number) =>
      generator.line(
        ex,
        ey,
        ex - len * Math.cos(angle + da),
        ey - len * Math.sin(angle + da),
        { seed: (a.seed || 1) + 7, stroke: a.stroke, strokeWidth: a.strokeWidth ?? 2, roughness: 1, disableMultiStroke: true },
      );
    return [mk(0.45), mk(-0.45)];
  }, [sx, sy, ex, ey, a.stroke, a.strokeWidth, a.seed, a.head]);

  return (
    <div style={{ transform: `translate(${minX - pad}px, ${minY - pad}px)`, opacity: a.opacity ?? 1 }}>
      <svg width={w + pad * 2} height={h + pad * 2} style={{ display: 'block', overflow: 'visible' }}>
        {selected && (
          <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#3987e5" strokeWidth={(a.strokeWidth ?? 2) + 6} opacity={0.25} />
        )}
        <RoughPaths drawable={drawable} />
        {head.map((d, i) => (
          <RoughPaths key={i} drawable={d} />
        ))}
      </svg>
    </div>
  );
});
