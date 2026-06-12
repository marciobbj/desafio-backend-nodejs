CREATE TABLE "tenant_ai_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"system_prompt" text NOT NULL,
	"model" text,
	"temperature" double precision,
	"tool_calling_enabled" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_ai_settings" ADD CONSTRAINT "tenant_ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;