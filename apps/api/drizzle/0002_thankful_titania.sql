CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"subtitle" varchar(100) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_minor" integer NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish" varchar(80) DEFAULT '' NOT NULL,
	"appearance" varchar(10) DEFAULT 'light' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"status" varchar(12) DEFAULT 'DRAFT' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"badge" varchar(40) DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_unique" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_catalog_idx" ON "products" USING btree ("status","sort_order");--> statement-breakpoint
INSERT INTO "products" ("id", "slug", "name", "subtitle", "price_minor", "features", "finish", "appearance", "status", "featured", "badge", "sort_order") VALUES
('01800000-0000-4000-8000-000000000001', 'oneinfo-essential', 'Oneinfo Essential', 'Everyday PVC', 129000, '["Full-colour front design","NFC + dynamic QR","Standard card format"]', 'SATIN WHITE', 'light', 'PUBLISHED', false, '', 10),
('01800000-0000-4000-8000-000000000002', 'oneinfo-signature', 'Oneinfo Signature', 'Premium PVC', 179000, '["Premium dark finish","NFC + dynamic QR","Front and back customization"]', 'SOFT-TOUCH BLACK', 'dark', 'PUBLISHED', true, 'MOST POPULAR', 20);
