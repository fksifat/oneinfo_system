CREATE TABLE "customer_contact_leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_contact_leads" ADD CONSTRAINT "customer_contact_leads_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contact_leads_request_unique" ON "customer_contact_leads" USING btree ("account_id","request_id");--> statement-breakpoint
CREATE INDEX "customer_contact_leads_inbox_idx" ON "customer_contact_leads" USING btree ("account_id","created_at","id");