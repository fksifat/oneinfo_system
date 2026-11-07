ALTER TABLE "store_orders" ADD COLUMN "invoice_number" varchar(15);--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_invoice_unique" ON "store_orders" USING btree ("invoice_number");