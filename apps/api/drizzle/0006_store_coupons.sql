CREATE TABLE "store_coupons" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"percent" integer NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "coupon_code" varchar(32);--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "discount_minor" bigint DEFAULT 0 NOT NULL;