import type {
  AnalysisProgressEvent,
  FileRole,
  Language,
  OutboundCall,
  RouteDef,
} from '@codeviz/shared';

export interface AnalyzeOptions {
  repoCacheDir: string;
  /** When set, run LLM enrichment with this key. */
  anthropicApiKey?: string;
  onProgress?: (ev: AnalysisProgressEvent) => void;
  /** Caps to keep pathological repos bounded. */
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface RepoFile {
  /** Repo-relative path with forward slashes. */
  relPath: string;
  absPath: string;
  language: Language;
  bytes: number;
}

export interface ImportRef {
  /** The raw specifier as written in source ('./util', 'boto3', 'a.b.C'…). */
  specifier: string;
  line: number;
}

export interface FileFacts {
  file: RepoFile;
  loc: number;
  role: FileRole;
  imports: ImportRef[];
  routes: RouteDef[];
  outboundCalls: OutboundCall[];
  /** file:line notes for calls made inside loops (bottleneck signal). */
  callsInLoops: { file: string; line: number; note: string }[];
}

export interface InfraFunction {
  name: string;
  /** Handler as written in config, e.g. "src/handlers/foo.handler". */
  handler: string;
  configFile: string;
}

export interface InfraFacts {
  functions: InfraFunction[];
  composeServices: { name: string; configFile: string; buildContext?: string }[];
}
