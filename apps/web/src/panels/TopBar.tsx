import { useEffect, useState } from 'react';
import { toPng } from 'html-to-image';
import type { AnalysisProgressEvent, Diagram, RepoSource } from '@codeviz/shared';
import { api } from '../api';
import { useStore } from '../store';
import { autoLayout } from '../layout';
import { demoGraph } from '../mock';

export function TopBar() {
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [allowLocal, setAllowLocal] = useState(true);
  const [showLoad, setShowLoad] = useState(false);
  const [savedDiagrams, setSavedDiagrams] = useState<
    Pick<Diagram, 'id' | 'name' | 'analysisId' | 'updatedAt'>[]
  >([]);

  const graph = useStore((s) => s.graph);
  const diagramName = useStore((s) => s.diagramName);
  const setDiagramName = useStore((s) => s.setDiagramName);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  useEffect(() => {
    api.config().then((c) => setAllowLocal(c.allowLocalPaths)).catch(() => {});
  }, []);

  const applyGraph = async (g: typeof demoGraph, analysisId: string | null) => {
    const positions = await autoLayout(g);
    useStore.getState().setGraph(g, analysisId);
    useStore.getState().setPositions(positions);
    useStore.temporal.getState().clear();
  };

  const analyze = async () => {
    const input = repoInput.trim();
    if (!input) return;
    const source: RepoSource = input.startsWith('http')
      ? { type: 'github', url: input.replace(/\/$/, '') }
      : { type: 'local', path: input };
    setBusy(true);
    setNote({ text: 'Starting analysis…' });
    try {
      const { id } = await api.createAnalysis(source);
      await api.watchAnalysis(id, (ev: AnalysisProgressEvent) =>
        setNote({ text: ev.message + (ev.progress != null ? ` (${Math.round(ev.progress * 100)}%)` : '') }),
      );
      const { graph: g } = await api.getAnalysis(id);
      if (!g) throw new Error('analysis finished without a graph');
      await applyGraph(g, id);
      setNote({ text: `Analyzed ${g.repo.name}: ${g.components.length} components, ${g.edges.length} edges` });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const state = useStore.getState();
    if (!state.graph) return;
    const id = state.newDiagramId();
    try {
      await api.saveDiagram({
        id,
        analysisId: state.analysisId ?? '',
        name: state.diagramName,
        graph: state.graph,
        nodePositions: state.positions,
        annotations: state.annotations,
        annotationEdges: state.annotationEdges,
      });
      setNote({ text: 'Diagram saved' });
    } catch (err) {
      setNote({ text: `Save failed: ${err instanceof Error ? err.message : err}`, error: true });
    }
  };

  const openLoad = async () => {
    try {
      const { diagrams } = await api.listDiagrams();
      setSavedDiagrams(diagrams);
      setShowLoad(true);
    } catch (err) {
      setNote({ text: `Load failed: ${err instanceof Error ? err.message : err}`, error: true });
    }
  };

  const loadDiagram = async (id: string) => {
    try {
      const { diagram } = await api.getDiagram(id);
      useStore.getState().loadDiagram(diagram);
      useStore.temporal.getState().clear();
      setShowLoad(false);
      setNote({ text: `Loaded “${diagram.name}”` });
    } catch (err) {
      setNote({ text: `Load failed: ${err instanceof Error ? err.message : err}`, error: true });
    }
  };

  const exportPng = async () => {
    const el = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!el) return;
    const dataUrl = await toPng(el, {
      backgroundColor: theme === 'dark' ? '#0d0d0d' : '#ffffff',
      pixelRatio: 2,
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${diagramName.replace(/\s+/g, '-')}.png`;
    a.click();
  };

  return (
    <header className="topbar">
      <div className="group grow">
        <span className="brand">◇ Codebase Visualizer</span>
        <input
          className="repo-input"
          type="text"
          placeholder={allowLocal ? 'https://github.com/owner/repo or /local/path' : 'https://github.com/owner/repo'}
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && analyze()}
          disabled={busy}
        />
        <button className="primary" onClick={analyze} disabled={busy || !repoInput.trim()}>
          {busy ? 'Analyzing…' : 'Analyze'}
        </button>
        <button className="ghost" onClick={() => applyGraph(demoGraph, null)} disabled={busy}>
          Demo
        </button>
        {note && <span className={`progress-note${note.error ? ' error' : ''}`}>{note.text}</span>}
      </div>
      <div className="group">
        <input
          type="text"
          value={diagramName}
          onChange={(e) => setDiagramName(e.target.value)}
          style={{ width: 150 }}
          title="Diagram name"
        />
        <button className="ghost" onClick={save} disabled={!graph}>
          Save
        </button>
        <button className="ghost" onClick={openLoad}>
          Open
        </button>
        <button className="ghost" onClick={exportPng} disabled={!graph}>
          Export PNG
        </button>
        <button
          className="ghost icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
      </div>

      {showLoad && (
        <div className="modal-backdrop" onClick={() => setShowLoad(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Open diagram</h2>
            {savedDiagrams.length === 0 && <div className="empty-hint">No saved diagrams yet.</div>}
            {savedDiagrams.map((d) => (
              <div key={d.id} className="diagram-row" onClick={() => loadDiagram(d.id)}>
                <span>{d.name}</span>
                <span className="when">{new Date(d.updatedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
