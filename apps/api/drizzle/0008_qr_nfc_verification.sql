CREATE TABLE IF NOT EXISTS "card_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"method" varchar(20) NOT NULL,
	"expected_url" text NOT NULL,
	"scanned_value" text NOT NULL,
	"matched" boolean NOT NULL,
	"uid" varchar(128),
	"device_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_verifications_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "card_verifications_station_id_production_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."production_stations"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "qr_artifacts" ADD COLUMN IF NOT EXISTS "image_data" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_verifications_card_idx" ON "card_verifications" USING btree ("card_id","created_at");
