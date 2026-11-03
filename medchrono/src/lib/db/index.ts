import pg from "pg";
import { SCHEMA_SQL } from "./schema";

let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;

/** Either DATABASE_URL, or the standard PG* variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE) as used on AWS. */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.PGHOST);
}

function getPool(): pg.Pool {
  if (!dbConfigured()) throw new Error("DATABASE_URL (or PGHOST) is not set");
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    max: Number(process.env.DATABASE_POOL_SIZE) || 10,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" } : undefined,
  });
  return pool;
}

/** Applies the idempotent schema once per process. */
export function migrate(): Promise<void> {
  ready ??= (async () => {
    await getPool().query(SCHEMA_SQL);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export type Db = Pick<pg.PoolClient, "query">;

export async function db(): Promise<Db> {
  await migrate();
  return getPool();
}

/** Runs fn inside a transaction; rolls back on throw. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  await migrate();
  const c = await getPool().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  ready = null;
}
