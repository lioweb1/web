-- One-time database setup. Run as a PostgreSQL superuser, e.g.:
--   psql -U postgres -v owner_pw="'change-me'" -v app_pw="'change-me-too'" -f scripts/setup-db.sql
-- Then set DATABASE_OWNER_URL / DATABASE_APP_URL in .env and run `npm run db:migrate`.

-- Owner: owns the tables, runs migrations, the scheduler and authentication (bypasses RLS).
CREATE ROLE leadorbit_owner LOGIN CREATEROLE PASSWORD :owner_pw;
-- App: used for every workspace-scoped query; row-level security applies.
CREATE ROLE leadorbit_app LOGIN PASSWORD :app_pw;
CREATE DATABASE leadorbit OWNER leadorbit_owner;

-- After `npm run db:migrate` has created the leadorbit_tenant group role, grant it to the app role:
--   GRANT leadorbit_tenant TO leadorbit_app;
