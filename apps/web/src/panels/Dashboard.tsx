import { useCallback, useEffect, useState } from 'react';
import type { DiagramListItem } from '@codeviz/shared';
import { api } from '../api';
import { useStore } from '../store';
import { AuthControls } from './AuthControls';

function relativeTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Landing screen: your saved diagrams as cards, plus "new diagram". */
export function Dashboard() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const user = useStore((s) => s.user);
  const authRequired = useStore((s) => s.authRequired);
  const [items, setItems] = useState<DiagramListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (authRequired && !user) return; // the auth gate is showing
    api
      .listDiagrams()
      .then(({ diagrams }) => setItems(diagrams))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [authRequired, user]);

  useEffect(refresh, [refresh]);

  const open = async (id: string) => {
    try {
      const { diagram } = await api.getDiagram(id);
      useStore.getState().loadDiagram(diagram); // also switches to the canvas
      useStore.temporal.getState().clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteDiagram(id);
      setItems((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="dashboard">
      <header className="dash-header">
        <span className="brand">◇ Codebase Visualizer</span>
        <span className="spacer" />
        <button
          className="ghost icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
        <AuthControls />
      </header>

      <main className="dash-main">
        <div className="dash-title-row">
          <h1>Your diagrams</h1>
          <button className="primary" onClick={() => useStore.getState().newDiagram()}>
            + New diagram
          </button>
        </div>
        {error && <div className="auth-error">{error}</div>}

        <div className="dash-grid">
          {items === null && !error && <div className="empty-hint">Loading…</div>}
          {items?.length === 0 && (
            <div className="dash-empty">
              <div className="title handwritten">Nothing here yet</div>
              <div>
                Create a diagram, analyze a repository, and hit <b>Save</b> — it will show up here.
              </div>
            </div>
          )}
          {items?.map((d) => (
            <div key={d.id} className="dash-card" onClick={() => open(d.id)}>
              <div className="dash-card-name">{d.name}</div>
              {d.repo && <div className="dash-card-repo">⌥ {d.repo}</div>}
              <div className="dash-card-meta">
                {d.components > 0 && <span>{d.components} components</span>}
                {d.annotations > 0 && <span>{d.annotations} drawings</span>}
                {d.components === 0 && d.annotations === 0 && <span>empty</span>}
              </div>
              <div className="dash-card-footer">
                <span className="when">{relativeTime(d.updatedAt)}</span>
                <button
                  className="ghost icon-btn danger"
                  title="Delete diagram"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(d.id);
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
