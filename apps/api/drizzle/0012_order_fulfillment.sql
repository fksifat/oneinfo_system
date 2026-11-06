ALTER TABLE "store_orders" ADD COLUMN "processing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "courier_tracking_id" varchar(100);--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "cod_collected_minor" bigint;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "cod_settled_minor" bigint;