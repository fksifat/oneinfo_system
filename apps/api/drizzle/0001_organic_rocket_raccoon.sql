CREATE TYPE "public"."profile_theme" AS ENUM('MIDNIGHT', 'IVORY', 'MINT');--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_operator_id" uuid,
	"public_slug" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"headline" varchar(160) DEFAULT '' NOT NULL,
	"company" varchar(120) DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"phone" varchar(40) DEFAULT '' NOT NULL,
	"email" varchar(320) DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"theme" "profile_theme" DEFAULT 'MIDNIGHT' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"label" varchar(40) NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_owner_operator_id_operators_id_fk" FOREIGN KEY ("owner_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_links" ADD CONSTRAINT "profile_links_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_slug_unique" ON "customer_profiles" USING btree ("public_slug");--> statement-breakpoint
CREATE INDEX "customer_profiles_owner_idx" ON "customer_profiles" USING btree ("owner_operator_id");--> statement-breakpoint
CREATE INDEX "profile_links_profile_sort_idx" ON "profile_links" USING btree ("profile_id","sort_order");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_profile_idx" ON "cards" USING btree ("profile_id");