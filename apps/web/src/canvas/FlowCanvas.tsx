import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Connection,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import type { AnnotationNode, XY } from '@codeviz/shared';
import { redo, undo, useStore, type Tool } from '../store';
import { EDGE_KINDS, GRID, edgeStyle } from '../theme';
import { NODE_HEIGHT, NODE_WIDTH } from '../layout';
import { ComponentNode, InfraNode } from './ComponentNode';
import { ArrowNode, FreehandNode, LabelNode, ShapeNode, StickyNode } from './annotations';
import { KindEdge } from './KindEdge';
import { StylePanel } from '../panels/StylePanel';

const nodeTypes = {
  component: ComponentNode,
  infra: InfraNode,
  sticky: StickyNode,
  label: LabelNode,
  shape: ShapeNode,
  freehand: FreehandNode,
  arrow: ArrowNode,
};

const edgeTypes = { kind: KindEdge };

const STICKY_COLORS = ['#f5d76e', '#9ec5f4', '#a8e6c9', '#e8a4c4'];
const DRAG_TOOLS: Tool[] = ['draw', 'arrow', 'line', 'shape-rect', 'shape-diamond', 'shape-ellipse'];

/** Excalidraw grid-mode snapping. */
const snap = (v: number) => Math.round(v / GRID.size) * GRID.size;

export function FlowCanvas() {
  const graph = useStore((s) => s.graph);
  const positions = useStore((s) => s.positions);
  const annotations = useStore((s) => s.annotations);
  const annotationEdges = useStore((s) => s.annotationEdges);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const selection = useStore((s) => s.selection);
  const moveNode = useStore((s) => s.moveNode);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const removeAnnotations = useStore((s) => s.removeAnnotations);
  const addAnnotationEdge = useStore((s) => s.addAnnotationEdge);
  const removeAnnotationEdges = useStore((s) => s.removeAnnotationEdges);
  const setSelection = useStore((s) => s.setSelection);
  const setSelectedAnnotations = useStore((s) => s.setSelectedAnnotations);
  const currentStyle = useStore((s) => s.currentStyle);
  const theme = useStore((s) => s.theme);
  const toolLocked = useStore((s) => s.toolLocked);

  const { screenToFlowPosition } = useReactFlow();

  // React Flow runs fully controlled here, so *we* must persist the selection
  // changes it emits — otherwise clicks never mark nodes selected and the
  // resizer/style panel immediately lose their target.
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());

  // When a component is selected, its neighborhood stays lit and the rest dims.
  const neighborhood = useMemo(() => {
    if (selection?.type !== 'component' || !graph) return null;
    const keep = new Set<string>([selection.id]);
    for (const e of graph.edges) {
      if (e.source === selection.id) keep.add(e.target);
      if (e.target === selection.id) keep.add(e.source);
    }
    return keep;
  }, [selection, graph]);

  const nodes = useMemo<Node[]>(() => {
    const componentNodes: Node[] = (graph?.components ?? []).map((c, i) => ({
      id: c.id,
      type: c.type === 'database' || c.type === 'external' ? 'infra' : 'component',
      position:
        positions[c.id] ?? { x: (i % 4) * (NODE_WIDTH + 60), y: Math.floor(i / 4) * (NODE_HEIGHT + 60) },
      data: { component: c },
      deletable: false,
      selected: selectedNodes.has(c.id),
      style: neighborhood && !neighborhood.has(c.id) ? { opacity: 0.25 } : undefined,
    }));
    const annotationNodes: Node[] = annotations.map((a) => ({
      id: a.id,
      type: a.type,
      position: a.position,
      data: { annotation: a },
      selected: selectedNodes.has(a.id),
      zIndex: a.type === 'shape' || a.type === 'freehand' || a.type === 'arrow' ? -1 : 5,
    }));
    return [...componentNodes, ...annotationNodes];
  }, [graph, positions, annotations, neighborhood, selectedNodes]);

  const edges = useMemo<Edge[]>(() => {
    const graphEdges: Edge[] = (graph?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'kind',
      data: { kind: e.kind, count: e.count },
      selected: selectedEdges.has(e.id),
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle(e.kind, theme).color, width: 16, height: 16 },
      deletable: false,
      style:
        neighborhood && !(neighborhood.has(e.source) && neighborhood.has(e.target))
          ? { opacity: 0.15 }
          : undefined,
    }));
    const userEdges: Edge[] = annotationEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      selected: selectedEdges.has(e.id),
      style: { stroke: 'var(--text-secondary)', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#c3c2b7' },
    }));
    return [...graphEdges, ...userEdges];
  }, [graph, annotationEdges, neighborhood, theme, selectedEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const state = useStore.getState();
          const annotation = state.annotations.find((a) => a.id === change.id);
          if (annotation) {
            state.updateAnnotation(change.id, { position: change.position } as Partial<AnnotationNode>);
          } else {
            moveNode(change.id, change.position);
          }
        } else if (change.type === 'remove') {
          removeAnnotations([change.id]);
        } else if (change.type === 'select') {
          setSelectedNodes((prev) => {
            const next = new Set(prev);
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
            return next;
          });
        }
      }
    },
    [moveNode, removeAnnotations],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type === 'select') {
        setSelectedEdges((prev) => {
          const next = new Set(prev);
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
          return next;
        });
      }
    }
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      addAnnotationEdge({ id: crypto.randomUUID(), source: conn.source, target: conn.target });
    },
    [addAnnotationEdge],
  );

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      setSelection(null);
      if (tool === 'sticky' || tool === 'label') {
        const raw = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const pos = { x: snap(raw.x), y: snap(raw.y) };
        const id = crypto.randomUUID();
        if (tool === 'sticky') {
          addAnnotation({
            id,
            type: 'sticky',
            position: pos,
            width: 180,
            height: 110,
            text: '',
            color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)],
            opacity: 1,
          });
        } else {
          addAnnotation({
            id,
            type: 'label',
            position: pos,
            text: '',
            fontSize: 20,
            color:
              currentStyle.stroke === 'transparent'
                ? theme === 'dark'
                  ? '#ffffff'
                  : '#0b0b0b'
                : currentStyle.stroke,
            opacity: 1,
          });
        }
        if (!toolLocked) setTool('select');
      }
    },
    [tool, toolLocked, addAnnotation, screenToFlowPosition, setSelection, setTool, currentStyle],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      const annIds = new Set(useStore.getState().annotations.map((a) => a.id));
      setSelectedAnnotations(sel.filter((n) => annIds.has(n.id)).map((n) => n.id));
    },
    [setSelectedAnnotations],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => removeAnnotationEdges(deleted.map((e) => e.id)),
    [removeAnnotationEdges],
  );

  const dragToolActive = DRAG_TOOLS.includes(tool);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        onNodeClick={(_e, node) => {
          if (tool === 'eraser') {
            removeAnnotations([node.id]); // generated nodes aren't annotations — no-op
            return;
          }
          if (node.type === 'component' || node.type === 'infra') {
            setSelection({ type: 'component', id: node.id });
          }
        }}
        onEdgeClick={(_e, edge) => {
          if (tool === 'eraser') {
            removeAnnotationEdges([edge.id]);
            return;
          }
          if (edge.type === 'kind') setSelection({ type: 'edge', id: edge.id });
        }}
        fitView
        minZoom={0.05}
        maxZoom={10}
        snapToGrid
        snapGrid={[GRID.size, GRID.size]}
        panOnDrag={tool === 'hand' ? true : [1, 2]}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panActivationKeyCode="Space"
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          id="grid-minor"
          variant={BackgroundVariant.Lines}
          gap={GRID.size}
          lineWidth={1}
          color={GRID.minor[theme]}
        />
        <Background
          id="grid-major"
          variant={BackgroundVariant.Lines}
          gap={GRID.size * GRID.boldEvery}
          lineWidth={1}
          color={GRID.major[theme]}
        />
      </ReactFlow>
      {dragToolActive && <SketchOverlay />}
      <StylePanel />
      <ZoomPanel />
      {graph && <EdgeLegend />}
      {!graph && annotations.length === 0 && <EmptyState />}
    </>
  );
}

/**
 * Pointer overlay for Excalidraw-style creation: drag to size shapes, drag to
 * point arrows, drag to draw freehand strokes.
 */
function SketchOverlay() {
  const tool = useStore((s) => s.tool);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const setTool = useStore((s) => s.setTool);
  const currentStyle = useStore((s) => s.currentStyle);
  const toolLocked = useStore((s) => s.toolLocked);
  const { screenToFlowPosition } = useReactFlow();

  const [preview, setPreview] = useState<React.ReactNode>(null);
  const start = useRef<XY | null>(null); // flow coords
  const startScreen = useRef<XY | null>(null); // overlay-local coords
  const flowPoints = useRef<[number, number, number][]>([]);
  const screenPoints = useRef<[number, number][]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  const toLocal = (e: React.PointerEvent): XY => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const commit = (endRaw: XY) => {
    const s0 = start.current;
    if (!s0) return;
    // Freehand keeps raw points; everything else snaps to the grid.
    const s = tool === 'draw' ? s0 : { x: snap(s0.x), y: snap(s0.y) };
    const endFlow = tool === 'draw' ? endRaw : { x: snap(endRaw.x), y: snap(endRaw.y) };
    const id = crypto.randomUUID();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const base = {
      stroke: currentStyle.stroke,
      strokeWidth: currentStyle.strokeWidth,
      opacity: currentStyle.opacity,
      seed,
    };
    if (tool === 'arrow' || tool === 'line') {
      const dx = endFlow.x - s.x;
      const dy = endFlow.y - s.y;
      if (Math.hypot(dx, dy) < 8) return;
      addAnnotation({ id, type: 'arrow', position: s, end: { x: dx, y: dy }, head: tool === 'arrow', ...base });
    } else if (tool.startsWith('shape-')) {
      const x = Math.min(s.x, endFlow.x);
      const y = Math.min(s.y, endFlow.y);
      const width = Math.max(24, Math.abs(endFlow.x - s.x));
      const height = Math.max(24, Math.abs(endFlow.y - s.y));
      addAnnotation({
        id,
        type: 'shape',
        position: { x, y },
        width,
        height,
        shape: tool === 'shape-rect' ? 'rect' : tool === 'shape-diamond' ? 'diamond' : 'ellipse',
        fill: currentStyle.fill,
        fillStyle: currentStyle.fillStyle,
        ...base,
      });
    } else if (tool === 'draw') {
      const pts = flowPoints.current;
      if (pts.length > 2) {
        const minX = Math.min(...pts.map((p) => p[0]));
        const minY = Math.min(...pts.map((p) => p[1]));
        addAnnotation({
          id,
          type: 'freehand',
          position: { x: minX, y: minY },
          points: pts.map(([x, y, pr]) => [x - minX, y - minY, pr]),
          ...base,
        });
      }
    }
  };

  return (
    <div
      ref={overlayRef}
      className="draw-overlay"
      onPointerDown={(e) => {
        start.current = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        startScreen.current = toLocal(e);
        flowPoints.current = [];
        screenPoints.current = [];
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current || !startScreen.current) return;
        const local = toLocal(e);
        const s = startScreen.current;
        const stroke = currentStyle.stroke;
        if (tool === 'draw') {
          const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          flowPoints.current.push([p.x, p.y, e.pressure || 0.5]);
          screenPoints.current.push([local.x, local.y]);
          setPreview(
            <path
              d={screenPoints.current.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={3}
              strokeLinecap="round"
            />,
          );
        } else if (tool === 'arrow' || tool === 'line') {
          setPreview(<line x1={s.x} y1={s.y} x2={local.x} y2={local.y} stroke={stroke} strokeWidth={2} strokeDasharray="6 4" />);
        } else {
          const x = Math.min(s.x, local.x);
          const y = Math.min(s.y, local.y);
          const w = Math.abs(local.x - s.x);
          const h = Math.abs(local.y - s.y);
          setPreview(
            tool === 'shape-ellipse' ? (
              <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray="6 4" />
            ) : tool === 'shape-diamond' ? (
              <polygon
                points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            ) : (
              <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray="6 4" />
            ),
          );
        }
      }}
      onPointerUp={(e) => {
        commit(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        start.current = null;
        setPreview(null);
        if (!toolLocked && !e.shiftKey) setTool('select'); // padlock or shift keeps the tool
      }}
    >
      <svg width="100%" height="100%">
        {preview}
      </svg>
    </div>
  );
}

function ZoomPanel() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="bottom-left-bar">
      <div className="island">
        <button title="Zoom out" onClick={() => zoomOut()}>
          −
        </button>
        <button title="Reset zoom / fit view" onClick={() => fitView({ padding: 0.15 })}>
          {Math.round(zoom * 100)}%
        </button>
        <button title="Zoom in" onClick={() => zoomIn()}>
          +
        </button>
      </div>
      <div className="island">
        <button title="Undo — ⌘Z" onClick={() => undo()}>
          ↩
        </button>
        <button title="Redo — ⇧⌘Z" onClick={() => redo()}>
          ↪
        </button>
      </div>
    </div>
  );
}

function EdgeLegend() {
  const theme = useStore((s) => s.theme);
  return (
    <div className="legend">
      {EDGE_KINDS.map((kind) => {
        const s = edgeStyle(kind, theme);
        return (
          <div className="row" key={kind}>
            <svg width="28" height="6">
              <line x1="0" y1="3" x2="28" y2="3" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} />
            </svg>
            <span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="canvas-empty">
      <div className="title">Nothing here yet</div>
      <div>
        Paste a GitHub URL or local path above and hit <b>Analyze</b>,
        <br />
        or click <b>Demo</b> to explore a sample architecture.
      </div>
    </div>
  );
}
