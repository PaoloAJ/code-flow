import fs from 'node:fs';
import path from 'node:path';
import ignoreImport, { type Ignore } from 'ignore';

// `ignore` is CJS with a d.ts `export default`; under NodeNext the callable
// lands either on the namespace itself (runtime) or `.default` (types).
const ignoreFactory =
  ((ignoreImport as unknown as { default?: () => Ignore }).default ??
    (ignoreImport as unknown as () => Ignore));
import type { Language } from '@codeviz/shared';
import type { RepoFile } from './types.js';

const LANG_BY_EXT: Record<string, Language> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.go': 'go',
};

/** Config/infra files we keep around even though they aren't source code. */
const KEEP_FILES = new Set([
  'package.json',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'serverless.yml',
  'serverless.yaml',
  'template.yml',
  'template.yaml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
]);

const ALWAYS_IGNORE = [
  '.git/',
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  'target/',
  '.next/',
  '.nuxt/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.terraform/',
  '*.min.js',
  '*.lock',
  '*.map',
];

export interface CensusResult {
  /** Source files in supported languages. */
  sources: RepoFile[];
  /** Build/infra config files. */
  configs: RepoFile[];
  truncated: boolean;
}

export function census(
  rootDir: string,
  opts: { maxFiles: number; maxFileBytes: number },
): CensusResult {
  const ig = ignoreFactory().add(ALWAYS_IGNORE);
  const rootGitignore = path.join(rootDir, '.gitignore');
  if (fs.existsSync(rootGitignore)) {
    ig.add(fs.readFileSync(rootGitignore, 'utf8'));
  }

  const sources: RepoFile[] = [];
  const configs: RepoFile[] = [];
  let truncated = false;

  const walk = (dir: string) => {
    if (sources.length >= opts.maxFiles) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (ig.ignores(rel + '/')) continue;
        walk(abs);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        const ext = path.extname(entry.name);
        const lang = LANG_BY_EXT[ext];
        const isConfig = KEEP_FILES.has(entry.name);
        if (!lang && !isConfig) continue;
        let bytes: number;
        try {
          bytes = fs.statSync(abs).size;
        } catch {
          continue;
        }
        const file: RepoFile = { relPath: rel, absPath: abs, language: lang ?? 'other', bytes };
        if (isConfig) configs.push(file);
        else if (bytes <= opts.maxFileBytes && sources.length < opts.maxFiles) sources.push(file);
        else if (bytes > opts.maxFileBytes) {
          // Oversized source files still count toward metrics but aren't parsed.
          continue;
        } else truncated = true;
      }
    }
  };

  walk(rootDir);
  return { sources, configs, truncated };
}
