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
  /**
   * Hosted-deploy switch #2: require signup/login for all diagram and
   * analysis APIs. Off locally so the app works with zero setup.
   */
  authRequired: process.env.AUTH_REQUIRED === 'true',
  /** Set secure cookies (HTTPS-only). Enable behind TLS in production. */
  secureCookies: process.env.SECURE_COOKIES === 'true',
  /**
   * Clerk keys switch the auth provider: when CLERK_SECRET_KEY is set the
   * server verifies Clerk session JWTs and the web app shows Clerk's UI;
   * without it the built-in email+password auth is used (local dev).
   */
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
};

export const authProvider = (): 'clerk' | 'local' => (config.clerkSecretKey ? 'clerk' : 'local');
