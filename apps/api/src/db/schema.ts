import type { ProductVariant } from "@oneinfo/contracts";
import { randomUUID } from "node:crypto";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const operatorRole = pgEnum("operator_role", [
  "SUPER_ADMIN",
  "PRODUCTION_OPERATOR",
  "QUALITY_INSPECTOR",
  "INVENTORY_MANAGER",
  "AUDITOR",
]);
export const stationStatus = pgEnum("station_status", ["ACTIVE", "REVOKED"]);
export const batchStatus = pgEnum("batch_status", ["DRAFT", "READY", "IN_PRODUCTION", "COMPLETED"]);
export const lifecycleStatus = pgEnum("lifecycle_status", [
  "CREATED",
  "IN_PRODUCTION",
  "QC_PASSED",
  "QUARANTINED",
  "ACTIVATED",
  "SUSPENDED",
  "REPLACED",
  "RETIRED",
]);
export const qrStatus = pgEnum("qr_status", ["PENDING", "GENERATED"]);
export const nfcStatus = pgEnum("nfc_status", ["PENDING", "WRITTEN"]);
export const qcStatus = pgEnum("qc_status", ["PENDING", "PASSED", "FAILED"]);
export const inventoryStatus = pgEnum("inventory_status", ["NOT_READY", "SALEABLE", "RESERVED", "DISPATCHED"]);
export const jobType = pgEnum("job_type", ["QR_GENERATION", "NFC_ENCODING", "QUALITY_CONTROL"]);
export const jobStatus = pgEnum("job_status", [
  "QUEUED",
  "CLAIMED",
  "RETRYABLE_FAILURE",
  "COMPLETED",
  "CANCELLED",
]);
export const attemptResult = pgEnum("attempt_result", ["SUCCEEDED", "FAILED"]);
export const checkResult = pgEnum("check_result", ["PASSED", "FAILED"]);
export const profileTheme = pgEnum("profile_theme", ["MIDNIGHT", "IVORY", "MINT"]);

export const operators = pgTable(
  "operators",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    role: operatorRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("operators_email_unique").on(table.email)],
);

export const productionStations = pgTable(
  "production_stations",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    stationCode: varchar("station_code", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    credentialHash: text("credential_hash").notNull(),
    status: stationStatus("status").notNull().default("ACTIVE"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("production_stations_code_unique").on(table.stationCode)],
);

export const customerProfiles = pgTable(
  "customer_profiles",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    ownerOperatorId: uuid("owner_operator_id").references(() => operators.id, { onDelete: "set null" }),
    publicSlug: varchar("public_slug", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    headline: varchar("headline", { length: 160 }).notNull().default(""),
    company: varchar("company", { length: 120 }).notNull().default(""),
    bio: text("bio").notNull().default(""),
    phone: varchar("phone", { length: 40 }).notNull().default(""),
    email: varchar("email", { length: 320 }).notNull().default(""),
    website: text("website").notNull().default(""),
    avatarUrl: text("avatar_url").notNull().default(""),
    theme: profileTheme("theme").notNull().default("MIDNIGHT"),
    published: boolean("published").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customer_profiles_slug_unique").on(table.publicSlug),
    index("customer_profiles_owner_idx").on(table.ownerOperatorId),
  ],
);

export const profileLinks = pgTable(
  "profile_links",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    profileId: uuid("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 40 }).notNull(),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profile_links_profile_sort_idx").on(table.profileId, table.sortOrder)],
);

export const cardBatches = pgTable(
  "card_batches",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    batchCode: varchar("batch_code", { length: 64 }).notNull(),
    productVariantId: varchar("product_variant_id", { length: 100 }).notNull(),
    plannedQuantity: integer("planned_quantity").notNull(),
    status: batchStatus("status").notNull().default("READY"),
    createdBy: uuid("created_by").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("card_batches_code_unique").on(table.batchCode)],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    batchId: uuid("batch_id").notNull().references(() => cardBatches.id, { onDelete: "restrict" }),
    profileId: uuid("profile_id").references(() => customerProfiles.id, { onDelete: "set null" }),
    publicSlug: varchar("public_slug", { length: 64 }).notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    lifecycleStatus: lifecycleStatus("lifecycle_status").notNull().default("CREATED"),
    qrStatus: qrStatus("qr_status").notNull().default("PENDING"),
    nfcStatus: nfcStatus("nfc_status").notNull().default("PENDING"),
    qcStatus: qcStatus("qc_status").notNull().default("PENDING"),
    inventoryStatus: inventoryStatus("inventory_status").notNull().default("NOT_READY"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cards_public_slug_unique").on(table.publicSlug),
    uniqueIndex("cards_canonical_url_unique").on(table.canonicalUrl),
    index("cards_batch_idx").on(table.batchId),
    index("cards_profile_idx").on(table.profileId),
  ],
);

export const productionJobs = pgTable(
  "production_jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    batchId: uuid("batch_id").notNull().references(() => cardBatches.id, { onDelete: "restrict" }),
    cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
    type: jobType("type").notNull(),
    status: jobStatus("status").notNull().default("QUEUED"),
    assignedStationId: uuid("assigned_station_id").references(() => productionStations.id, { onDelete: "restrict" }),
    claimedBy: uuid("claimed_by"),
    claimIdempotencyKey: uuid("claim_idempotency_key"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("production_jobs_card_type_unique").on(table.cardId, table.type),
    uniqueIndex("production_jobs_claim_key_unique").on(table.claimIdempotencyKey),
    index("production_jobs_queue_idx").on(table.status, table.type),
    index("production_jobs_station_idx").on(table.assignedStationId, table.status),
  ],
);

export const qrArtifacts = pgTable(
  "qr_artifacts",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    jobId: uuid("job_id").notNull().references(() => productionJobs.id, { onDelete: "restrict" }),
    cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    format: varchar("format", { length: 10 }).notNull(),
    storageKey: text("storage_key").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    width: integer("width"),
    height: integer("height"),
    generatorVersion: varchar("generator_version", { length: 100 }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("qr_artifacts_idempotency_unique").on(table.idempotencyKey)],
);

export const nfcEncodingAttempts = pgTable(
  "nfc_encoding_attempts",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    jobId: uuid("job_id").notNull().references(() => productionJobs.id, { onDelete: "restrict" }),
    cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
    stationId: uuid("station_id").notNull().references(() => productionStations.id, { onDelete: "restrict" }),
    operatorId: uuid("operator_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    result: attemptResult("result").notNull(),
    errorCode: varchar("error_code", { length: 80 }),
    expectedUrlHash: varchar("expected_url_hash", { length: 64 }).notNull(),
    readbackUrlHash: varchar("readback_url_hash", { length: 64 }),
    deviceMetadata: jsonb("device_metadata").$type<Record<string, unknown>>().notNull().default({}),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("nfc_attempts_idempotency_unique").on(table.idempotencyKey),
    index("nfc_attempts_job_idx").on(table.jobId),
  ],
);

export const qualityChecks = pgTable(
  "quality_checks",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    jobId: uuid("job_id").notNull().references(() => productionJobs.id, { onDelete: "restrict" }),
    cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
    inspectorId: uuid("inspector_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    result: checkResult("result").notNull(),
    reason: text("reason"),
    evidenceReference: text("evidence_reference"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("quality_checks_idempotency_unique").on(table.idempotencyKey)],
);

export const cardEvents = pgTable(
  "card_events",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    previousState: varchar("previous_state", { length: 80 }),
    newState: varchar("new_state", { length: 80 }),
    actorId: uuid("actor_id"),
    stationId: uuid("station_id").references(() => productionStations.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("card_events_card_created_idx").on(table.cardId, table.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }).notNull(),
    targetId: text("target_id").notNull(),
    requestId: varchar("request_id", { length: 100 }),
    stationId: uuid("station_id").references(() => productionStations.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_target_idx").on(table.targetType, table.targetId)],
);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  slug: varchar("slug", { length: 80 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  subtitle: varchar("subtitle", { length: 100 }).notNull().default(""),
  description: text("description").notNull().default(""),
  priceMinor: integer("price_minor").notNull(),
  variants: jsonb("variants").$type<ProductVariant[]>().notNull().default([]),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  finish: varchar("finish", { length: 80 }).notNull().default(""),
  appearance: varchar("appearance", { length: 10 }).notNull().default("light"),
  imageUrl: text("image_url").notNull().default(""),
  status: varchar("status", { length: 12 }).notNull().default("DRAFT"),
  featured: boolean("featured").notNull().default(false),
  badge: varchar("badge", { length: 40 }).notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, table => [uniqueIndex("products_slug_unique").on(table.slug), index("products_catalog_idx").on(table.status, table.sortOrder)]);
