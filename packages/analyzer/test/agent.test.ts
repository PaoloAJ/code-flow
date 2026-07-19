import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grepRepo, listDir, readFile, type AgentFs } from '../src/agent.js';

let root: string;
let ctx: AgentFs;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeviz-agent-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'a.ts'),
    'const one = 1;\nfetch("/api/x");\nconst two = 2;\n',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'noisy.ts'),
    Array.from({ length: 300 }, (_, i) => `fetch("/api/${i}");`).join('\n'),
  );
  fs.writeFileSync(path.join(root, 'README.md'), '# readme\n');
  const file = (rel: string): AgentFs['files'][number] => ({
    relPath: rel,
    absPath: path.join(root, rel),
    language: 'typescript',
    bytes: fs.statSync(path.join(root, rel)).size,
  });
  ctx = { rootDir: root, files: [file('src/a.ts'), file('src/noisy.ts')] };
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('agent list_dir', () => {
  it('lists dirs and files, skipping ignored directories', () => {
    const out = listDir(ctx, '.');
    expect(out).toContain('src/');
    expect(out).toContain('README.md');
    expect(out).not.toContain('node_modules');
  });

  it('errors on missing directories', () => {
    expect(listDir(ctx, 'nope')).toMatch(/^Error:/);
  });
});

describe('agent read_file', () => {
  it('rejects paths escaping the repo root', () => {
    expect(readFile(ctx, '../../../etc/passwd')).toMatch(/^Error: path escapes/);
    expect(readFile(ctx, '/etc/passwd')).toMatch(/^Error: path escapes/);
  });

  it('returns numbered lines for a range', () => {
    const out = readFile(ctx, 'src/a.ts', 2, 2);
    expect(out).toBe('2\tfetch("/api/x");\n… file continues to line 4; request more with start_line=3');
  });

  it('reads non-census files inside the root (e.g. README)', () => {
    expect(readFile(ctx, 'README.md')).toContain('1\t# readme');
  });

  it('errors when start_line is past EOF', () => {
    expect(readFile(ctx, 'src/a.ts', 999)).toMatch(/^Error: start_line/);
  });
});

describe('agent grep', () => {
  it('finds matches with path:line references', () => {
    const out = grepRepo(ctx, 'fetch\\("/api/x"', undefined);
    expect(out).toContain('src/a.ts:2:');
  });

  it('caps the number of matches', () => {
    const out = grepRepo(ctx, 'fetch', undefined);
    expect(out).toContain('capped at 80 matches');
    expect(out.split('\n').length).toBe(81);
  });

  it('filters with path_contains and reports empty results', () => {
    expect(grepRepo(ctx, 'fetch', 'does-not-exist')).toBe('No matches.');
  });

  it('reports invalid regexes as errors', () => {
    expect(grepRepo(ctx, '(', undefined)).toMatch(/^Error: invalid regex/);
  });
});
