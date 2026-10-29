import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

type Pools = { system: pg.Pool; tenant: pg.Pool; systemDb: DB; tenantDb: DB };

const globalForDb = globalThis as unknown as { __leadorbitPools?: Pools };

function createPools(): Pools {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const appUrl = process.env.DATABASE_APP_URL;
  if (!ownerUrl || !appUrl) {
    throw new Error("DATABASE_OWNER_URL and DATABASE_APP_URL must be configured. See .env.example.");
  }
  const system = new pg.Pool({ connectionString: ownerUrl, max: 5 });
  const tenant = new pg.Pool({ connectionString: appUrl, max: 10 });
  return { system, tenant, systemDb: drizzle(system, { schema }), tenantDb: drizzle(tenant, { schema }) };
}

function pools(): Pools {
  if (!globalForDb.__leadorbitPools) globalForDb.__leadorbitPools = createPools();
  return globalForDb.__leadorbitPools;
}

/**
 * Privileged connection (bypasses RLS). Only for authentication, workspace
 * provisioning, the job queue and the cross-workspace scheduler. Never pass
 * user-controlled workspace ids through here without an explicit membership check.
 */
export function systemDb(): DB {
  return pools().systemDb;
}

/**
 * Run `fn` in a transaction as the restricted tenant role with
 * app.workspace_id set, so PostgreSQL row-level security isolates the data.
 */
export async function withTenant<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error("Invalid workspace id");
  return pools().tenantDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  const p = globalForDb.__leadorbitPools;
  if (p) {
    await Promise.all([p.system.end(), p.tenant.end()]);
    globalForDb.__leadorbitPools = undefined;
  }
}

export { schema };
