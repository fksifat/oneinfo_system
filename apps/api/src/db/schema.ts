import type { CustomerProfileSchema, OrderLine, PlaceOrderInput, ProductVariant, ShippingRates, ShippingZone, profileModes, profileSources } from "@oneinfo/contracts";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  bigint,
  boolean,
  date,
  check,
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
import { sql } from "drizzle-orm";

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
    handle: varchar("handle", { length: 64 }),
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
    profileMode: text("profile_mode").$type<typeof profileModes[number]>().notNull().default("BUSINESS"),
    modeContent: jsonb("mode_content").$type<z.infer<typeof CustomerProfileSchema>["modeContent"]>().notNull().default({}),
    published: boolean("published").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customer_profiles_slug_unique").on(table.publicSlug),
    uniqueIndex("customer_profiles_handle_unique").on(sql`lower(${table.handle})`),
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

export const profileActivity = pgTable("profile_activity", {
  profileId: uuid("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  mode: text("mode").$type<typeof profileModes[number]>().notNull(),
  campaign: varchar("campaign", { length: 120 }).notNull(),
  source: text("source").$type<typeof profileSources[number]>().notNull(),
  event: varchar("event", { length: 72 }).notNull(),
  total: integer("total").notNull().default(1),
}, table => [uniqueIndex("profile_activity_bucket_unique").on(table.profileId, table.day, table.mode, table.campaign, table.source, table.event)]);

export const customerAccounts = pgTable("customer_accounts", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  email: varchar("email", { length: 254 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  authVersion: integer("auth_version").notNull().default(0),
  profileId: uuid("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "restrict" }),
  active: boolean("active").notNull().default(true),
  ...timestamps,
}, table => [uniqueIndex("customer_accounts_email_unique").on(table.email), uniqueIndex("customer_accounts_profile_unique").on(table.profileId)]);

export const customerContactLeads = pgTable("customer_contact_leads", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  accountId: uuid("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  message: text("message").notNull(),
  recipientName: varchar("recipient_name", { length: 120 }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
  crmAllowed: boolean("crm_allowed").notNull().default(false),
}, table => [
  uniqueIndex("customer_contact_leads_request_unique").on(table.accountId, table.requestId),
  index("customer_contact_leads_inbox_idx").on(table.accountId, table.createdAt, table.id),
]);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  ownerAccountId: uuid("owner_account_id").notNull().references(() => customerAccounts.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 120 }).notNull(),
  domain: varchar("domain", { length: 253 }),
  logoUrl: text("logo_url").notNull().default(""),
  headline: varchar("headline", { length: 160 }).notNull().default(""),
  bio: text("bio").notNull().default(""),
  theme: profileTheme("theme").notNull().default("MIDNIGHT"),
  allowEmployeeEdits: boolean("allow_employee_edits").notNull().default(false),
  ...timestamps,
}, table => [uniqueIndex("companies_domain_unique").on(table.domain), index("companies_owner_idx").on(table.ownerAccountId)]);

export const companyEmployees = pgTable("company_employees", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  profileId: uuid("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "restrict" }),
  email: varchar("email", { length: 254 }).notNull(),
  active: boolean("active").notNull().default(true),
  editTokenHash: varchar("edit_token_hash", { length: 64 }),
  editTokenExpiresAt: timestamp("edit_token_expires_at", { withTimezone: true }),
  inviteEmailStatus: text("invite_email_status").$type<"pending" | "sending" | "accepted" | "failed">(),
  inviteEmailUpdatedAt: timestamp("invite_email_updated_at", { withTimezone: true }),
  ...timestamps,
}, table => [uniqueIndex("company_employees_email_unique").on(table.companyId, table.email),
  uniqueIndex("company_employees_profile_unique").on(table.profileId), uniqueIndex("company_employees_edit_token_unique").on(table.editTokenHash),
  index("company_employees_invite_queue_idx").on(table.inviteEmailStatus, table.inviteEmailUpdatedAt).where(sql`${table.inviteEmailStatus} in ('pending', 'sending')`)]);

export const cardBatches = pgTable(
  "card_batches",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    batchCode: varchar("batch_code", { length: 64 }).notNull(),
    productVariantId: varchar("product_variant_id", { length: 100 }).notNull(),
    plannedQuantity: integer("planned_quantity").notNull(),
    status: batchStatus("status").notNull().default("READY"),
    createdBy: uuid("created_by").notNull(),
    printConfirmedAt: timestamp("print_confirmed_at", { withTimezone: true }),
    printConfirmedBy: uuid("print_confirmed_by").references(() => operators.id, { onDelete: "restrict" }),
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
    customerAccountId: uuid("customer_account_id").references(() => customerAccounts.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "restrict" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
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
    index("cards_company_idx").on(table.companyId),
  ],
);

export const cardActivationSecrets = pgTable("card_activation_secrets", {
  cardId: uuid("card_id").primaryKey().references(() => cards.id, { onDelete: "restrict" }),
  codeHash: varchar("code_hash", { length: 64 }),
  version: uuid("version").notNull().$defaultFn(randomUUID),
  issuedBy: uuid("issued_by").notNull().references(() => operators.id, { onDelete: "restrict" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
});

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
    imageData: text("image_data"),
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

export const cardVerifications = pgTable("card_verifications", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
  stationId: uuid("station_id").notNull().references(() => productionStations.id, { onDelete: "restrict" }),
  method: varchar("method", { length: 20 }).notNull(),
  expectedUrl: text("expected_url").notNull(),
  scannedValue: text("scanned_value").notNull(),
  matched: boolean("matched").notNull(),
  uid: varchar("uid", { length: 128 }),
  deviceMetadata: jsonb("device_metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("card_verifications_card_idx").on(table.cardId, table.createdAt)]);

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
  warranty: text("warranty").notNull().default(""),
  warrantyIsDemo: boolean("warranty_is_demo").notNull().default(false),
  customizable: boolean("customizable").notNull().default(false),
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

export const storeShippingSettings = pgTable("store_shipping_settings", {
  id: text("id").primaryKey(),
  rates: jsonb("rates").$type<ShippingRates>().notNull(),
  codAdvanceTaka: integer("cod_advance_taka").notNull().default(100),
});

export const accountTokens = pgTable("account_tokens", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  purpose: text("purpose").$type<"verify" | "reset" | "invite">().notNull(),
  details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const teamEnquiries = pgTable("team_enquiries", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  requestId: uuid("request_id").notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(),
  company: varchar("company", { length: 120 }).notNull(),
  quantity: varchar("quantity", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderEmails = pgTable("order_emails", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"confirmation" | "payment" | "shipping" | "delivery">().notNull(),
  status: text("status").$type<"pending" | "sending" | "accepted" | "failed">().notNull().default("pending"),
  claimId: uuid("claim_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("order_emails_kind_unique").on(table.orderId, table.kind), index("order_emails_pending_idx").on(table.status, table.updatedAt)]);

export const storeCoupons = pgTable("store_coupons", {
  code: varchar("code", { length: 32 }).primaryKey(),
  percent: integer("percent").notNull(),
  active: boolean("active").notNull(),
});

export const storeOrders = pgTable("store_orders", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  activationMethod: text("activation_method").$type<"LEGACY" | "ORDER_SECRET">().notNull().default("LEGACY"),
  packedAt: timestamp("packed_at", { withTimezone: true }),
  invoiceNumber: varchar("invoice_number", { length: 15 }),
  profileId: uuid("profile_id").references(() => customerProfiles.id, { onDelete: "set null" }),
  requestId: uuid("request_id").notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  customer: jsonb("customer").$type<PlaceOrderInput["customer"]>().notNull(),
  deliveryAddress: jsonb("delivery_address").$type<PlaceOrderInput["deliveryAddress"]>().notNull(),
  items: jsonb("items").$type<OrderLine[]>().notNull(),
  shippingZone: text("shipping_zone").$type<ShippingZone>().notNull(),
  subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
  shippingMinor: integer("shipping_minor").notNull(),
  couponCode: varchar("coupon_code", { length: 32 }),
  discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
  paymentMethod: text("payment_method").$type<NonNullable<PlaceOrderInput["payment"]>["method"]>().notNull().default("COD"),
  paymentAmountMinor: bigint("payment_amount_minor", { mode: "number" }).notNull().default(0),
  transactionId: varchar("transaction_id", { length: 20 }),
  paymentVerifiedAt: timestamp("payment_verified_at", { withTimezone: true }),
  processingAt: timestamp("processing_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  courierTrackingId: varchar("courier_tracking_id", { length: 100 }),
  codCollectedMinor: bigint("cod_collected_minor", { mode: "number" }),
  codSettledMinor: bigint("cod_settled_minor", { mode: "number" }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  stockReservations: jsonb("stock_reservations").$type<Array<{ productId: string; variantId: string; quantity: number }>>(),
  awaitingPayment: boolean("awaiting_payment").notNull().default(false),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("store_orders_transaction_unique").on(table.transactionId),
  uniqueIndex("store_orders_invoice_unique").on(table.invoiceNumber),
  uniqueIndex("store_orders_request_unique").on(table.requestId),
  index("store_orders_created_idx").on(table.createdAt, table.id),
]);

export const storeReviewInvites = pgTable("store_review_invites", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "restrict" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("store_review_invites_order_unique").on(table.orderId),
  uniqueIndex("store_review_invites_token_unique").on(table.tokenHash),
]);

export const storeReviews = pgTable("store_reviews", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  displayName: varchar("display_name", { length: 60 }).notNull(),
  rating: integer("rating").notNull(),
  title: varchar("title", { length: 100 }).notNull(),
  body: varchar("body", { length: 1200 }).notNull(),
  status: varchar("status", { length: 12 }).$type<"PENDING" | "PUBLISHED" | "REJECTED">().notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("store_reviews_order_product_unique").on(table.orderId, table.productId),
  index("store_reviews_public_idx").on(table.productId, table.status, table.createdAt),
  check("store_reviews_rating_check", sql`${table.rating} between 1 and 5`),
  check("store_reviews_status_check", sql`${table.status} in ('PENDING', 'PUBLISHED', 'REJECTED')`),
]);
export const orderCardAllocations = pgTable("order_card_allocations", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "restrict" }),
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "restrict" }),
  lineIndex: integer("line_index").notNull(),
  unitIndex: integer("unit_index").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("order_card_allocations_card_unique").on(table.cardId),
  uniqueIndex("order_card_allocations_unit_unique").on(table.orderId, table.lineIndex, table.unitIndex)]);

export const orderActivationProfiles = pgTable("order_activation_profiles", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "restrict" }),
  profileId: uuid("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "restrict" }),
  lineIndex: integer("line_index").notNull(),
  unitIndex: integer("unit_index").notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  encryptedCode: text("encrypted_code"),
  cardId: uuid("card_id").references(() => cards.id, { onDelete: "restrict" }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("order_activation_profiles_unit_unique").on(table.orderId, table.lineIndex, table.unitIndex),
  uniqueIndex("order_activation_profiles_profile_unique").on(table.profileId),
  uniqueIndex("order_activation_profiles_code_unique").on(table.codeHash),
  uniqueIndex("order_activation_profiles_card_unique").on(table.cardId)]);
