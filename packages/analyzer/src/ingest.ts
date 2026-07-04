import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { simpleGit } from 'simple-git';
import type { RepoSource } from '@codeviz/shared';

export interface IngestResult {
  rootDir: string;
  repoName: string;
}

/** Resolve a repo source to a local directory (cloning GitHub URLs). */
export async function ingest(source: RepoSource, repoCacheDir: string): Promise<IngestResult> {
  if (source.type === 'local') {
    const rootDir = path.resolve(source.path);
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      throw new Error(`Not a directory: ${rootDir}`);
    }
    return { rootDir, repoName: path.basename(rootDir) };
  }

  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(source.url);
  if (!m) throw new Error(`Unsupported GitHub URL: ${source.url}`);
  const [, owner, repo] = m;
  const key = createHash('sha1')
    .update(`${owner}/${repo}@${source.ref ?? ''}`)
    .digest('hex')
    .slice(0, 10);
  const dest = path.join(repoCacheDir, `${owner}__${repo}__${key}`);

  if (!fs.existsSync(path.join(dest, '.git'))) {
    fs.mkdirSync(repoCacheDir, { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    const cloneOpts = ['--depth', '1'];
    if (source.ref) cloneOpts.push('--branch', source.ref);
    await simpleGit().clone(`https://github.com/${owner}/${repo}.git`, dest, cloneOpts);
  }
  return { rootDir: dest, repoName: repo };
}
