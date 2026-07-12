import { useEffect, useState } from 'react';
import type { AnalysisProgressEvent, RepoSource } from '@codeviz/shared';
import { api } from '../api';
import { useStore } from '../store';
import { autoLayout } from '../layout';
import { demoGraph } from '../mock';
import { joinCollab, leaveCollab } from '../collab';
import { AuthControls } from './AuthControls';

export function TopBar() {
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [allowLocal, setAllowLocal] = useState(true);

  const graph = useStore((s) => s.graph);
  const diagramName = useStore((s) => s.diagramName);
  const setDiagramName = useStore((s) => s.setDiagramName);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const peers = useStore((s) => s.peers);
  const collabActive = useStore((s) => s.collabActive);

  useEffect(() => {
    api.config().then((c) => setAllowLocal(c.allowLocalPaths)).catch(() => {});
  }, []);

  const toDashboard = () => {
    leaveCollab();
    if (location.search) history.replaceState(null, '', location.pathname);
    useStore.getState().setView('dashboard');
  };

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

  const save = async (): Promise<string | null> => {
    const state = useStore.getState();
    if (!state.graph && state.annotations.length === 0) return null;
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
      return id;
    } catch (err) {
      setNote({ text: `Save failed: ${err instanceof Error ? err.message : err}`, error: true });
      return null;
    }
  };

  const share = async () => {
    if (collabActive) {
      leaveCollab();
      history.replaceState(null, '', location.pathname);
      setNote({ text: 'Left the live session' });
      return;
    }
    const id = await save();
    if (!id) return;
    const url = `${location.origin}${location.pathname}?d=${id}`;
    history.replaceState(null, '', url);
    joinCollab(id);
    try {
      await navigator.clipboard.writeText(url);
      setNote({ text: 'Live link copied — anyone with it can draw with you' });
    } catch {
      setNote({ text: `Live at ${url}` });
    }
  };

  const exportPng = async () => {
    const el = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!el) return;
    const { toPng } = await import('html-to-image'); // only loaded on export
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
        <button className="brand brand-btn" title="Back to your diagrams" onClick={toDashboard}>
          ◇ Codebase Visualizer
        </button>
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
        {peers.length > 0 && (
          <span className="peer-avatars" title={peers.map((p) => p.name).join(', ')}>
            {peers.slice(0, 4).map((p) => (
              <span key={p.id} className="peer-avatar" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            {peers.length > 4 && <span className="peer-avatar more">+{peers.length - 4}</span>}
          </span>
        )}
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
        <button
          className={collabActive ? 'primary' : 'ghost'}
          onClick={share}
          title={
            collabActive
              ? 'Live session running — click to leave'
              : 'Save and copy a live link others can join'
          }
        >
          {collabActive ? '● Live' : 'Share'}
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
        <AuthControls />
      </div>
    </header>
  );
}
