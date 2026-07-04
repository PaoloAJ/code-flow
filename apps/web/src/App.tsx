import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './panels/TopBar';
import { Toolbar } from './panels/Toolbar';
import { DetailPanel } from './panels/DetailPanel';
import { FlowCanvas } from './canvas/FlowCanvas';
import { redo, undo, useStore, type Tool } from './store';

export default function App() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
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
