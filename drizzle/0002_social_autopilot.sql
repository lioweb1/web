CREATE TABLE "social_autopilots" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"interval_minutes" integer DEFAULT 180 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"last_run_stats" jsonb,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_external_id" text,
	"source_title" text,
	"source_url" text,
	"hook" text NOT NULL,
	"body" text NOT NULL,
	"short_body" text NOT NULL,
	"engagement_comment" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_url" text,
	"platforms" text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_provider" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_autopilots" ADD CONSTRAINT "social_autopilots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_ws_idx" ON "social_posts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_source_uq" ON "social_posts" USING btree ("workspace_id","source_external_id") WHERE "social_posts"."source_external_id" is not null;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_autopilots','social_posts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_current_workspace()) WITH CHECK (workspace_id = app_current_workspace())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO leadorbit_tenant', t);
  END LOOP;
END $$;
