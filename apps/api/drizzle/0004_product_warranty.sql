ALTER TABLE "products" ADD COLUMN "warranty" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "warranty_is_demo" boolean DEFAULT false NOT NULL;