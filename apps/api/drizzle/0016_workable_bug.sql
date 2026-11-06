CREATE TABLE "account_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"purpose" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_enquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"company" varchar(120) NOT NULL,
	"quantity" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_enquiries_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "stock_reservations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "awaiting_payment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_emails_kind_unique" ON "order_emails" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "order_emails_pending_idx" ON "order_emails" USING btree ("status","updated_at");