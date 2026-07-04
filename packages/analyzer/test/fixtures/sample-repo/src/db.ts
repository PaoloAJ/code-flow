import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(sql: string): Promise<unknown[]> {
  const result = await pool.query(sql);
  return result.rows;
}
