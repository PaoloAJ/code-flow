import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClerkClient, verifyToken } from '@clerk/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LoginRequest, MeResponse, SignupRequest, User } from '@codeviz/shared';
import { authProvider, config } from './config.js';
import { getDb, LOCAL_USER } from './db.js';

const SESSION_COOKIE = 'codeviz_session';
const SESSION_DAYS = 30;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

function createSession(reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  getDb()
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, userId, expires.toISOString());
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires,
  });
}

// ── Clerk ───────────────────────────────────────────────────────────────────

const clerkClient = config.clerkSecretKey
  ? createClerkClient({ secretKey: config.clerkSecretKey })
  : null;

/** Clerk session JWT: Authorization Bearer, ?token= (SSE/WS), or __session cookie. */
function clerkTokenFrom(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof q === 'string' && q) return q;
  return req.cookies?.__session ?? null;
}

/**
 * Verify a Clerk JWT and map it to a local users row (created on first sight
 * so diagrams get a stable owner id and collab peers get a display name).
 */
async function clerkUser(req: FastifyRequest): Promise<User | null> {
  const token = clerkTokenFrom(req);
  if (!token || !config.clerkSecretKey) return null;
  let sub: string;
  try {
    const payload = await verifyToken(token, { secretKey: config.clerkSecretKey });
    sub = payload.sub;
  } catch {
    return null;
  }
  const id = `clerk:${sub}`;
  const db = getDb();
  const row = db.prepare(`SELECT id, email, name FROM users WHERE id = ?`).get(id) as
    | Omit<UserRow, 'password_hash'>
    | undefined;
  if (row) return { id: row.id, email: row.email, name: row.name };

  let email = `${sub}@clerk.local`;
  let name = 'User';
  try {
    const profile = await clerkClient!.users.getUser(sub);
    email = profile.primaryEmailAddress?.emailAddress ?? email;
    name =
      [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
      profile.username ||
      email.split('@')[0];
  } catch {
    // profile fetch is best-effort; the verified sub is what matters
  }
  try {
    db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      email,
      name,
      '!clerk',
      new Date().toISOString(),
    );
  } catch {
    // email collision with a pre-existing local account — keep ids distinct
    db.prepare(`INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      `${sub}@clerk.local`,
      name,
      '!clerk',
      new Date().toISOString(),
    );
  }
  return { id, email, name };
}

// ── request identity ────────────────────────────────────────────────────────

/**
 * Resolve the requesting user. Tries Clerk (when configured), then the local
 * session cookie, then falls back to the shared anonymous user unless
 * AUTH_REQUIRED is on.
 */
export async function requestUser(req: FastifyRequest): Promise<User | null> {
  if (clerkClient) {
    const user = await clerkUser(req);
    if (user) return user;
  }
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const row = getDb()
      .prepare(
        `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(token, new Date().toISOString()) as Omit<UserRow, 'password_hash'> | undefined;
    if (row) return { id: row.id, email: row.email, name: row.name };
  }
  return config.authRequired ? null : LOCAL_USER;
}

/** preHandler guard for routes that need a user. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await requestUser(req);
  if (!user) {
    return reply.code(401).send({ error: 'sign in required' });
  }
  (req as FastifyRequest & { user: User }).user = user;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: SignupRequest }>('/api/auth/signup', async (req, reply) => {
    if (authProvider() === 'clerk') {
      return reply.code(400).send({ error: 'sign-up is handled by Clerk on this deployment' });
    }
    const { email, password, name } = req.body ?? ({} as SignupRequest);
    if (!email?.includes('@') || !name?.trim() || (password?.length ?? 0) < 8) {
      return reply
        .code(400)
        .send({ error: 'valid email, a name, and a password of 8+ characters are required' });
    }
    const db = getDb();
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email.toLowerCase());
    if (existing) return reply.code(409).send({ error: 'an account with this email already exists' });
    const user: User = { id: randomUUID(), email: email.toLowerCase(), name: name.trim() };
    db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      user.id,
      user.email,
      user.name,
      hashPassword(password),
      new Date().toISOString(),
    );
    createSession(reply, user.id);
    return { user };
  });

  app.post<{ Body: LoginRequest }>('/api/auth/login', async (req, reply) => {
    if (authProvider() === 'clerk') {
      return reply.code(400).send({ error: 'sign-in is handled by Clerk on this deployment' });
    }
    const { email, password } = req.body ?? ({} as LoginRequest);
    const row = getDb()
      .prepare(`SELECT id, email, name, password_hash FROM users WHERE email = ?`)
      .get(email?.toLowerCase() ?? '') as UserRow | undefined;
    if (!row || !verifyPassword(password ?? '', row.password_hash)) {
      return reply.code(401).send({ error: 'wrong email or password' });
    }
    createSession(reply, row.id);
    return { user: { id: row.id, email: row.email, name: row.name } satisfies User };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req): Promise<MeResponse> => {
    const user = await requestUser(req);
    return { user: user?.id === LOCAL_USER.id ? null : user, authRequired: config.authRequired };
  });
}
