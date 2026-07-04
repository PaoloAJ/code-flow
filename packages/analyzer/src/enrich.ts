import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { AnalysisGraph, ComponentNodeData } from '@codeviz/shared';
import type { FileFacts } from './types.js';

const MODEL = 'claude-opus-4-8';
const MAX_COMPONENTS = 30;
const CONCURRENCY = 3;
const EXCERPT_LINES = 80;
const MAX_EXCERPT_CHARS = 12_000;

const EnrichmentSchema = z.object({
  summary: z.string().describe('2-3 sentence summary of what this component does'),
  responsibilities: z.array(z.string()).describe('Up to 5 key responsibilities'),
  bottleneckRisks: z.array(
    z.object({
      severity: z.enum(['low', 'medium', 'high']),
      reason: z.string().describe('One-sentence statement of the risk'),
      evidence: z.string().describe('What in the provided facts supports this'),
    }),
  ).describe('Up to 4 likely performance or scaling bottlenecks; empty if none'),
});

const SYSTEM_PROMPT = `You are a senior software architect reviewing a codebase for an architecture diagram.
For each component you are given extracted facts (routes, outbound calls, metrics, static warnings) and short file excerpts.
Write a crisp technical summary and flag realistic performance/scaling bottlenecks only when the evidence supports them.
Do not invent routes, dependencies, or infrastructure that is not in the provided facts.`;

function repoOverview(graph: AnalysisGraph): string {
  const lines = graph.components.map(
    (c) =>
      `- ${c.name} (${c.type}, ${c.path}): ${c.metrics.fileCount} files, ${c.metrics.loc} LOC, ` +
      `${c.routes.length} routes, fanIn ${c.metrics.fanIn}, fanOut ${c.metrics.fanOut}`,
  );
  const edges = graph.edges.map((e) => `- ${e.source} -${e.kind}-> ${e.target} (${e.count})`);
  return `Repository: ${graph.repo.name}\n\nComponents:\n${lines.join('\n')}\n\nEdges:\n${edges.join('\n')}`;
}

function componentPrompt(c: ComponentNodeData, facts: FileFacts[], rootDir: string): string {
  const routes = c.routes.slice(0, 30).map((r) => `${r.method} ${r.path} (${r.file}:${r.line})`);
  const calls = c.outboundCalls
    .slice(0, 30)
    .map((o) => `${o.kind}: ${o.target} (${o.file}:${o.line})`);
  const staticFlags = c.bottlenecks.map((b) => `[${b.severity}] ${b.reason} — ${b.evidence}`);

  // Pick a few representative files: route-bearing, then largest.
  const interesting = [...facts]
    .sort((a, b) => b.routes.length - a.routes.length || b.loc - a.loc)
    .slice(0, 4);
  let excerptBudget = MAX_EXCERPT_CHARS;
  const excerpts: string[] = [];
  for (const f of interesting) {
    if (excerptBudget <= 0) break;
    let text: string;
    try {
      text = fs.readFileSync(f.file.absPath, 'utf8');
    } catch {
      continue;
    }
    const head = text.split('\n').slice(0, EXCERPT_LINES).join('\n').slice(0, excerptBudget);
    excerptBudget -= head.length;
    excerpts.push(`--- ${f.file.relPath} (first ${EXCERPT_LINES} lines) ---\n${head}`);
  }

  return [
    `Component: ${c.name}`,
    `Path: ${c.path}`,
    `Type: ${c.type} | Languages: ${c.languages.join(', ') || 'n/a'}`,
    c.roleCounts
      ? `File roles: ${Object.entries(c.roleCounts).map(([r, n]) => `${r} ${n}`).join(', ')}`
      : '',
    `Metrics: ${c.metrics.loc} LOC, ${c.metrics.fileCount} files, fanIn ${c.metrics.fanIn}, fanOut ${c.metrics.fanOut}`,
    routes.length ? `Routes:\n${routes.join('\n')}` : 'Routes: none',
    calls.length ? `Outbound calls:\n${calls.join('\n')}` : 'Outbound calls: none',
    staticFlags.length ? `Static analysis warnings:\n${staticFlags.join('\n')}` : '',
    excerpts.length ? `File excerpts:\n${excerpts.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Enrich components with Claude-generated summaries and bottleneck risks.
 * Mutates the graph in place. Failures are per-component and non-fatal.
 */
export async function enrichGraph(
  graph: AnalysisGraph,
  factsByComponent: Map<string, FileFacts[]>,
  rootDir: string,
  apiKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const client = new Anthropic({ apiKey });
  const overview = repoOverview(graph);

  const targets = [...graph.components]
    .filter((c) => c.metrics.fileCount > 0)
    .sort((a, b) => b.metrics.loc - a.metrics.loc)
    .slice(0, MAX_COMPONENTS);

  let done = 0;
  const queue = [...targets];
  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try {
        const response = await client.messages.parse({
          model: MODEL,
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          system: [
            { type: 'text', text: SYSTEM_PROMPT },
            {
              type: 'text',
              text: overview,
              // Shared across every component call for this repo — cache it.
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: componentPrompt(c, factsByComponent.get(c.id) ?? [], rootDir),
            },
          ],
          output_config: { format: zodOutputFormat(EnrichmentSchema) },
        });
        const parsed = response.parsed_output;
        if (parsed) {
          c.summary = parsed.summary;
          c.responsibilities = parsed.responsibilities.slice(0, 5);
          for (const risk of parsed.bottleneckRisks.slice(0, 4)) {
            c.bottlenecks.push({ ...risk, source: 'llm' });
          }
        }
      } catch (err) {
        // Per-component failure (rate limit after SDK retries, refusal, etc.)
        // leaves the component with static data only.
        // eslint-disable-next-line no-console
        console.warn(`enrichment failed for ${c.id}:`, err instanceof Error ? err.message : err);
      } finally {
        done++;
        onProgress?.(done, targets.length);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
}
