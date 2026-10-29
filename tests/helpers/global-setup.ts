import pg from "pg";
import { runMigrations } from "../../src/lib/db/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_OWNER_URL ?? "postgres://leadorbit_owner:owner_dev@localhost:5432/leadorbit_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  await runMigrations(url);
}
