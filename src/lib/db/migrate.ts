import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export async function runMigrations(url = process.env.DATABASE_OWNER_URL) {
  if (!url) throw new Error("DATABASE_OWNER_URL is required to run migrations");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
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
