import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Diagram, User } from '@codeviz/shared';
import { config } from './config.js';

/** The anonymous owner used when AUTH_REQUIRED is off (local mode). */
export const LOCAL_USER: User = { id: 'local', email: 'local@localhost', name: 'Local user' };

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(path.join(config.dataDir, 'codeviz.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS diagrams (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS diagrams_owner ON diagrams(owner_id, updated_at);
  `);
  migrateJsonDiagrams(db);
  return db;
}

/** One-time import of pre-SQLite diagrams saved as data/diagrams/*.json. */
function migrateJsonDiagrams(db: Database.Database) {
  const dir = path.join(config.dataDir, 'diagrams');
  if (!fs.existsSync(dir)) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO diagrams (id, owner_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Diagram;
      insert.run(d.id, LOCAL_USER.id, d.name, JSON.stringify(d), d.updatedAt ?? new Date().toISOString());
    } catch {
      // unreadable legacy file — leave it in place, skip
    }
  }
  fs.renameSync(dir, `${dir}.imported`);
}

// ── diagrams ────────────────────────────────────────────────────────────────

export interface DiagramRow {
  id: string;
  owner_id: string;
  name: string;
  updated_at: string;
  data: string;
}

export function listDiagrams(ownerId: string): DiagramRow[] {
  return getDb()
    .prepare(
      `SELECT id, owner_id, name, updated_at, data FROM diagrams WHERE owner_id = ? ORDER BY updated_at DESC`,
    )
    .all(ownerId) as DiagramRow[];
}

export function getDiagram(id: string): Diagram | null {
  const row = getDb().prepare(`SELECT data FROM diagrams WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Diagram) : null;
}

export function getDiagramOwner(id: string): string | null {
  const row = getDb().prepare(`SELECT owner_id FROM diagrams WHERE id = ?`).get(id) as
    | { owner_id: string }
    | undefined;
  return row?.owner_id ?? null;
}

export function saveDiagram(diagram: Diagram, ownerId: string) {
  getDb()
    .prepare(
      `INSERT INTO diagrams (id, owner_id, name, data, updated_at) VALUES (@id, @owner, @name, @data, @updated)
       ON CONFLICT(id) DO UPDATE SET name = @name, data = @data, updated_at = @updated`,
    )
    .run({
      id: diagram.id,
      owner: ownerId,
      name: diagram.name,
      data: JSON.stringify(diagram),
      updated: diagram.updatedAt,
    });
}

export function deleteDiagram(id: string): boolean {
  return getDb().prepare(`DELETE FROM diagrams WHERE id = ?`).run(id).changes > 0;
}
