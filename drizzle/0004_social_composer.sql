CREATE TABLE "social_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size" integer NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_media_ws_idx" ON "social_media" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE social_media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON social_media USING (workspace_id = app_current_workspace()) WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON social_media TO leadorbit_tenant;
