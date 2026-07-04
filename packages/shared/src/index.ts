// ── Graph schema ─────────────────────────────────────────────────────────────

export type Language =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'kotlin'
  | 'go'
  | 'other';

export type ComponentType =
  | 'service'
  | 'lambda'
  | 'frontend'
  | 'library'
  | 'infra'
  | 'database'
  | 'external'
  | 'unknown';

/** Architectural role of a source file, classified from path + content signals. */
export type FileRole =
  | 'entrypoint'
  | 'routes'
  | 'service'
  | 'model'
  | 'data'
  | 'client'
  | 'config'
  | 'test'
  | 'util';

export interface RouteDef {
  method: string; // GET | POST | * ...
  path: string;
  file: string;
  line: number;
}

export type OutboundKind = 'http' | 'lambda' | 'db' | 'queue' | 'storage' | 'other';

export interface OutboundCall {
  kind: OutboundKind;
  /** Best-effort target: a URL, function name, table, topic, client name… */
  target: string;
  file: string;
  line: number;
}

export interface ComponentMetrics {
  loc: number;
  fileCount: number;
  fanIn: number;
  fanOut: number;
}

export type BottleneckSeverity = 'low' | 'medium' | 'high';

export interface Bottleneck {
  severity: BottleneckSeverity;
  reason: string;
  /** Evidence: rule name, file:line refs, or LLM justification. */
  evidence: string;
  source: 'static' | 'llm';
}

export interface ComponentNodeData {
  id: string;
  name: string;
  /** Repo-relative path of the component root. */
  path: string;
  type: ComponentType;
  languages: Language[];
  files: string[];
  routes: RouteDef[];
  outboundCalls: OutboundCall[];
  metrics: ComponentMetrics;
  /** LLM or heuristic summary. */
  summary?: string;
  responsibilities?: string[];
  bottlenecks: Bottleneck[];
  /** For database/external nodes: the technology or host ("PostgreSQL", "api.stripe.com"). */
  kindDetail?: string;
  /** How many files play each architectural role (controllers, models, tests…). */
  roleCounts?: Partial<Record<FileRole, number>>;
}

export type EdgeKind = 'import' | 'http' | 'invoke' | 'queue' | 'db';

export interface EdgeDetail {
  file: string;
  line: number;
  note?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  count: number;
  details: EdgeDetail[];
}

export interface RepoSourceLocal {
  type: 'local';
  path: string;
}

export interface RepoSourceGithub {
  type: 'github';
  url: string;
  ref?: string;
}

export type RepoSource = RepoSourceLocal | RepoSourceGithub;

export interface AnalysisGraph {
  repo: {
    name: string;
    source: RepoSource;
    analyzedAt: string; // ISO 8601
  };
  components: ComponentNodeData[];
  edges: GraphEdge[];
}

// ── Analysis jobs ────────────────────────────────────────────────────────────

export type AnalysisPhase =
  | 'queued'
  | 'cloning'
  | 'scanning'
  | 'parsing'
  | 'clustering'
  | 'enriching'
  | 'done'
  | 'error';

export interface AnalysisProgressEvent {
  phase: AnalysisPhase;
  message: string;
  /** 0..1 where meaningful */
  progress?: number;
}

export interface AnalysisJob {
  id: string;
  source: RepoSource;
  phase: AnalysisPhase;
  error?: string;
  createdAt: string;
  graph?: AnalysisGraph;
}

/** Job summary as returned by list/get endpoints (graph omitted until done). */
export interface AnalysisJobSummary {
  id: string;
  source: RepoSource;
  phase: AnalysisPhase;
  error?: string;
  createdAt: string;
}

// ── Diagram (user annotation layer) ─────────────────────────────────────────

export interface XY {
  x: number;
  y: number;
}

/** Style fields shared by drawn annotations (Excalidraw-style). */
export interface DrawnStyle {
  stroke: string;
  strokeWidth: number;
  opacity: number;
  /** roughjs seed so the sketchy rendering is stable across renders. */
  seed: number;
}

export type AnnotationNode =
  | {
      id: string;
      type: 'sticky';
      position: XY;
      width: number;
      height: number;
      text: string;
      color: string;
      opacity: number;
    }
  | {
      id: string;
      type: 'label';
      position: XY;
      text: string;
      fontSize: number;
      color: string;
      opacity: number;
    }
  | ({
      id: string;
      type: 'shape';
      position: XY;
      width: number;
      height: number;
      shape: 'rect' | 'ellipse' | 'diamond';
      fill: string;
      fillStyle: 'none' | 'hachure' | 'solid';
    } & DrawnStyle)
  | ({
      id: string;
      type: 'freehand';
      position: XY;
      /** Points relative to position. */
      points: [number, number, number][];
    } & DrawnStyle)
  | ({
      id: string;
      type: 'arrow';
      position: XY;
      /** End point relative to position (start). */
      end: XY;
      /** false renders a plain line (the Line tool); default true. */
      head?: boolean;
      label?: string;
    } & DrawnStyle);

export interface AnnotationEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Diagram {
  id: string;
  analysisId: string;
  name: string;
  /**
   * The generated graph is embedded so saved diagrams survive server
   * restarts (analysis jobs are in-memory).
   */
  graph: AnalysisGraph | null;
  /** Component node id -> canvas position (user-adjusted layout). */
  nodePositions: Record<string, XY>;
  annotations: AnnotationNode[];
  annotationEdges: AnnotationEdge[];
  viewport?: { x: number; y: number; zoom: number };
  updatedAt: string;
}

// ── API contracts ────────────────────────────────────────────────────────────

export interface CreateAnalysisRequest {
  source: RepoSource;
  /** Skip LLM enrichment even if a key is configured. */
  skipEnrichment?: boolean;
}

export interface CreateAnalysisResponse {
  id: string;
}

export interface GetAnalysisResponse {
  job: AnalysisJobSummary;
  graph?: AnalysisGraph;
}

export interface SaveDiagramRequest {
  diagram: Omit<Diagram, 'updatedAt'>;
}

export interface ServerConfigResponse {
  allowLocalPaths: boolean;
  enrichmentAvailable: boolean;
}
