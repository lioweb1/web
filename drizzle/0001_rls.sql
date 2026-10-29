-- Row-level security. Every workspace-scoped query from the web app and worker runs as a
-- role that is a member of leadorbit_tenant, inside a transaction that sets app.workspace_id.
-- The owner role (migrations, auth, scheduler) bypasses RLS as table owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadorbit_tenant') THEN
    CREATE ROLE leadorbit_tenant NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO leadorbit_tenant;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'target_markets','leads','tags','lead_tags','lead_lists','lead_list_items','notes','activities',
    'tasks','integrations','monitoring_rules','notifications','notification_prefs','webhooks',
    'saved_searches','search_history','exports','usage_records','audit_logs','business_signals'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_current_workspace()) WITH CHECK (workspace_id = app_current_workspace())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO leadorbit_tenant', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Canonical businesses: public-source rows (owner NULL) are shared; imported rows are private.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY business_visibility ON businesses
  USING (owner_workspace_id IS NULL OR owner_workspace_id = app_current_workspace())
  WITH CHECK (owner_workspace_id IS NULL OR owner_workspace_id = app_current_workspace());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON businesses TO leadorbit_tenant;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','source_observations','website_analyses','domains'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY via_business ON %I USING (business_id IS NULL OR business_id IN (SELECT id FROM businesses)) WITH CHECK (business_id IS NULL OR business_id IN (SELECT id FROM businesses))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO leadorbit_tenant', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Workspace display data the tenant role may read for its own workspace only.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_workspace ON workspaces USING (id = app_current_workspace());
--> statement-breakpoint
GRANT SELECT ON workspaces TO leadorbit_tenant;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_memberships ON memberships USING (workspace_id = app_current_workspace());
--> statement-breakpoint
GRANT SELECT ON memberships TO leadorbit_tenant;
--> statement-breakpoint
-- Member names for owner/assignee display; no password hashes (column-level grant).
GRANT SELECT (id, name, email) ON users TO leadorbit_tenant;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_members ON users USING (id IN (SELECT user_id FROM memberships));
