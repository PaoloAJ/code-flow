import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeRepo } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepo = path.join(here, 'fixtures', 'sample-repo');

describe('analyzeRepo end-to-end (fixture repo, no LLM)', () => {
  it('produces components, lambda carve-out, and edges', async () => {
    const graph = await analyzeRepo(
      { type: 'local', path: fixtureRepo },
      { repoCacheDir: path.join(os.tmpdir(), 'codeviz-test-cache') },
    );

    expect(graph.repo.name).toBe('sample-repo');

    // Lambda carved out from serverless.yml
    const lambda = graph.components.find((c) => c.type === 'lambda');
    expect(lambda).toBeDefined();
    expect(lambda!.name).toBe('resizeImage');
    expect(lambda!.files).toContain('lambdas/resize.ts');

    // Python worker is its own build unit (requirements.txt)
    const worker = graph.components.find((c) => c.path === 'worker');
    expect(worker).toBeDefined();
    expect(worker!.routes.map((r) => r.path)).toEqual(
      expect.arrayContaining(['/jobs']),
    );
    expect(worker!.outboundCalls.some((o) => o.kind === 'queue')).toBe(true);

    // Root component carries the express routes
    const root = graph.components.find((c) => c.files.includes('src/server.ts'));
    expect(root).toBeDefined();
    expect(root!.routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /photos', 'POST /photos']),
    );

    // Invoke edge: server → lambda via FunctionName
    const invoke = graph.edges.find((e) => e.kind === 'invoke');
    expect(invoke).toBeDefined();
    expect(invoke!.target).toBe(lambda!.id);
    expect(invoke!.source).toBe(root!.id);

    // The worker's requests-in-loop should be flagged as a bottleneck
    expect(
      worker!.bottlenecks.some((b) => b.reason.toLowerCase().includes('loop')),
    ).toBe(true);

    // Semantic upgrades: a SQL database node synthesized from the pg Pool,
    // with a db edge from the server component.
    const db = graph.components.find((c) => c.type === 'database');
    expect(db).toBeDefined();
    expect(db!.kindDetail).toBe('SQL database');
    expect(
      graph.edges.some((e) => e.kind === 'db' && e.source === root!.id && e.target === db!.id),
    ).toBe(true);

    // package.json name wins over the directory name.
    expect(root!.name).toBe('sample-repo');

    // Role classification lands on components.
    expect(root!.roleCounts?.entrypoint ?? 0).toBeGreaterThanOrEqual(1);

    // Frontend unit named from its package.json, typed via react dep.
    const fe = graph.components.find((c) => c.name === 'photo-web');
    expect(fe).toBeDefined();
    expect(fe!.type).toBe('frontend');

    // Cross-service HTTP matching: frontend's fetch('/photos') → server routes.
    expect(
      graph.edges.some((e) => e.kind === 'http' && e.source === fe!.id && e.target === root!.id),
    ).toBe(true);

    // External API node for stripe with an http edge from the frontend.
    const stripe = graph.components.find((c) => c.type === 'external');
    expect(stripe?.name).toBe('api.stripe.com');
    expect(
      graph.edges.some((e) => e.kind === 'http' && e.source === fe!.id && e.target === stripe!.id),
    ).toBe(true);
  }, 30_000);
});
