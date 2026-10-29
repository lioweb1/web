import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export async function runMigrations(url = process.env.DATABASE_OWNER_URL) {
  if (!url) throw new Error("DATABASE_OWNER_URL is required to run migrations");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await grantTenantRole(pool);
  } finally {
    await pool.end();
  }
}

/** Make the application login role a member of leadorbit_tenant (RLS-restricted privileges). */
async function grantTenantRole(pool: pg.Pool) {
  const appUrl = process.env.DATABASE_APP_URL;
  if (!appUrl) return;
  const appUser = decodeURIComponent(new URL(appUrl).username);
  if (!appUser) return;
  const { rows } = await pool.query("select pg_has_role($1, 'leadorbit_tenant', 'member') as ok", [appUser]).catch(() => ({ rows: [{ ok: false }] }));
  if (rows[0]?.ok) return;
  try {
    await pool.query(`GRANT leadorbit_tenant TO "${appUser.replace(/"/g, '""')}"`);
  } catch (e) {
    console.warn(`Could not grant leadorbit_tenant to ${appUser} (${(e as Error).message}). Run as a superuser: GRANT leadorbit_tenant TO ${appUser};`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => console.log("Migrations applied"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
