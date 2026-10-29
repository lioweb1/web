// Test database: separate from development. Override with TEST_DATABASE_OWNER_URL / TEST_DATABASE_APP_URL.
process.env.DATABASE_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? "postgres://leadorbit_owner:owner_dev@localhost:5432/leadorbit_test";
process.env.DATABASE_APP_URL = process.env.TEST_DATABASE_APP_URL ?? "postgres://leadorbit_app:app_dev@localhost:5432/leadorbit_test";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL = "http://localhost:3000";
(process.env as Record<string, string>).NODE_ENV = "test";
