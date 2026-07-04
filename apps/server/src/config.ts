import path from 'node:path';

const root = process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 4400),
  host: process.env.HOST ?? '127.0.0.1',
  /** Where diagrams and finished analyses are persisted. */
  dataDir: process.env.DATA_DIR ?? path.join(root, 'data'),
  /** Where GitHub repos are cloned. */
  repoCacheDir: process.env.REPO_CACHE_DIR ?? path.join(root, '.repo-cache'),
  /** The hosted-deploy switch: disable analyzing arbitrary local paths. */
  allowLocalPaths: (process.env.ALLOW_LOCAL_PATHS ?? 'true') !== 'false',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  /** Directory of built web assets to serve in production (optional). */
  staticDir: process.env.STATIC_DIR,
};
