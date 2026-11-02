import { z } from "zod";

export const operatorRoles = [
  "SUPER_ADMIN",
  "PRODUCTION_OPERATOR",
  "QUALITY_INSPECTOR",
  "INVENTORY_MANAGER",
  "AUDITOR",
] as const;
export const OperatorRoleSchema = z.enum(operatorRoles);
export type OperatorRole = z.infer<typeof OperatorRoleSchema>;

export const jobTypes = ["QR_GENERATION", "NFC_ENCODING", "QUALITY_CONTROL"] as const;
export const JobTypeSchema = z.enum(jobTypes);
export type JobType = z.infer<typeof JobTypeSchema>;

export const jobStatuses = [
  "QUEUED",
  "CLAIMED",
  "RETRYABLE_FAILURE",
  "COMPLETED",
  "CANCELLED",
] as const;
export const JobStatusSchema = z.enum(jobStatuses);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const nfcFailureCategories = [
  "TAG_NOT_DETECTED",
  "UNSUPPORTED_TAG",
  "NOT_NDEF_FORMATTED",
  "TAG_READ_ONLY_OR_LOCKED",
  "WRITE_FAILED",
  "READBACK_FAILED",
  "READBACK_MISMATCH",
  "UNEXPECTED_CARD_OR_DUPLICATE_ASSIGNMENT",
  "DEVICE_DISCONNECTED",
  "RESULT_SUBMISSION_FAILED",
] as const;
export const NfcFailureCategorySchema = z.enum(nfcFailureCategories);

export const CreateBatchSchema = z.object({
  batchCode: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  productVariantId: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(1_000),
});

export const RegisterStationSchema = z.object({
  stationCode: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ClaimJobSchema = z.object({
  idempotencyKey: z.uuid(),
});

export const QrResultSchema = z.object({
  idempotencyKey: z.uuid(),
  format: z.enum(["PNG", "SVG", "PDF"]),
  storageKey: z.string().trim().min(1).max(500),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  generatorVersion: z.string().trim().min(1).max(100),
});

export const NfcAttemptSchema = z
  .object({
    idempotencyKey: z.uuid(),
    result: z.enum(["SUCCEEDED", "FAILED"]),
    expectedUrlHash: z.string().regex(/^[a-f0-9]{64}$/),
    readbackUrlHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    errorCode: NfcFailureCategorySchema.optional(),
    deviceMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, context) => {
    if (value.result === "SUCCEEDED" && !value.readbackUrlHash) {
      context.addIssue({ code: "custom", path: ["readbackUrlHash"], message: "Required on success" });
    }
    if (value.result === "FAILED" && !value.errorCode) {
      context.addIssue({ code: "custom", path: ["errorCode"], message: "Required on failure" });
    }
  });

export const QualityCheckSchema = z.object({
  idempotencyKey: z.uuid(),
  result: z.enum(["PASSED", "FAILED"]),
  reason: z.string().trim().min(3).max(1_000).optional(),
  evidenceReference: z.string().trim().max(500).optional(),
});

const OptionalContactSchema = z.string().trim().max(320).optional().or(z.literal(""));

export const ProfileLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.url().max(500),
  sortOrder: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

export const CreateProfileSchema = z.object({
  publicSlug: z.string().trim().min(3).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().trim().min(2).max(120),
  headline: z.string().trim().max(160).default(""),
  company: z.string().trim().max(120).default(""),
  bio: z.string().trim().max(600).default(""),
  phone: OptionalContactSchema.default(""),
  email: z.union([z.email(), z.literal("")]).default(""),
  website: z.union([z.url(), z.literal("")]).default(""),
  avatarUrl: z.union([z.url(), z.literal("")]).default(""),
  theme: z.enum(["MIDNIGHT", "IVORY", "MINT"]).default("MIDNIGHT"),
  published: z.boolean().default(false),
  links: z.array(ProfileLinkSchema).max(12).default([]),
});

export const UpdateProfileSchema = CreateProfileSchema.omit({ publicSlug: true }).partial();

export const AssignCardSchema = z.object({
  cardId: z.uuid(),
});

export const PairNfcDeviceSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  deviceName: z.string().trim().min(2).max(120),
  runtimeVersion: z.string().trim().max(80).default(""),
});

export const CreateNfcBridgeSessionSchema = z.object({
  jobId: z.uuid(),
  expectedUrl: z.url().max(500),
});

export const NfcBridgeResultSchema = z
  .object({
    result: z.enum(["SUCCEEDED", "FAILED"]),
    expectedUrl: z.url().max(500),
    readbackUrl: z.url().max(500).optional(),
    errorCode: NfcFailureCategorySchema.optional(),
    deviceMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, context) => {
    if (value.result === "SUCCEEDED" && !value.readbackUrl) {
      context.addIssue({ code: "custom", path: ["readbackUrl"], message: "Required on success" });
    }
    if (value.result === "FAILED" && !value.errorCode) {
      context.addIssue({ code: "custom", path: ["errorCode"], message: "Required on failure" });
    }
  });

export const NfcReadRecordSchema = z.object({
  tnf: z.number().int().min(0).max(7),
  type: z.string().max(100),
  idHex: z.string().max(512).default(""),
  payloadHex: z.string().max(16_384),
  payloadText: z.string().max(4_096).optional(),
  uri: z.string().max(2_048).optional(),
});

export const NfcReadResultSchema = z.object({
  uid: z.string().regex(/^[A-Fa-f0-9]*$/).max(128),
  techList: z.array(z.string().max(200)).max(32),
  ndefFormatted: z.boolean(),
  ndefType: z.string().max(120).optional(),
  writable: z.boolean().optional(),
  maxSize: z.number().int().nonnegative().optional(),
  messageSize: z.number().int().nonnegative().optional(),
  records: z.array(NfcReadRecordSchema).max(64).default([]),
  deviceMetadata: z.record(z.string(), z.unknown()).default({}),
  errorCode: z.string().max(100).optional(),
});

export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;
export type RegisterStationInput = z.infer<typeof RegisterStationSchema>;
export type QrResultInput = z.infer<typeof QrResultSchema>;
export type NfcAttemptInput = z.infer<typeof NfcAttemptSchema>;
export type QualityCheckInput = z.infer<typeof QualityCheckSchema>;
export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type PairNfcDeviceInput = z.infer<typeof PairNfcDeviceSchema>;
export type CreateNfcBridgeSessionInput = z.infer<typeof CreateNfcBridgeSessionSchema>;
export type NfcBridgeResultInput = z.infer<typeof NfcBridgeResultSchema>;
export type NfcReadResultInput = z.infer<typeof NfcReadResultSchema>;
