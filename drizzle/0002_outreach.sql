CREATE TYPE "public"."draft_kind" AS ENUM('linkedin_comment', 'linkedin_message', 'email', 'follow_up_email');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"lead_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"created_by_id" uuid,
	"kind" "draft_kind" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"provider_id" text NOT NULL,
	"model" text,
	"language" text,
	"tone" text,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"draft_id" uuid,
	"sent_by_id" uuid,
	"to_email" text NOT NULL,
	"from_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "outreach_status" NOT NULL,
	"error" text,
	"message_id" text,
	"unsubscribe_token" text NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_draft_id_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."outreach_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_ws_email_uq" ON "email_suppressions" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "drafts_lead_idx" ON "outreach_drafts" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "drafts_ws_idx" ON "outreach_drafts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_unsub_token_uq" ON "outreach_messages" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "outreach_ws_sent_idx" ON "outreach_messages" USING btree ("workspace_id","sent_at");--> statement-breakpoint
CREATE INDEX "outreach_lead_idx" ON "outreach_messages" USING btree ("lead_id","sent_at");--> statement-breakpoint
-- Row-level security for the outreach tables (same tenant isolation as the other workspace tables).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outreach_drafts','outreach_messages','email_suppressions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_current_workspace()) WITH CHECK (workspace_id = app_current_workspace())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO leadorbit_tenant', t);
  END LOOP;
END $$;
