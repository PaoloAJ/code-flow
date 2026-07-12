import type {
  AnalysisProgressEvent,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  Diagram,
  DiagramListItem,
  GetAnalysisResponse,
  LoginRequest,
  MeResponse,
  RepoSource,
  ServerConfigResponse,
  SignupRequest,
  User,
} from '@codeviz/shared';

// ── auth token plumbing (Clerk) ─────────────────────────────────────────────
// In Clerk mode a bridge component registers a session-token getter; every
// request then carries `Authorization: Bearer`. Local mode uses cookies and
// leaves this null.

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: typeof tokenGetter) {
  tokenGetter = getter;
}

export async function authToken(): Promise<string | null> {
  try {
    return tokenGetter ? await tokenGetter() : null;
  } catch {
    return null;
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await authToken();
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return json<T>(await fetch(path, { ...init, headers }));
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  config: () => request<ServerConfigResponse>('/api/config'),

  me: () => request<MeResponse>('/api/auth/me'),

  signup: (body: SignupRequest) => request<{ user: User }>('/api/auth/signup', post(body)),

  login: (body: LoginRequest) => request<{ user: User }>('/api/auth/login', post(body)),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  createAnalysis: (source: RepoSource, skipEnrichment?: boolean) =>
    request<CreateAnalysisResponse>(
      '/api/analyses',
      post({ source, skipEnrichment } satisfies CreateAnalysisRequest),
    ),

  getAnalysis: (id: string) => request<GetAnalysisResponse>(`/api/analyses/${id}`),

  /** Subscribe to analysis progress; resolves when done, rejects on error phase. */
  async watchAnalysis(id: string, onEvent: (ev: AnalysisProgressEvent) => void): Promise<void> {
    // EventSource can't send headers — Clerk mode passes the token in the URL.
    const token = await authToken();
    const url = `/api/analyses/${id}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    return new Promise((resolve, reject) => {
      const es = new EventSource(url);
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

  listDiagrams: () => request<{ diagrams: DiagramListItem[] }>('/api/diagrams'),

  getDiagram: (id: string) => request<{ diagram: Diagram }>(`/api/diagrams/${id}`),

  deleteDiagram: (id: string) =>
    request<{ ok: boolean }>(`/api/diagrams/${id}`, { method: 'DELETE' }),

  saveDiagram: (diagram: Omit<Diagram, 'updatedAt'>) =>
    request<{ diagram: Diagram }>(`/api/diagrams/${diagram.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagram }),
    }),
};
