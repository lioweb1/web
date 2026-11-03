CREATE TABLE "bot_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"machine_id" text NOT NULL,
	"hostname" text,
	"version" text,
	"broker" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_devices" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot_status" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"balance" double precision,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"device_id" uuid,
	"traded_at" timestamp with time zone NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"stake" double precision NOT NULL,
	"confidence" double precision,
	"outcome" text NOT NULL,
	"pnl" double precision DEFAULT 0 NOT NULL,
	"ref" text,
	"strategy" text,
	"broker" text,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_devices" ADD CONSTRAINT "bot_devices_license_id_bot_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."bot_licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_licenses" ADD CONSTRAINT "bot_licenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_status" ADD CONSTRAINT "bot_status_device_id_bot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."bot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD CONSTRAINT "bot_trades_license_id_bot_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."bot_licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD CONSTRAINT "bot_trades_device_id_bot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."bot_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_devices_license_machine_uq" ON "bot_devices" USING btree ("license_id","machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_licenses_key_uq" ON "bot_licenses" USING btree ("key");--> statement-breakpoint
CREATE INDEX "bot_licenses_ws_idx" ON "bot_licenses" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_trades_license_time_idx" ON "bot_trades" USING btree ("license_id","traded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_trades_ref_uq" ON "bot_trades" USING btree ("license_id","ref") WHERE "bot_trades"."ref" is not null;--> statement-breakpoint
-- Row-level security: licenses are workspace rows; devices, trades and status hang off a license.
ALTER TABLE bot_licenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON bot_licenses USING (workspace_id = app_current_workspace()) WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_licenses TO leadorbit_tenant;
--> statement-breakpoint
ALTER TABLE bot_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY via_license ON bot_devices USING (license_id IN (SELECT id FROM bot_licenses)) WITH CHECK (license_id IN (SELECT id FROM bot_licenses));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_devices TO leadorbit_tenant;
--> statement-breakpoint
ALTER TABLE bot_trades ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY via_license ON bot_trades USING (license_id IN (SELECT id FROM bot_licenses)) WITH CHECK (license_id IN (SELECT id FROM bot_licenses));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_trades TO leadorbit_tenant;
--> statement-breakpoint
ALTER TABLE bot_status ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY via_device ON bot_status USING (device_id IN (SELECT id FROM bot_devices)) WITH CHECK (device_id IN (SELECT id FROM bot_devices));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_status TO leadorbit_tenant;
