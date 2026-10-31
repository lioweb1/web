CREATE TABLE "social_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"external_cid" text,
	"author_handle" text,
	"author_name" text,
	"text" text NOT NULL,
	"url" text,
	"commented_at" timestamp with time zone,
	"reply_text" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reply_id" text,
	"replied_at" timestamp with time zone,
	"error" text,
	"approval_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_autopilots" ADD COLUMN "engage_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_autopilots" ADD COLUMN "metrics_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_autopilots" ADD COLUMN "telegram_offset" bigint;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "hook_variants" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "platform_texts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "thread" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "primary_keyword" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "alt_text" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "auto_image" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "metrics_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "approval_message_id" bigint;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_comments_ext_uq" ON "social_comments" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "social_comments_ws_idx" ON "social_comments" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
ALTER TABLE social_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON social_comments USING (workspace_id = app_current_workspace()) WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON social_comments TO leadorbit_tenant;
