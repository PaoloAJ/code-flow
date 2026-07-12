import { Suspense, lazy, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './panels/TopBar';
import { Toolbar } from './panels/Toolbar';
import { DetailPanel } from './panels/DetailPanel';
import { Dashboard } from './panels/Dashboard';
import { AuthModal } from './panels/AuthModal';
import { FlowCanvas } from './canvas/FlowCanvas';
import { redo, undo, useStore, type Tool } from './store';
import { api } from './api';
import { joinCollab } from './collab';

const ClerkSignIn = lazy(() => import('./panels/ClerkSignIn'));

/** Full-page sign-in, shown when the deployment requires an account. */
function AuthGate() {
  const authProvider = useStore((s) => s.authProvider);
  return (
    <div className="auth-gate">
      <div className="auth-gate-brand handwritten">◇ Codebase Visualizer</div>
      <p className="auth-gate-tag">
        Turn any repository into an interactive, Excalidraw-style architecture diagram.
      </p>
      {authProvider === 'clerk' ? (
        <Suspense fallback={null}>
          <ClerkSignIn />
        </Suspense>
      ) : (
        <AuthModal inline />
      )}
    </div>
  );
}

export default function App() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Boot: restore the session, then join a shared diagram if the URL has one.
  const user = useStore((s) => s.user);
  const authRequired = useStore((s) => s.authRequired);
  useEffect(() => {
    api
      .me()
      .then((me) => useStore.getState().setAuth(me.user, me.authRequired))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (authRequired && !user) return; // wait for sign-in before joining
    const shared = new URLSearchParams(location.search).get('d');
    if (!shared || useStore.getState().collabActive) return;
    api
      .getDiagram(shared)
      .then(({ diagram }) => {
        useStore.getState().loadDiagram(diagram);
        useStore.temporal.getState().clear();
        joinCollab(shared);
      })
      .catch(() => history.replaceState(null, '', location.pathname));
  }, [authRequired, user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      // A text editor is open (its focus may still be settling) — typing must
      // never trigger tool hotkeys mid-edit.
      if (document.querySelector('.react-flow__node textarea')) return;
      // Enter edits the selected annotation's text (Excalidraw parity).
      if (e.key === 'Enter') {
        const s = useStore.getState();
        if (s.selectedAnnotationIds.length === 1) {
          const a = s.annotations.find((x) => x.id === s.selectedAnnotationIds[0]);
          if (a && (a.type === 'label' || a.type === 'sticky' || a.type === 'shape')) {
            e.preventDefault();
            s.setEditingAnnotation(a.id);
            return;
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const s = useStore.getState();
        if (s.selectedAnnotationIds.length) s.duplicateAnnotations(s.selectedAnnotationIds);
        return;
      }
      // Arrow keys nudge the selection: one grid cell, or 1px with Shift.
      if (e.key.startsWith('Arrow')) {
        const s = useStore.getState();
        if (s.selectedAnnotationIds.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 20;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        for (const id of s.selectedAnnotationIds) {
          const a = s.annotations.find((x) => x.id === id);
          if (a) s.updateAnnotation(id, { position: { x: a.position.x + dx, y: a.position.y + dy } });
        }
        return;
      }
      if (e.key === 'Escape') {
        useStore.getState().setTool('select');
        return;
      }
      if (e.key.toLowerCase() === 'q' && !e.metaKey && !e.ctrlKey) {
        useStore.getState().toggleToolLocked();
        return;
      }
      // Excalidraw bindings: letters and numbers both work.
      const toolByKey: Record<string, Tool> = {
        v: 'select',
        '1': 'select',
        h: 'hand',
        r: 'shape-rect',
        '2': 'shape-rect',
        d: 'shape-diamond',
        '3': 'shape-diamond',
        o: 'shape-ellipse',
        '4': 'shape-ellipse',
        a: 'arrow',
        '5': 'arrow',
        l: 'line',
        '6': 'line',
        p: 'draw',
        x: 'draw',
        '7': 'draw',
        t: 'label',
        '8': 'label',
        s: 'sticky',
        e: 'eraser',
        '0': 'eraser',
      };
      const tool = toolByKey[e.key.toLowerCase()];
      if (tool && !e.metaKey && !e.ctrlKey) useStore.getState().setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = useStore((s) => s.view);
  if (authRequired && !user) return <AuthGate />;
  if (view === 'dashboard') return <Dashboard />;

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <div className="canvas-wrap">
          <ReactFlowProvider>
            <FlowCanvas />
          </ReactFlowProvider>
          <Toolbar />
        </div>
        <DetailPanel />
      </div>
    </div>
  );
}
