ALTER TABLE "store_orders" ADD COLUMN "payment_method" text DEFAULT 'COD' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "payment_amount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "transaction_id" varchar(20);--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "payment_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_shipping_settings" ADD COLUMN "cod_advance_taka" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_transaction_unique" ON "store_orders" USING btree ("transaction_id");