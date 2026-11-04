CREATE TABLE "store_review_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"display_name" varchar(60) NOT NULL,
	"rating" integer NOT NULL,
	"title" varchar(100) NOT NULL,
	"body" varchar(1200) NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_reviews_rating_check" CHECK ("store_reviews"."rating" between 1 and 5),
	CONSTRAINT "store_reviews_status_check" CHECK ("store_reviews"."status" in ('PENDING', 'PUBLISHED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_review_invites" ADD CONSTRAINT "store_review_invites_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_review_invites_order_unique" ON "store_review_invites" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_review_invites_token_unique" ON "store_review_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "store_reviews_order_product_unique" ON "store_reviews" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "store_reviews_public_idx" ON "store_reviews" USING btree ("product_id","status","created_at");