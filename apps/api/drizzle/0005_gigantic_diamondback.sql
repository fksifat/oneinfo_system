CREATE TABLE "store_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"customer" jsonb NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"shipping_zone" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"shipping_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_shipping_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"rates" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_request_unique" ON "store_orders" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "store_orders_created_idx" ON "store_orders" USING btree ("created_at","id");