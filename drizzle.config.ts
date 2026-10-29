import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "postgres://leadorbit_owner:owner_dev@localhost:5432/leadorbit" },
});
