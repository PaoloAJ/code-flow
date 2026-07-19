import fs from 'node:fs';
import type { AnalysisGraph, RepoSource } from '@codeviz/shared';
import type { AnalyzeOptions, FileFacts } from './types.js';
import { ingest } from './ingest.js';
import { census } from './census.js';
import { extractImports } from './imports/treesitter.js';
import { extractJsFacts, nextJsFileRoute } from './extractors/javascript.js';
import { extractPyFacts } from './extractors/python.js';
import { extractJavaKotlinFacts } from './extractors/javakotlin.js';
import { extractGoFacts } from './extractors/go.js';
import { parseInfra } from './infra.js';
import { ImportResolver, type ResolvedTarget } from './resolve.js';
import { classifyRole } from './roles.js';
import { cluster } from './cluster.js';
import { applyStaticBottlenecks } from './bottlenecks.js';
import { enrichGraph } from './enrich.js';
import { surveyRepo } from './agent.js';

export type { AnalyzeOptions } from './types.js';

const JAVA_PACKAGE_DECL = /^\s*package\s+([\w.]+)/m;

export async function analyzeRepo(
  source: RepoSource,
  opts: AnalyzeOptions,
): Promise<AnalysisGraph> {
  const progress = opts.onProgress ?? (() => {});
  const maxFiles = opts.maxFiles ?? 8000;
  const maxFileBytes = opts.maxFileBytes ?? 1_000_000;

  progress({ phase: 'cloning', message: source.type === 'github' ? `Cloning ${source.url}…` : 'Opening local repository…' });
  const { rootDir, repoName } = await ingest(source, opts.repoCacheDir);

  progress({ phase: 'scanning', message: 'Scanning files…' });
  const { sources, configs, truncated } = census(rootDir, { maxFiles, maxFileBytes });
  if (sources.length === 0) {
    throw new Error('No source files found in supported languages (JS/TS, Python, Java/Kotlin, Go)');
  }
  progress({
    phase: 'scanning',
    message: `Found ${sources.length} source files${truncated ? ' (truncated)' : ''}`,
  });

  const resolver = new ImportResolver(sources, configs);

  progress({ phase: 'parsing', message: `Parsing ${sources.length} files…`, progress: 0 });
  const allFacts: FileFacts[] = [];
  let parsed = 0;
  for (const file of sources) {
    let text: string;
    try {
      text = fs.readFileSync(file.absPath, 'utf8');
    } catch {
      continue;
    }
    const loc = text.split('\n').length;
    const imports = await extractImports(file.language, text, file.relPath);

    let extracted: Pick<FileFacts, 'routes' | 'outboundCalls'> & {
      callsInLoops: { line: number; note: string }[];
    };
    switch (file.language) {
      case 'javascript':
      case 'typescript': {
        extracted = extractJsFacts(file.relPath, text);
        const fileRoute = nextJsFileRoute(file.relPath);
        if (fileRoute) extracted.routes.push(fileRoute);
        break;
      }
      case 'python':
        extracted = extractPyFacts(file.relPath, text);
        break;
      case 'java':
      case 'kotlin': {
        extracted = extractJavaKotlinFacts(file.relPath, text);
        const pkg = JAVA_PACKAGE_DECL.exec(text);
        if (pkg) resolver.registerJavaPackage(pkg[1], file.relPath);
        break;
      }
      case 'go':
        extracted = extractGoFacts(file.relPath, text);
        break;
      default:
        extracted = { routes: [], outboundCalls: [], callsInLoops: [] };
    }

    allFacts.push({
      file,
      loc,
      role: classifyRole(file.relPath, text, extracted),
      imports,
      routes: extracted.routes,
      outboundCalls: extracted.outboundCalls,
      callsInLoops: extracted.callsInLoops.map((h) => ({
        file: file.relPath,
        line: h.line,
        note: h.note,
      })),
    });

    parsed++;
    if (parsed % 250 === 0) {
      progress({
        phase: 'parsing',
        message: `Parsed ${parsed}/${sources.length} files`,
        progress: parsed / sources.length,
      });
    }
  }

  progress({ phase: 'clustering', message: 'Resolving imports and clustering components…' });
  const resolvedImports: { from: FileFacts; target: ResolvedTarget; line: number }[] = [];
  for (const facts of allFacts) {
    for (const imp of facts.imports) {
      const target = resolver.resolve(facts.file, imp.specifier);
      if (target) resolvedImports.push({ from: facts, target, line: imp.line });
    }
  }

  const infra = parseInfra(configs);
  const { components, edges, fileToComponent } = cluster(
    repoName,
    allFacts,
    configs,
    infra,
    resolver,
    resolvedImports,
  );

  const factsByComponent = new Map<string, FileFacts[]>();
  for (const facts of allFacts) {
    const comp = fileToComponent.get(facts.file.relPath);
    if (!comp) continue;
    (factsByComponent.get(comp) ?? factsByComponent.set(comp, []).get(comp)!).push(facts);
  }

  applyStaticBottlenecks(components, edges, factsByComponent);

  const graph: AnalysisGraph = {
    repo: { name: repoName, source, analyzedAt: new Date().toISOString() },
    components,
    edges,
  };

  if (opts.anthropicApiKey) {
    progress({ phase: 'enriching', message: 'Mapping repository with Claude…', progress: 0 });
    try {
      await surveyRepo(graph, {
        rootDir,
        files: [...sources, ...configs],
        apiKey: opts.anthropicApiKey,
        onProgress: (message) => progress({ phase: 'enriching', message }),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        'agentic survey failed, falling back to per-component enrichment:',
        err instanceof Error ? err.message : err,
      );
      await enrichGraph(graph, factsByComponent, rootDir, opts.anthropicApiKey, (done, total) =>
        progress({
          phase: 'enriching',
          message: `Summarized ${done}/${total} components`,
          progress: done / total,
        }),
      );
    }
  }

  return graph;
}
