CREATE TYPE "public"."attempt_result" AS ENUM('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('DRAFT', 'READY', 'IN_PRODUCTION', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."check_result" AS ENUM('PASSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('NOT_READY', 'SALEABLE', 'RESERVED', 'DISPATCHED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'CLAIMED', 'RETRYABLE_FAILURE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('QR_GENERATION', 'NFC_ENCODING', 'QUALITY_CONTROL');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('CREATED', 'IN_PRODUCTION', 'QC_PASSED', 'QUARANTINED', 'ACTIVATED', 'SUSPENDED', 'REPLACED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."nfc_status" AS ENUM('PENDING', 'WRITTEN');--> statement-breakpoint
CREATE TYPE "public"."operator_role" AS ENUM('SUPER_ADMIN', 'PRODUCTION_OPERATOR', 'QUALITY_INSPECTOR', 'INVENTORY_MANAGER', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."qc_status" AS ENUM('PENDING', 'PASSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."qr_status" AS ENUM('PENDING', 'GENERATED');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" varchar(120) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" text NOT NULL,
	"request_id" varchar(100),
	"station_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_code" varchar(64) NOT NULL,
	"product_variant_id" varchar(100) NOT NULL,
	"planned_quantity" integer NOT NULL,
	"status" "batch_status" DEFAULT 'READY' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"previous_state" varchar(80),
	"new_state" varchar(80),
	"actor_id" uuid,
	"station_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"public_slug" varchar(64) NOT NULL,
	"canonical_url" text NOT NULL,
	"lifecycle_status" "lifecycle_status" DEFAULT 'CREATED' NOT NULL,
	"qr_status" "qr_status" DEFAULT 'PENDING' NOT NULL,
	"nfc_status" "nfc_status" DEFAULT 'PENDING' NOT NULL,
	"qc_status" "qc_status" DEFAULT 'PENDING' NOT NULL,
	"inventory_status" "inventory_status" DEFAULT 'NOT_READY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfc_encoding_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"result" "attempt_result" NOT NULL,
	"error_code" varchar(80),
	"expected_url_hash" varchar(64) NOT NULL,
	"readback_url_hash" varchar(64),
	"device_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"role" "operator_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"assigned_station_id" uuid,
	"claimed_by" uuid,
	"claim_idempotency_key" uuid,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"station_code" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"credential_hash" text NOT NULL,
	"status" "station_status" DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"format" varchar(10) NOT NULL,
	"storage_key" text NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"width" integer,
	"height" integer,
	"generator_version" varchar(100) NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"inspector_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"result" "check_result" NOT NULL,
	"reason" text,
	"evidence_reference" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_station_id_production_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."production_stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_station_id_production_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."production_stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_batch_id_card_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."card_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfc_encoding_attempts" ADD CONSTRAINT "nfc_encoding_attempts_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfc_encoding_attempts" ADD CONSTRAINT "nfc_encoding_attempts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfc_encoding_attempts" ADD CONSTRAINT "nfc_encoding_attempts_station_id_production_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."production_stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_batch_id_card_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."card_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_assigned_station_id_production_stations_id_fk" FOREIGN KEY ("assigned_station_id") REFERENCES "public"."production_stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_artifacts" ADD CONSTRAINT "qr_artifacts_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_artifacts" ADD CONSTRAINT "qr_artifacts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_batches_code_unique" ON "card_batches" USING btree ("batch_code");--> statement-breakpoint
CREATE INDEX "card_events_card_created_idx" ON "card_events" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_public_slug_unique" ON "cards" USING btree ("public_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_canonical_url_unique" ON "cards" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "cards_batch_idx" ON "cards" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nfc_attempts_idempotency_unique" ON "nfc_encoding_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "nfc_attempts_job_idx" ON "nfc_encoding_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_email_unique" ON "operators" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_card_type_unique" ON "production_jobs" USING btree ("card_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_claim_key_unique" ON "production_jobs" USING btree ("claim_idempotency_key");--> statement-breakpoint
CREATE INDEX "production_jobs_queue_idx" ON "production_jobs" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "production_jobs_station_idx" ON "production_jobs" USING btree ("assigned_station_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "production_stations_code_unique" ON "production_stations" USING btree ("station_code");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_artifacts_idempotency_unique" ON "qr_artifacts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_checks_idempotency_unique" ON "quality_checks" USING btree ("idempotency_key");