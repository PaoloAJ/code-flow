import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  AnalysisGraph,
  AnnotationEdge,
  AnnotationNode,
  Diagram,
  PeerInfo,
  User,
  XY,
} from '@codeviz/shared';
import { collabBus } from './collabBus';

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
  fillStyle: 'none' | 'hachure' | 'cross-hatch' | 'solid';
  strokeWidth: number;
  opacity: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  sloppiness: 'architect' | 'artist' | 'cartoonist';
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

  /** Top-level screen: the saved-diagrams dashboard or the canvas editor. */
  view: 'dashboard' | 'canvas';
  setView: (v: 'dashboard' | 'canvas') => void;
  /** Fresh canvas: clears the graph, drawings, and diagram identity. */
  newDiagram: () => void;

  // ── auth + live collaboration ──
  user: User | null;
  authRequired: boolean;
  /** Which auth system the server runs: Clerk or the built-in one. */
  authProvider: 'local' | 'clerk';
  setAuthProvider: (p: 'local' | 'clerk') => void;
  /** Other people in the current live session. */
  peers: PeerInfo[];
  /** Latest cursor position per peer, in flow coordinates. */
  cursors: Record<string, XY>;
  collabActive: boolean;

  setAuth: (user: User | null, authRequired: boolean) => void;
  setPeers: (peers: PeerInfo[]) => void;
  addPeer: (peer: PeerInfo) => void;
  removePeer: (id: string) => void;
  setCursor: (peerId: string, xy: XY) => void;
  setCollabActive: (active: boolean) => void;

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
  /** Ask a sticky/label to open its text editor (double-click routing). */
  editingAnnotationId: string | null;
  setEditingAnnotation: (id: string | null) => void;
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
        strokeStyle: 'solid',
        sloppiness: 'architect',
      },
      theme: storedTheme(),
      toolLocked: false,

      // shared links (?d=) go straight to the canvas; everything else lands
      // on the dashboard
      view: (typeof location !== 'undefined' && new URLSearchParams(location.search).has('d')
        ? 'canvas'
        : 'dashboard') as 'dashboard' | 'canvas',
      setView: (view) => set({ view }),
      newDiagram: () =>
        set({
          graph: null,
          analysisId: null,
          diagramId: null,
          diagramName: 'Untitled diagram',
          positions: {},
          annotations: [],
          annotationEdges: [],
          selection: null,
          selectedAnnotationIds: [],
          view: 'canvas',
        }),

      user: null,
      authRequired: false,
      authProvider: 'local' as const,
      setAuthProvider: (authProvider) => set({ authProvider }),
      peers: [],
      cursors: {},
      collabActive: false,

      setAuth: (user, authRequired) => set({ user, authRequired }),
      setPeers: (peers) => set({ peers, cursors: {} }),
      addPeer: (peer) => set({ peers: [...get().peers.filter((p) => p.id !== peer.id), peer] }),
      removePeer: (id) => {
        const cursors = { ...get().cursors };
        delete cursors[id];
        set({ peers: get().peers.filter((p) => p.id !== id), cursors });
      },
      setCursor: (peerId, xy) => set({ cursors: { ...get().cursors, [peerId]: xy } }),
      setCollabActive: (collabActive) => set({ collabActive }),

      toggleToolLocked: () => set({ toolLocked: !get().toolLocked }),
      toggleTheme: () => {
        const theme = get().theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('codeviz-theme', theme);
        set({ theme });
      },
      setGraph: (graph, analysisId) =>
        set({ graph, analysisId, selection: null, positions: {}, annotations: [], annotationEdges: [] }),
      setPositions: (positions) => set({ positions }),
      moveNode: (id, pos) => {
        set({ positions: { ...get().positions, [id]: pos } });
        collabBus.emit({ t: 'pos', id, xy: pos });
      },
      addAnnotation: (a) => {
        set({ annotations: [...get().annotations, a] });
        collabBus.emit({ t: 'ann:add', annotation: a });
      },
      updateAnnotation: (id, patch) => {
        set({
          annotations: get().annotations.map((a) =>
            a.id === id ? ({ ...a, ...patch } as AnnotationNode) : a,
          ),
        });
        collabBus.emit({ t: 'ann:update', id, patch: patch as Record<string, unknown> });
      },
      updateAnnotations: (ids, patch) => {
        set({
          annotations: get().annotations.map((a) =>
            ids.includes(a.id) ? ({ ...a, ...patch } as AnnotationNode) : a,
          ),
        });
        collabBus.emit({ t: 'ann:updateMany', ids, patch });
      },
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
        for (const c of copies) collabBus.emit({ t: 'ann:add', annotation: c });
      },
      removeAnnotations: (ids) => {
        set({
          annotations: get().annotations.filter((a) => !ids.includes(a.id)),
          annotationEdges: get().annotationEdges.filter(
            (e) => !ids.includes(e.source) && !ids.includes(e.target),
          ),
          selectedAnnotationIds: get().selectedAnnotationIds.filter((id) => !ids.includes(id)),
        });
        collabBus.emit({ t: 'ann:remove', ids });
      },
      addAnnotationEdge: (e) => {
        set({ annotationEdges: [...get().annotationEdges, e] });
        collabBus.emit({ t: 'edge:add', edge: e });
      },
      removeAnnotationEdges: (ids) => {
        set({ annotationEdges: get().annotationEdges.filter((e) => !ids.includes(e.id)) });
        collabBus.emit({ t: 'edge:remove', ids });
      },
      setSelection: (selection) => set({ selection }),
      setSelectedAnnotations: (selectedAnnotationIds) => set({ selectedAnnotationIds }),
      editingAnnotationId: null,
      setEditingAnnotation: (editingAnnotationId) => set({ editingAnnotationId }),
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
          view: 'canvas',
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
      // Reference equality is correct (slices are never mutated in place) and
      // O(1) — stringify ran on the whole diagram for every drag frame.
      equality: (a, b) =>
        a.positions === b.positions &&
        a.annotations === b.annotations &&
        a.annotationEdges === b.annotationEdges,
    },
  ),
);

// Undo replays local snapshots without emitting collab ops, so peers would
// silently diverge — disabled while a live session is active.
export const undo = () => {
  if (!useStore.getState().collabActive) useStore.temporal.getState().undo();
};
export const redo = () => {
  if (!useStore.getState().collabActive) useStore.temporal.getState().redo();
};
