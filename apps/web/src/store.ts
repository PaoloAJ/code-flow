import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  AnalysisGraph,
  AnnotationEdge,
  AnnotationNode,
  Diagram,
  XY,
} from '@codeviz/shared';

export type Tool =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'label'
  | 'shape-rect'
  | 'shape-diamond'
  | 'shape-ellipse'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'eraser';

export type Selection =
  | { type: 'component'; id: string }
  | { type: 'edge'; id: string }
  | null;

export type ThemeMode = 'light' | 'dark';

const storedTheme = (): ThemeMode =>
  typeof localStorage !== 'undefined' && localStorage.getItem('codeviz-theme') === 'light'
    ? 'light'
    : 'dark';

/** Excalidraw-style "current item" style, reused by the next drawn element. */
export interface CurrentStyle {
  stroke: string;
  fill: string;
  fillStyle: 'none' | 'hachure' | 'solid';
  strokeWidth: number;
  opacity: number;
}

/** The undoable slice — user-authored layout and annotations. */
interface UndoableState {
  positions: Record<string, XY>;
  annotations: AnnotationNode[];
  annotationEdges: AnnotationEdge[];
}

interface AppState extends UndoableState {
  graph: AnalysisGraph | null;
  analysisId: string | null;
  diagramId: string | null;
  diagramName: string;
  selection: Selection;
  selectedAnnotationIds: string[];
  tool: Tool;
  currentStyle: CurrentStyle;
  theme: ThemeMode;
  /** Excalidraw's padlock: keep the active tool after drawing. */
  toolLocked: boolean;

  toggleToolLocked: () => void;
  toggleTheme: () => void;
  setGraph: (graph: AnalysisGraph, analysisId: string | null) => void;
  setPositions: (positions: Record<string, XY>) => void;
  moveNode: (id: string, pos: XY) => void;
  addAnnotation: (a: AnnotationNode) => void;
  updateAnnotation: (id: string, patch: Partial<AnnotationNode>) => void;
  updateAnnotations: (ids: string[], patch: Record<string, unknown>) => void;
  duplicateAnnotations: (ids: string[]) => void;
  removeAnnotations: (ids: string[]) => void;
  addAnnotationEdge: (e: AnnotationEdge) => void;
  removeAnnotationEdges: (ids: string[]) => void;
  setSelection: (s: Selection) => void;
  setSelectedAnnotations: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setCurrentStyle: (patch: Partial<CurrentStyle>) => void;
  setDiagramName: (name: string) => void;
  loadDiagram: (d: Diagram) => void;
  newDiagramId: () => string;
}

export const useStore = create<AppState>()(
  temporal(
    (set, get) => ({
      graph: null,
      analysisId: null,
      diagramId: null,
      diagramName: 'Untitled diagram',
      positions: {},
      annotations: [],
      annotationEdges: [],
      selection: null,
      selectedAnnotationIds: [],
      tool: 'select',
      currentStyle: {
        stroke: '#e66767',
        fill: 'transparent',
        fillStyle: 'none',
        strokeWidth: 2,
        opacity: 1,
      },
      theme: storedTheme(),
      toolLocked: false,

      toggleToolLocked: () => set({ toolLocked: !get().toolLocked }),
      toggleTheme: () => {
        const theme = get().theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('codeviz-theme', theme);
        set({ theme });
      },
      setGraph: (graph, analysisId) =>
        set({ graph, analysisId, selection: null, positions: {}, annotations: [], annotationEdges: [] }),
      setPositions: (positions) => set({ positions }),
      moveNode: (id, pos) => set({ positions: { ...get().positions, [id]: pos } }),
      addAnnotation: (a) => set({ annotations: [...get().annotations, a] }),
      updateAnnotation: (id, patch) =>
        set({
          annotations: get().annotations.map((a) =>
            a.id === id ? ({ ...a, ...patch } as AnnotationNode) : a,
          ),
        }),
      updateAnnotations: (ids, patch) =>
        set({
          annotations: get().annotations.map((a) =>
            ids.includes(a.id) ? ({ ...a, ...patch } as AnnotationNode) : a,
          ),
        }),
      duplicateAnnotations: (ids) => {
        const copies = get()
          .annotations.filter((a) => ids.includes(a.id))
          .map(
            (a) =>
              ({
                ...structuredClone(a),
                id: crypto.randomUUID(),
                position: { x: a.position.x + 20, y: a.position.y + 20 },
              }) as AnnotationNode,
          );
        set({ annotations: [...get().annotations, ...copies] });
      },
      removeAnnotations: (ids) =>
        set({
          annotations: get().annotations.filter((a) => !ids.includes(a.id)),
          annotationEdges: get().annotationEdges.filter(
            (e) => !ids.includes(e.source) && !ids.includes(e.target),
          ),
          selectedAnnotationIds: get().selectedAnnotationIds.filter((id) => !ids.includes(id)),
        }),
      addAnnotationEdge: (e) => set({ annotationEdges: [...get().annotationEdges, e] }),
      removeAnnotationEdges: (ids) =>
        set({ annotationEdges: get().annotationEdges.filter((e) => !ids.includes(e.id)) }),
      setSelection: (selection) => set({ selection }),
      setSelectedAnnotations: (selectedAnnotationIds) => set({ selectedAnnotationIds }),
      setTool: (tool) => set({ tool }),
      setCurrentStyle: (patch) => set({ currentStyle: { ...get().currentStyle, ...patch } }),
      setDiagramName: (diagramName) => set({ diagramName }),
      loadDiagram: (d) =>
        set({
          graph: d.graph,
          analysisId: d.analysisId || null,
          diagramId: d.id,
          diagramName: d.name,
          positions: d.nodePositions,
          annotations: d.annotations,
          annotationEdges: d.annotationEdges,
          selection: null,
          selectedAnnotationIds: [],
        }),
      newDiagramId: () => {
        let id = get().diagramId;
        if (!id) {
          id = crypto.randomUUID();
          set({ diagramId: id });
        }
        return id;
      },
    }),
    {
      partialize: (state) => ({
        positions: state.positions,
        annotations: state.annotations,
        annotationEdges: state.annotationEdges,
      }),
      limit: 100,
      equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
  ),
);

export const undo = () => useStore.temporal.getState().undo();
export const redo = () => useStore.temporal.getState().redo();
