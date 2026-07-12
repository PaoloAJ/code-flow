import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { getStroke } from 'perfect-freehand';
import rough from 'roughjs/bin/rough';
import type { AnnotationNode, DrawnStyle } from '@codeviz/shared';
import { useStore } from '../store';

const generator = rough.generator();

/**
 * Excalidraw's sloppiness model. The default, architect, disables all
 * perturbation so shape outlines are perfectly straight/smooth.
 */
const SLOPPINESS = {
  architect: { roughness: 0, bowing: 0 },
  artist: { roughness: 1, bowing: 1 },
  cartoonist: { roughness: 2.2, bowing: 1.5 },
} as const;

function dashArray(a: DrawnStyle): string | undefined {
  const w = a.strokeWidth ?? 2;
  if (a.strokeStyle === 'dashed') return `${w * 4} ${w * 3}`;
  if (a.strokeStyle === 'dotted') return `${Math.max(1, w * 0.6)} ${w * 3}`;
  return undefined;
}

/** Shared roughjs options for every drawn annotation. */
function roughOpts(a: DrawnStyle) {
  const s = SLOPPINESS[a.sloppiness ?? 'architect'];
  return {
    seed: a.seed || 1,
    stroke: a.stroke,
    strokeWidth: a.strokeWidth ?? 2,
    roughness: s.roughness,
    bowing: s.bowing,
    disableMultiStroke: true,
    disableMultiStrokeFill: true,
    // architect ellipses: enough fitting steps that the curve is smooth
    curveFitting: 1,
    preserveVertices: true,
  };
}

type StickyData = { annotation: Extract<AnnotationNode, { type: 'sticky' }> };
type LabelData = { annotation: Extract<AnnotationNode, { type: 'label' }> };
type ShapeData = { annotation: Extract<AnnotationNode, { type: 'shape' }> };
type FreehandData = { annotation: Extract<AnnotationNode, { type: 'freehand' }> };
type ArrowData = { annotation: Extract<AnnotationNode, { type: 'arrow' }> };

/** Render a roughjs drawable as React <path> elements. */
function RoughPaths({
  drawable,
  dash,
}: {
  drawable: ReturnType<typeof generator.rectangle>;
  dash?: string;
}) {
  const paths = useMemo(() => generator.toPaths(drawable), [drawable]);
  return (
    <>
      {paths.map((p, i) => {
        // roughjs renders fills as stroked paths too; the outline is always
        // the last set — only it gets the dash pattern.
        const outline = i === paths.length - 1 && p.stroke !== 'none';
        return (
          <path
            key={i}
            d={p.d}
            stroke={p.stroke === 'none' ? undefined : p.stroke}
            strokeWidth={p.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={outline ? dash : undefined}
            fill={p.fill && p.fill !== 'none' ? p.fill : 'none'}
          />
        );
      })}
    </>
  );
}

/** Grow the editor to fit its content so editing is WYSIWYG (labels only). */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.width = '0';
  el.style.height = '0';
  el.style.width = `${el.scrollWidth + 4}px`;
  el.style.height = `${el.scrollHeight}px`;
}

function EditableText({
  id,
  text,
  className,
  removeIfEmpty,
  grow,
  placeholder = 'double-click to edit',
  editWhenEmpty,
}: {
  id: string;
  text: string;
  className?: string;
  removeIfEmpty?: boolean;
  /** Auto-size the editor to its content (text labels). */
  grow?: boolean;
  placeholder?: string;
  /** Open the editor on mount when empty (fresh labels/stickies do; shapes don't). */
  editWhenEmpty?: boolean;
}) {
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const removeAnnotations = useStore((s) => s.removeAnnotations);
  const [editing, setEditing] = useState((editWhenEmpty ?? true) && text === '');
  // Double-clicks are sometimes swallowed by the React Flow pane mid-rerender;
  // FlowCanvas hit-tests those and routes the edit request through the store.
  const editRequested = useStore((s) => s.editingAnnotationId === id);
  useEffect(() => {
    if (editRequested) {
      setEditing(true);
      useStore.getState().setEditingAnnotation(null);
    }
  }, [editRequested]);
  const commit = (value: string) => {
    if (removeIfEmpty && value.trim() === '') {
      removeAnnotations([id]);
      return;
    }
    updateAnnotation(id, { text: value } as Partial<AnnotationNode>);
    setEditing(false);
  };
  if (editing) {
    return (
      <textarea
        ref={(el) => {
          if (el) {
            el.focus();
            if (grow) autoGrow(el);
            requestAnimationFrame(() => el.focus());
          }
        }}
        autoFocus
        defaultValue={text}
        className={`nodrag${className ? ` ${className}` : ''}`}
        onInput={grow ? (e) => autoGrow(e.currentTarget) : undefined}
        onBlur={(e) => {
          // React Flow steals focus onto the surrounding node wrapper right
          // after mount; that's not the user leaving — reclaim, don't commit.
          const rt = e.relatedTarget as HTMLElement | null;
          const el = e.currentTarget;
          if (rt && rt.contains(el)) {
            requestAnimationFrame(() => el.focus());
            return;
          }
          commit(el.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') commit((e.target as HTMLTextAreaElement).value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div className={className} onDoubleClick={() => setEditing(true)} style={{ whiteSpace: 'pre-wrap' }}>
      {text || placeholder}
    </div>
  );
}

export const StickyNode = memo(function StickyNode({ id, data, selected }: NodeProps & { data: StickyData }) {
  const a = data.annotation;
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const tool = useStore((s) => s.tool);
  return (
    <>
      <NodeResizer
        // Hide handles for non-select tools: they sit on the border and would
        // swallow eraser clicks.
        isVisible={selected && tool === 'select'}
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
      {/* Excalidraw deletes text elements committed empty — an invisible label
          would otherwise linger forever. */}
      <EditableText id={id} text={a.text} removeIfEmpty grow />
    </div>
  );
});

export const ShapeNode = memo(function ShapeNode({ id, data, selected }: NodeProps & { data: ShapeData }) {
  const a = data.annotation;
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const tool = useStore((s) => s.tool);
  const pad = 6;
  const drawable = useMemo(() => {
    const opts = {
      ...roughOpts(a),
      fill: a.fillStyle !== 'none' && a.fill !== 'transparent' ? a.fill : undefined,
      fillStyle: a.fillStyle === 'solid' ? 'solid' : a.fillStyle === 'cross-hatch' ? 'cross-hatch' : 'hachure',
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
  }, [a.shape, a.width, a.height, a.stroke, a.strokeWidth, a.fill, a.fillStyle, a.seed, a.sloppiness]);

  return (
    <>
      <NodeResizer
        isVisible={selected && tool === 'select'}
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
        <RoughPaths drawable={drawable} dash={dashArray(a)} />
      </svg>
      {/* Bound text, centered like Excalidraw. Mounted even when empty so the
          text tool / double-click / Enter can open the editor via the store. */}
      <div
        className="shape-text handwritten"
        style={{ color: a.stroke, opacity: a.opacity ?? 1 }}
      >
        <EditableText id={id} text={a.text ?? ''} placeholder="" grow editWhenEmpty={false} />
      </div>
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

  const drawable = useMemo(
    () => generator.line(sx, sy, ex, ey, roughOpts(a)),
    [sx, sy, ex, ey, a.stroke, a.strokeWidth, a.seed, a.sloppiness],
  );

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
        { ...roughOpts(a), seed: (a.seed || 1) + 7 },
      );
    return [mk(0.45), mk(-0.45)];
  }, [sx, sy, ex, ey, a.stroke, a.strokeWidth, a.seed, a.head, a.sloppiness]);

  return (
    <div style={{ transform: `translate(${minX - pad}px, ${minY - pad}px)`, opacity: a.opacity ?? 1 }}>
      <svg width={w + pad * 2} height={h + pad * 2} style={{ display: 'block', overflow: 'visible' }}>
        {selected && (
          <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#3987e5" strokeWidth={(a.strokeWidth ?? 2) + 6} opacity={0.25} />
        )}
        <RoughPaths drawable={drawable} dash={dashArray(a)} />
        {head.map((d, i) => (
          <RoughPaths key={i} drawable={d} />
        ))}
      </svg>
    </div>
  );
});
