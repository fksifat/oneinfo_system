-- Reconcile review-only and locally upgraded production/customer databases without changing existing rows.
CREATE TABLE IF NOT EXISTS "card_activation_secrets" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" varchar(64),
	"version" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_card_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"line_index" integer NOT NULL,
	"unit_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_batches" ADD COLUMN IF NOT EXISTS "print_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_batches" ADD COLUMN IF NOT EXISTS "print_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "customer_account_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "profile_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_activation_secrets_card_id_cards_id_fk' AND conrelid = 'card_activation_secrets'::regclass) THEN
  ALTER TABLE "card_activation_secrets" ADD CONSTRAINT "card_activation_secrets_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_activation_secrets_issued_by_operators_id_fk' AND conrelid = 'card_activation_secrets'::regclass) THEN
  ALTER TABLE "card_activation_secrets" ADD CONSTRAINT "card_activation_secrets_issued_by_operators_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_accounts_profile_id_customer_profiles_id_fk' AND conrelid = 'customer_accounts'::regclass) THEN
  ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_card_allocations_order_id_store_orders_id_fk' AND conrelid = 'order_card_allocations'::regclass) THEN
  ALTER TABLE "order_card_allocations" ADD CONSTRAINT "order_card_allocations_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_card_allocations_card_id_cards_id_fk' AND conrelid = 'order_card_allocations'::regclass) THEN
  ALTER TABLE "order_card_allocations" ADD CONSTRAINT "order_card_allocations_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_accounts_email_unique" ON "customer_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_accounts_profile_unique" ON "customer_accounts" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_card_allocations_card_unique" ON "order_card_allocations" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_card_allocations_unit_unique" ON "order_card_allocations" USING btree ("order_id","line_index","unit_index");--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_batches_print_confirmed_by_operators_id_fk' AND conrelid = 'card_batches'::regclass) THEN
  ALTER TABLE "card_batches" ADD CONSTRAINT "card_batches_print_confirmed_by_operators_id_fk" FOREIGN KEY ("print_confirmed_by") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_customer_account_id_customer_accounts_id_fk' AND conrelid = 'cards'::regclass) THEN
  ALTER TABLE "cards" ADD CONSTRAINT "cards_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_orders_profile_id_customer_profiles_id_fk' AND conrelid = 'store_orders'::regclass) THEN
  ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_review_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_reviews" (
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
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_review_invites_order_id_store_orders_id_fk' AND conrelid = 'store_review_invites'::regclass) THEN
  ALTER TABLE "store_review_invites" ADD CONSTRAINT "store_review_invites_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_reviews_order_id_store_orders_id_fk' AND conrelid = 'store_reviews'::regclass) THEN
  ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_reviews_product_id_products_id_fk' AND conrelid = 'store_reviews'::regclass) THEN
  ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_review_invites_order_unique" ON "store_review_invites" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_review_invites_token_unique" ON "store_review_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_reviews_order_product_unique" ON "store_reviews" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_reviews_public_idx" ON "store_reviews" USING btree ("product_id","status","created_at");