import type {
  AnalysisProgressEvent,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  Diagram,
  GetAnalysisResponse,
  RepoSource,
  ServerConfigResponse,
} from '@codeviz/shared';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => fetch('/api/config').then((r) => json<ServerConfigResponse>(r)),

  createAnalysis: (source: RepoSource, skipEnrichment?: boolean) =>
    fetch('/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, skipEnrichment } satisfies CreateAnalysisRequest),
    }).then((r) => json<CreateAnalysisResponse>(r)),

  getAnalysis: (id: string) => fetch(`/api/analyses/${id}`).then((r) => json<GetAnalysisResponse>(r)),

  /** Subscribe to analysis progress; resolves when done, rejects on error phase. */
  watchAnalysis(id: string, onEvent: (ev: AnalysisProgressEvent) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const es = new EventSource(`/api/analyses/${id}/events`);
      es.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as AnalysisProgressEvent;
        onEvent(ev);
        if (ev.phase === 'done') {
          es.close();
          resolve();
        } else if (ev.phase === 'error') {
          es.close();
          reject(new Error(ev.message));
        }
      };
      es.onerror = () => {
        es.close();
        reject(new Error('progress stream disconnected'));
      };
    });
  },

  listDiagrams: () =>
    fetch('/api/diagrams').then((r) =>
      json<{ diagrams: Pick<Diagram, 'id' | 'name' | 'analysisId' | 'updatedAt'>[] }>(r),
    ),

  getDiagram: (id: string) => fetch(`/api/diagrams/${id}`).then((r) => json<{ diagram: Diagram }>(r)),

  saveDiagram: (diagram: Omit<Diagram, 'updatedAt'>) =>
    fetch(`/api/diagrams/${diagram.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagram }),
    }).then((r) => json<{ diagram: Diagram }>(r)),
};
