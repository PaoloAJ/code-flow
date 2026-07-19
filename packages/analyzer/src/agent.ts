import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { AnalysisGraph } from '@codeviz/shared';
import type { RepoFile } from './types.js';

const MODEL = 'claude-opus-4-8';
const MAX_ITERATIONS = 40;
const MAX_TOKENS = 16_000;
const MAX_DIR_ENTRIES = 200;
const MAX_READ_LINES = 400;
const MAX_READ_CHARS = 16_000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_GREP_MATCHES = 80;
const MAX_GREP_BYTES = 30_000_000;
const MAX_RISKS = 4;
const MAX_RESPONSIBILITIES = 5;

/** Directories never worth exploring; mirrors the census ignore list. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.terraform',
]);

export interface AgentFs {
  rootDir: string;
  /** Census-indexed source + config files; this is the grep scope. */
  files: RepoFile[];
}

/** Resolve a model-supplied path and reject anything outside the repo root. */
function resolveInRoot(rootDir: string, rel: string): string {
  const root = fs.realpathSync(path.resolve(rootDir));
  const abs = path.resolve(root, rel);
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`path escapes the repository root: ${rel}`);
  }
  return real;
}

export function listDir(ctx: AgentFs, rel: string): string {
  let abs: string;
  try {
    abs = resolveInRoot(ctx.rootDir, rel || '.');
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : err}`;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    return `Error: cannot list ${rel}: ${err instanceof Error ? err.message : err}`;
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => `${e.name}/`)
    .sort();
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => {
      let size = 0;
      try {
        size = fs.statSync(path.join(abs, e.name)).size;
      } catch {
        // stat race; report 0
      }
      return `${e.name} (${size} bytes)`;
    })
    .sort();
  const lines = [...dirs, ...files];
  const capped = lines.slice(0, MAX_DIR_ENTRIES);
  if (lines.length > capped.length) {
    capped.push(`… ${lines.length - capped.length} more entries truncated`);
  }
  return capped.join('\n') || '(empty directory)';
}

export function readFile(ctx: AgentFs, rel: string, startLine = 1, endLine?: number): string {
  let abs: string;
  try {
    abs = resolveInRoot(ctx.rootDir, rel);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : err}`;
  }
  let text: string;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return `Error: not a file: ${rel}`;
    if (stat.size > MAX_FILE_BYTES) return `Error: file too large (${stat.size} bytes): ${rel}`;
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return `Error: cannot read ${rel}: ${err instanceof Error ? err.message : err}`;
  }
  const all = text.split('\n');
  const start = Math.max(1, Math.floor(startLine));
  const end = Math.min(endLine ?? start + MAX_READ_LINES - 1, all.length, start + MAX_READ_LINES - 1);
  if (start > all.length) return `Error: start_line ${start} is past the end of the file (${all.length} lines)`;
  const out: string[] = [];
  let chars = 0;
  for (let i = start; i <= end; i++) {
    const line = `${i}\t${all[i - 1]}`;
    chars += line.length + 1;
    if (chars > MAX_READ_CHARS) {
      out.push(`… truncated at ${MAX_READ_CHARS} chars; request a narrower range`);
      return out.join('\n');
    }
    out.push(line);
  }
  if (end < all.length) {
    out.push(`… file continues to line ${all.length}; request more with start_line=${end + 1}`);
  }
  return out.join('\n');
}

export function grepRepo(ctx: AgentFs, pattern: string, pathContains?: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return `Error: invalid regex: ${err instanceof Error ? err.message : err}`;
  }
  const matches: string[] = [];
  let scanned = 0;
  for (const file of ctx.files) {
    if (pathContains && !file.relPath.includes(pathContains)) continue;
    if (scanned > MAX_GREP_BYTES) {
      matches.push('… byte-scan budget exhausted; narrow the search with path_contains');
      break;
    }
    let text: string;
    try {
      text = fs.readFileSync(file.absPath, 'utf8');
    } catch {
      continue;
    }
    scanned += text.length;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      matches.push(`${file.relPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      if (matches.length >= MAX_GREP_MATCHES) {
        matches.push(`… capped at ${MAX_GREP_MATCHES} matches; narrow the pattern`);
        return matches.join('\n');
      }
    }
  }
  return matches.length ? matches.join('\n') : 'No matches.';
}

const SYSTEM_PROMPT = `You are a senior software architect mapping a repository for an architecture diagram tool.
You have read-only tools (list_dir, read_file, grep) to explore the repository.

A deterministic analyzer has already produced a component graph (provided in the first message) with metrics, routes, import edges, and static bottleneck warnings. Your job is to verify and deepen that graph, then write a repository map.

Working rules:
- Be selective. You have a limited tool-call budget (stated in the first message). Prioritize entry points, route handlers, files implicated in static warnings, and the largest components. Do not read every file.
- Name individual functions only when they are an interface (route handler, queue consumer, job entry point) or a risk (hot loop, N+1 access, shared mutable state, missing validation, unbounded growth).
- Every claim about code must cite file:line based on what you actually read or grepped. Never invent routes, dependencies, or infrastructure.
- Reserve enough budget to finish: when the budget is close to exhausted, stop exploring and write the report with what you have.

Final deliverable: after exploring, reply with ONLY a markdown document (no preamble), structured as:

# <repo name> — repository map
## Architecture
Short narrative: what the system is and how the components interact.
## Components
One "### \`<component-id>\` — <name>" subsection per component, each containing:
- **Purpose** (1-2 sentences)
- **Key files / functions** (only load-bearing ones, with file:line)
- **Interfaces** (routes exposed, outbound calls, queues/db touched)
- **Risks & weak points** (bulleted; each tagged low/medium/high with file:line evidence; omit the bullet list if none)
## Cross-cutting risks
Anything spanning components (shared DB, cycles, auth gaps, operational weak points).

Keep each component subsection under ~100 lines (usually far less); trivial components get a one-liner.`;

const PARSE_SYSTEM = `You convert a repository-map report into structured per-component findings for a diagram tool.
Use only component ids from the provided list, and only claims present in the report — do not add new risks or invent evidence.`;

const FindingsSchema = z.object({
  components: z
    .array(
      z.object({
        id: z.string().describe('Component id, exactly as listed'),
        summary: z.string().describe('2-3 sentence summary of what this component does'),
        responsibilities: z.array(z.string()).describe('Up to 5 key responsibilities'),
        risks: z
          .array(
            z.object({
              severity: z.enum(['low', 'medium', 'high']),
              reason: z.string().describe('One-sentence statement of the risk or weak point'),
              evidence: z.string().describe('file:line citations from the report supporting this'),
            }),
          )
          .describe('Up to 4 realistic bottlenecks/weak points from the report; empty if none'),
      }),
    )
    .describe('One entry per component that the report covers'),
});

function agentOverview(graph: AnalysisGraph): string {
  const comps = graph.components.map((c) => {
    const head =
      `- ${c.id} — "${c.name}" (${c.type}, path: ${c.path || '.'}): ` +
      `${c.metrics.fileCount} files, ${c.metrics.loc} LOC, ${c.routes.length} routes, ` +
      `fanIn ${c.metrics.fanIn}, fanOut ${c.metrics.fanOut}`;
    const warns = c.bottlenecks
      .filter((b) => b.source === 'static')
      .map((b) => `    [static ${b.severity}] ${b.reason} — ${b.evidence}`);
    return [head, ...warns].join('\n');
  });
  const edges = graph.edges.map((e) => `- ${e.source} -${e.kind}-> ${e.target} (${e.count})`);
  return [
    `Repository: ${graph.repo.name}`,
    `Components (${graph.components.length}):`,
    comps.join('\n'),
    `Edges:`,
    edges.join('\n') || '(none)',
  ].join('\n\n');
}

export interface SurveyOptions {
  rootDir: string;
  /** Census output (sources + configs); scopes grep and seeds nothing else. */
  files: RepoFile[];
  apiKey: string;
  onProgress?: (message: string) => void;
  maxIterations?: number;
}

/**
 * Agentic repository survey: explores the repo with read-only tools, writes a
 * markdown repo map onto graph.repoMap, and merges structured per-component
 * findings (summary, responsibilities, llm bottlenecks) into the graph.
 * Throws on failure — callers treat that as non-fatal.
 */
export async function surveyRepo(graph: AnalysisGraph, opts: SurveyOptions): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const progress = opts.onProgress ?? (() => {});
  const ctx: AgentFs = { rootDir: opts.rootDir, files: opts.files };
  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;

  let toolCalls = 0;
  const note = (msg: string) => {
    toolCalls++;
    progress(`Exploring (${toolCalls}): ${msg}`);
  };

  const tools = [
    betaZodTool({
      name: 'list_dir',
      description:
        'List a directory in the repository. Directories end with "/". Use "." for the repo root.',
      inputSchema: z.object({
        path: z.string().describe('Repo-relative directory path; "." for the root'),
      }),
      run: ({ path: p }) => {
        note(`list ${p}`);
        return listDir(ctx, p);
      },
    }),
    betaZodTool({
      name: 'read_file',
      description: `Read a repository file; returns up to ${MAX_READ_LINES} numbered lines per call. Prefer targeted line ranges over whole files.`,
      inputSchema: z.object({
        path: z.string().describe('Repo-relative file path'),
        start_line: z.number().int().min(1).optional().describe('1-based first line (default 1)'),
        end_line: z.number().int().min(1).optional().describe('1-based last line, inclusive'),
      }),
      run: ({ path: p, start_line, end_line }) => {
        note(`read ${p}${start_line ? `:${start_line}` : ''}`);
        return readFile(ctx, p, start_line, end_line);
      },
    }),
    betaZodTool({
      name: 'grep',
      description:
        'Regex-search every analyzed source/config file. Returns "path:line: text" matches. Use to find handlers, callers, or config by pattern.',
      inputSchema: z.object({
        pattern: z.string().describe('JavaScript regular expression, matched per line'),
        path_contains: z
          .string()
          .optional()
          .describe('Only search files whose repo-relative path contains this substring'),
      }),
      run: ({ pattern, path_contains }) => {
        note(`grep /${pattern}/${path_contains ? ` in *${path_contains}*` : ''}`);
        return grepRepo(ctx, pattern, path_contains);
      },
    }),
  ];

  progress('Surveying repository structure…');
  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    max_iterations: maxIterations,
    system: [
      // Stable prefix (tools render before system) — cache across the whole loop.
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content:
          `${agentOverview(graph)}\n\n` +
          `Tool budget: at most ${maxIterations} tool-use rounds. ` +
          `Explore, then produce the repository map as specified.`,
      },
    ],
    tools,
  });

  const repoMap = final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (repoMap.length < 200) {
    throw new Error(
      `survey produced no usable report (stop_reason ${final.stop_reason}, ${repoMap.length} chars)`,
    );
  }
  graph.repoMap = repoMap;

  progress('Extracting structured findings from the map…');
  const parsed = await client.messages.parse({
    model: MODEL,
    max_tokens: 8_000,
    thinking: { type: 'adaptive' },
    system: PARSE_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Component ids:\n${graph.components.map((c) => `- ${c.id}`).join('\n')}\n\n` +
          `Report:\n\n${repoMap}`,
      },
    ],
    output_config: { format: zodOutputFormat(FindingsSchema) },
  });
  const findings = parsed.parsed_output;
  if (!findings) throw new Error('findings extraction returned no parsed output');

  const byId = new Map(graph.components.map((c) => [c.id, c]));
  for (const f of findings.components) {
    const comp = byId.get(f.id);
    if (!comp) continue;
    comp.summary = f.summary;
    comp.responsibilities = f.responsibilities.slice(0, MAX_RESPONSIBILITIES);
    for (const risk of f.risks.slice(0, MAX_RISKS)) {
      comp.bottlenecks.push({ ...risk, source: 'llm' });
    }
  }
}
