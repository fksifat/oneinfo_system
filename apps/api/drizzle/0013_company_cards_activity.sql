CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"domain" varchar(253),
	"logo_url" text DEFAULT '' NOT NULL,
	"headline" varchar(160) DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"theme" "profile_theme" DEFAULT 'MIDNIGHT' NOT NULL,
	"allow_employee_edits" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"edit_token_hash" varchar(64),
	"edit_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_activity" (
	"profile_id" uuid NOT NULL,
	"day" date NOT NULL,
	"mode" text NOT NULL,
	"campaign" varchar(120) NOT NULL,
	"source" text NOT NULL,
	"event" varchar(72) NOT NULL,
	"total" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_contact_leads" ADD COLUMN "forwarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "profile_mode" text DEFAULT 'BUSINESS' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "mode_content" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_account_id_customer_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_employees" ADD CONSTRAINT "company_employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_employees" ADD CONSTRAINT "company_employees_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_activity" ADD CONSTRAINT "profile_activity_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_unique" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "companies_owner_idx" ON "companies" USING btree ("owner_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_employees_email_unique" ON "company_employees" USING btree ("company_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "company_employees_profile_unique" ON "company_employees" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_employees_edit_token_unique" ON "company_employees" USING btree ("edit_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_activity_bucket_unique" ON "profile_activity" USING btree ("profile_id","day","mode","campaign","source","event");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_company_idx" ON "cards" USING btree ("company_id");