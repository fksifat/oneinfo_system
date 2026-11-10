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
export const HttpUrlSchema = z.url().max(500).refine((value) => /^https?:\/\//i.test(value), "Only HTTP and HTTPS URLs are allowed");

export const CreateBatchSchema = z.object({
  batchCode: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  productVariantId: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(1_000),
  links: z.array(HttpUrlSchema).min(1).max(1_000).optional(),
}).superRefine((value, context) => {
  if (value.links && (value.links.length !== value.quantity || new Set(value.links).size !== value.links.length)) {
    context.addIssue({ code: "custom", path: ["links"], message: "Provide exactly one unique URL for each card" });
  }
});

export const GenerateBatchQrSchema = z.object({ cardId: z.uuid().optional() });
export const ConfirmBatchPrintSchema = z.object({ confirmed: z.literal(true) });
export const VerificationMethodSchema = z.enum(["QR_CAMERA", "NFC_READ"]);
export const CreateVerificationSchema = z.object({ cardId: z.uuid(), method: VerificationMethodSchema });
export const StartQrVerificationSchema = z.object({ scanId: z.uuid(), scannedValue: HttpUrlSchema });
export const ScanActionSchema = z.object({ scanId: z.uuid() });
export const NfcUtilitySchema = z.union([
  z.object({ operation: z.literal("READ") }),
  z.object({ operation: z.literal("ERASE"), overwriteConfirmed: z.literal(true) }),
  z.object({ operation: z.literal("WRITE"), recordType: z.literal("URL"), value: HttpUrlSchema, overwriteConfirmed: z.literal(true) }),
  z.object({ operation: z.literal("WRITE"), recordType: z.literal("TEXT"), value: z.string().min(1).max(2_048).refine((value) => value.trim().length > 0, "Enter text to write"), overwriteConfirmed: z.literal(true) }),
]);
export type NfcUtilityInput = z.infer<typeof NfcUtilitySchema>;
export const VerificationResultSchema = z.object({
  scannedValue: z.string().max(2_048),
  uid: z.string().max(128).optional(),
  errorCode: z.string().max(100).optional(),
  deviceMetadata: z.record(z.string(), z.unknown()).default({}),
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
    if (value.result === "SUCCEEDED" && value.expectedUrlHash !== value.readbackUrlHash) {
      context.addIssue({ code: "custom", path: ["readbackUrlHash"], message: "Read-back must match expected URL hash" });
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

const OptionalContactSchema = z.string().trim().max(40);

export const ProfileLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: HttpUrlSchema,
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
  website: z.union([HttpUrlSchema, z.literal("")]).default(""),
  avatarUrl: z.union([HttpUrlSchema, z.literal("")]).default(""),
  theme: z.enum(["MIDNIGHT", "IVORY", "MINT"]).default("MIDNIGHT"),
  published: z.boolean().default(false),
  links: z.array(ProfileLinkSchema).max(12).default([]),
});

export const UpdateProfileSchema = CreateProfileSchema.omit({ publicSlug: true }).partial();

export const AssignCardSchema = z.object({
  cardId: z.uuid(),
});

export const profileModes = ["BUSINESS", "EVENT", "PORTFOLIO"] as const;
export { contactVcard } from "./contact.js";
export const profileSources = ["NFC", "QR", "DIRECT"] as const;
export const ProfileModeContentSchema = z.object({ title: z.string().trim().max(120), description: z.string().trim().max(600) });
export const ProfileModesSchema = z.object({ EVENT: ProfileModeContentSchema.optional(), PORTFOLIO: ProfileModeContentSchema.optional() });
export const CustomerProfileSchema = CreateProfileSchema.omit({ publicSlug: true, published: true }).extend({
  profileMode: z.enum(profileModes).default("BUSINESS"), modeContent: ProfileModesSchema.default({}),
});

export const ShareContactSchema = z.object({
  requestId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  email: z.union([z.email().max(254), z.literal("")]).default(""),
  phone: z.string().trim().max(40).refine(value => !value || (/^\+?[\d(). -]+$/.test(value) && value.replace(/\D/g, "").length >= 5), "Enter a valid phone number.").default(""),
  message: z.string().trim().max(600).default(""),
  consent: z.literal(true),
  crmAllowed: z.boolean().default(false),
  source: z.enum(profileSources).default("DIRECT"),
}).refine(value => Boolean(value.email || value.phone), "Enter an email address or phone number.");

export type ContactLead = { id: string; name: string; email: string; phone: string; message: string; createdAt: string; forwardedAt?: string | null;
  crmAllowed?: boolean; recipientName?: string | null };
export const CustomerPasswordSchema = z.string().min(12).max(128);
export const CustomerEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const ActivateCardSchema = z.object({
  secretCode: z.string().max(64).transform(value => value.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-F0-9]{20}$/, "Enter the secret code supplied with your card")),
});
export const CustomerSignupSchema = z.object({
  claimToken: z.string().max(2048), email: CustomerEmailSchema, password: CustomerPasswordSchema, profile: CustomerProfileSchema,
});
export const CustomerLoginSchema = z.object({ email: CustomerEmailSchema, password: z.string().min(1).max(128) });
export const ClaimCardSchema = z.object({ claimToken: z.string().max(2048), profile: CustomerProfileSchema });
export const IssueActivationCodeSchema = z.object({ replaceExisting: z.boolean().default(false) });

export const PairNfcDeviceSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  pairingSecret: z.string().min(32).max(128).optional(),
  deviceCredential: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  deviceName: z.string().trim().min(2).max(120),
  runtimeVersion: z.string().trim().max(80).default(""),
});

export const CreateNfcBridgeSessionSchema = z.object({
  jobId: z.uuid(),
  expectedUrl: HttpUrlSchema,
});

export const NfcBridgeResultSchema = z
  .object({
    result: z.enum(["SUCCEEDED", "FAILED"]),
    expectedUrl: HttpUrlSchema,
    readbackUrl: HttpUrlSchema.optional(),
    errorCode: NfcFailureCategorySchema.optional(),
    deviceMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, context) => {
    if (value.result === "SUCCEEDED" && !value.readbackUrl) {
      context.addIssue({ code: "custom", path: ["readbackUrl"], message: "Required on success" });
    }
    if (value.result === "SUCCEEDED" && value.expectedUrl !== value.readbackUrl) {
      context.addIssue({ code: "custom", path: ["readbackUrl"], message: "Read-back must match expected URL" });
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

function resolveDriveMediaUrl(path: string, format?: "glb"): string {
  if (!path.startsWith("https://drive.google.com/")) return path;
  const share = new URL(path);
  const fileId = /^\/file\/d\/([\w-]+)(?:\/(?:view|preview))?\/?$/.exec(share.pathname)?.[1]
    ?? (share.pathname === "/open" ? share.searchParams.get("id") : null);
  if (!fileId || !/^[\w-]{1,128}$/.test(fileId)) return path;

  const media = new URL(`/api/v1/product-media/drive/${fileId}`, share.origin);
  const resourceKey = share.searchParams.get("resourcekey");
  if (resourceKey) media.searchParams.set("resourcekey", resourceKey);
  if (format) media.searchParams.set("format", format);
  return media.pathname + media.search;
}

export const resolveProductImageUrl = (path: string) => resolveDriveMediaUrl(path);
export const resolveProductModelUrl = (path: string) => resolveDriveMediaUrl(path, "glb");

export const ProductImageSchema = z.union([
  z.string().regex(/^\/api\/v1\/product-media\/[a-f0-9-]{36}\.(?:png|jpg|webp|svg)$/),
  z.url().max(2048).refine(value => /^https:\/\//i.test(value), "Use an HTTPS image URL"),
  z.string().regex(/^\/assets\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|svg)$/, "Use an HTTPS URL or a bundled /assets/ image"),
  z.literal(""),
]);
const MediaImageUrlSchema = ProductImageSchema.refine(value => value !== "", "Enter an image URL");
const VideoUrlSchema = z.union([
  z.string().regex(/^\/api\/v1\/product-media\/[a-f0-9-]{36}\.(?:mp4|webm)$/),
  z.url().max(2048).refine(value => /^https:\/\//i.test(value), "Use an HTTPS video URL"),
  z.string().regex(/^\/assets\/[a-zA-Z0-9/_-]+\.(?:mp4|webm)$/, "Use an HTTPS URL or bundled MP4/WebM"),
]);
const mediaBase = { id: z.uuid(), label: z.string().trim().max(80).default("") };
export const ProductMediaSchema = z.discriminatedUnion("type", [
  z.object({...mediaBase, type:z.literal("image"), url:MediaImageUrlSchema}),
  z.object({...mediaBase, type:z.literal("video"), url:VideoUrlSchema, poster:ProductImageSchema.default("")}),
  z.object({...mediaBase, type:z.literal("model"), url:z.string().trim().max(2048).refine(value =>
    /^\/api\/v1\/product-media\/[a-f0-9-]{36}\.glb$/.test(value) ||
    /^\/assets\/[a-zA-Z0-9/_-]+\.glb$/.test(value) ||
    (z.url().safeParse(value).success && /^https:\/\//i.test(value) &&
      (/\.glb$/i.test(new URL(value).pathname) || resolveProductModelUrl(value) !== value)),
    "Use a public Google Drive file link, direct HTTPS .glb URL, or bundled /assets/ path")}),
  z.object({...mediaBase, type:z.literal("spin"), frames:z.array(MediaImageUrlSchema).min(2).max(120)}),
]);
export type ProductMedia = z.infer<typeof ProductMediaSchema>;

export const ProductVariantSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(60),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour"),
  priceMinor: z.number().int().min(1).max(100_000_000),
  salePriceMinor: z.number().int().min(1).max(100_000_000).nullable().default(null),
  withoutLogoPriceMinor: z.number().int().min(1).max(100_000_000).nullable().default(null).optional(),
  withoutLogoSalePriceMinor: z.number().int().min(1).max(100_000_000).nullable().default(null).optional(),
  available: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
  finish: z.string().trim().max(80).default(""),
  appearance: z.enum(["light", "dark", "metal"]).default("light"),
  imageUrl: ProductImageSchema.default(""),
  backImageUrl: ProductImageSchema.default(""),
  showAllColourMedia: z.boolean().default(true),
  defaultMediaIndex: z.number().int().min(0).max(19).default(0),
  media: z.array(ProductMediaSchema).max(20).refine(items => new Set(items.map(m=>m.id)).size === items.length, "Media IDs must be unique").optional(),
}).refine(v => v.salePriceMinor === null || v.salePriceMinor < v.priceMinor, {
  path: ["salePriceMinor"], message: "Sale price must be lower than the regular price",
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;
export function printFinish(slug: string, appearance?: string) {
  return slug === "oneinfo-essential" && (appearance === "light" || appearance === "dark") ? appearance : null;
}
// Existing records are read as an ordinary image gallery until an admin saves it.
export function productMedia(v: Pick<ProductVariant, "media" | "imageUrl" | "backImageUrl">): ProductMedia[] {
  return v.media ?? [v.imageUrl, v.backImageUrl].filter(Boolean).map((url, i) => ({id:`legacy-${i}`,type:"image" as const,url,label:`Image ${i+1}`}));
}
export function productGallery(variants: ProductVariant[], selected: ProductVariant) {
  return (selected.showAllColourMedia === false ? [selected] : variants)
    .flatMap(variant => productMedia(variant).map((media, index) => ({variant, media, index})));
}
export const variantPrice = (v: Pick<ProductVariant, "priceMinor" | "salePriceMinor">) => v.salePriceMinor ?? v.priceMinor;
export const discountPercent = (v: Pick<ProductVariant, "priceMinor" | "salePriceMinor">) =>
  v.salePriceMinor === null || v.priceMinor <= 0 ? 0 : Math.floor((v.priceMinor - v.salePriceMinor) * 100 / v.priceMinor);

export const variantPriceForBranding = (
  v: Pick<ProductVariant, "priceMinor" | "salePriceMinor" | "withoutLogoPriceMinor" | "withoutLogoSalePriceMinor">,
  hasLogo: boolean = true
): number => {
  if (!hasLogo) {
    if (v.withoutLogoPriceMinor) {
      return v.withoutLogoSalePriceMinor ?? v.withoutLogoPriceMinor;
    }
    // Default surcharge of +500 BDT if withoutLogo price is unset by admin
    const base = v.salePriceMinor ?? v.priceMinor;
    return base + 50000;
  }
  return v.salePriceMinor ?? v.priceMinor;
};

export const variantRegularPriceForBranding = (
  v: Pick<ProductVariant, "priceMinor" | "withoutLogoPriceMinor">,
  hasLogo: boolean = true
): number => {
  if (!hasLogo) {
    if (v.withoutLogoPriceMinor) {
      return v.withoutLogoPriceMinor;
    }
    return v.priceMinor + 50000;
  }
  return v.priceMinor;
};

export const CardLayoutSchema = z.enum([
  "left",
  "center",
  "right",
  "reverse",
  "split-logo-left",
  "split-logo-right",
  "diagonal",
  "column",
  "header",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);
export type CardLayout = z.infer<typeof CardLayoutSchema>;

export const SurfaceMotifSchema = z.enum([
  "facets",
  "contour",
  "architectural",
  "inlay",
  "minimal",
]);
export type SurfaceMotif = z.infer<typeof SurfaceMotifSchema>;

export const HexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/i);

export const DividerLineSchema = z.object({
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  length: z.number().int().min(20).max(300).default(100),
  style: z.enum(["solid", "dashed"]).default("solid").optional(),
});
export type DividerLine = z.infer<typeof DividerLineSchema>;

export const ProductCustomizationSchema = z.object({
  name: z.string().trim().min(1).max(25),
  title: z.string().trim().max(35).optional().default(""),
  layout: CardLayoutSchema.default("left"),
  surfaceMotif: SurfaceMotifSchema.default("facets"),
  surfaceColor: HexColorSchema.default("#0a0b0d"),
  accentColor: HexColorSchema.default("#d8b26e"),
  font: z.enum(["sans", "serif", "mono"]).default("sans"),
  finish: z.enum(["matte", "brushed", "gloss"]).default("matte").optional(),
  position: z.string().optional(),
  presetId: z.string().max(30).optional(),
  backQrStyle: z.enum(["framed", "minimal", "badge"]).default("framed").optional(),
  backSubtitle: z.string().trim().max(80).default("").optional(),
  logoUrl: z.string().trim().max(500_000).optional(),
  logoStyle: z.enum(["original", "monochrome"]).default("original").optional(),
  companyName: z.string().trim().max(60).optional(),
  extraLines: z.array(z.string().trim().max(35)).max(5).default([]).optional(),
  textSize: z.number().int().min(8).max(26).default(14).optional(),
  logoSize: z.number().int().min(30).max(250).default(100).optional(),
  iconSize: z.number().int().min(30).max(250).default(100).optional(),
  qrSize: z.number().int().min(30).max(250).default(100).optional(),
  dividerLines: z.array(DividerLineSchema).max(4).default([]).optional(),
  brandingMode: z.enum(["with-logo", "without-logo"]).default("with-logo").optional(),
  hasOneinfoLogo: z.boolean().default(true).optional(),
  customPos: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).optional(),
  elementPositions: z.record(z.string(), z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).optional(),
});
export type ProductCustomization = z.infer<typeof ProductCustomizationSchema>;

export const ProductInputSchema = z.object({
  slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(100).default(""),
  description: z.string().trim().max(1000).default(""),
  warranty: z.string().trim().max(2000).default(""),
  warrantyIsDemo: z.boolean().default(false),
  customizable: z.boolean().default(false),
  variants: z.array(ProductVariantSchema).min(1).max(40).superRefine((variants, ctx) => {
    if (new Set(variants.map(v => v.id)).size !== variants.length)
      ctx.addIssue({ code: "custom", message: "Colour IDs must be unique" });
    if (new Set(variants.map(v => v.name.toLowerCase())).size !== variants.length)
      ctx.addIssue({ code: "custom", message: "Give each colour a unique name" });
  }),
  features: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  featured: z.boolean().default(false),
  badge: z.string().trim().max(40).default(""),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
});
export const UpdateProductSchema = ProductInputSchema.extend({ version: z.number().int().positive() });
export type ProductInput = z.infer<typeof ProductInputSchema>;
export type Product = ProductInput & { id: string; version: number; createdAt: string; updatedAt: string };

export const ShippingZoneSchema = z.enum(["insideDhaka", "subDhaka", "outsideDhaka"]);
export type ShippingZone = z.infer<typeof ShippingZoneSchema>;
const ShippingFeeSchema = z.number().int().min(0).max(1_000_000);
export const ShippingRatesSchema = z.object({
  insideDhaka: ShippingFeeSchema,
  subDhaka: ShippingFeeSchema,
  outsideDhaka: ShippingFeeSchema,
});
export type ShippingRates = z.infer<typeof ShippingRatesSchema>;
export const defaultShippingRates: ShippingRates = { insideDhaka: 6000, subDhaka: 10000, outsideDhaka: 12000 };
export const CodAdvanceSchema = z.number().int().min(0).max(10_000);
export const defaultCodAdvanceTaka = 100;
export const bkashNumber = "01760320810";
export const PaymentMethodSchema = z.enum(["COD", "BKASH"]);
export const BkashTransactionIdSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,20}$/);

export function paymentDueNow(totalMinor: number, method: z.infer<typeof PaymentMethodSchema>, codAdvanceTaka: number) {
  return method === "BKASH" ? totalMinor : Math.min(totalMinor, codAdvanceTaka * 100);
}

export const shippingZoneLabels: Record<ShippingZone, string> = {
  insideDhaka: "Inside Dhaka",
  subDhaka: "Sub-Dhaka",
  outsideDhaka: "Outside Dhaka",
};

export const DhakaAreaSchema = z.enum(["city", "suburb"]);
const normalizeDistrict = (district: string) => district.trim().toLowerCase().replace(/\s+(?:district|জেলা)$/u, "");
export const isDhakaDistrict = (district: string) => /^(?:dhaka|dacca|ঢাকা)(?:\s+(?:city|metro|সিটি))?$/u.test(normalizeDistrict(district));
const subDhakaName = /^(?:savar|ashulia|keraniganj|gazipur|gajipur|tongi|narayanganj|narayangonj|সাভার|আশুলিয়া|আশুলিয়া|কেরানীগঞ্জ|কেরানিগঞ্জ|গাজীপুর|গাজিপুর|টঙ্গী|টঙ্গি|নারায়ণগঞ্জ|নারায়ণগঞ্জ|নারায়নগঞ্জ|নারায়নগঞ্জ)$/u;
const dhakaCityName = /^(?:dhanmondi|gulshan|banani|motijheel|shahbagh|tejgaon|kathalbagan|ধানমন্ডি|ধানমণ্ডি|গুলশান|বনানী|মতিঝিল|শাহবাগ|তেজগাঁও|কাঁঠালবাগান|কাঠালবাগান)$/u;
export function suggestDhakaArea(address: string): z.infer<typeof DhakaAreaSchema> | undefined {
  const words = address.toLowerCase().split(/[^\p{L}\p{M}]+/u);
  if (words.some(word => subDhakaName.test(word))) return "suburb";
  if (words.some(word => dhakaCityName.test(word))) return "city";
  return undefined;
}
export function deliveryZone(district: string, area?: z.infer<typeof DhakaAreaSchema>): ShippingZone | null {
  if (!district.trim()) return null;
  if (isDhakaDistrict(district)) return area ? (area === "city" ? "insideDhaka" : "subDhaka") : null;
  return subDhakaName.test(normalizeDistrict(district)) ? "subDhaka" : "outsideDhaka";
}

export function checkoutDeliveryZone(district: string, address: string): ShippingZone | null {
  if (!address.trim()) return null;
  return deliveryZone(district, suggestDhakaArea(address) ?? "city");
}

const OrderLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(99),
  unitPriceMinor: z.number().int().min(1).max(100_000_000),
  customization: ProductCustomizationSchema.nullable().optional(),
});
export const CouponCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/);
export const StoreCouponSchema = z.object({
  code: CouponCodeSchema,
  percent: z.number().int().min(1).max(100),
  active: z.boolean(),
});
export type StoreCoupon = z.infer<typeof StoreCouponSchema>;
export function couponDiscount(subtotalMinor: number, percent: number): number {
  const roundedTaka = Math.round(subtotalMinor * percent / 10_000);
  const subtotalTaka = Math.floor(subtotalMinor / 100);
  return Math.min(roundedTaka, subtotalTaka) * 100;
}
export const PostalCodeSchema = z.string().trim().regex(/^[0-9০-৯]{4}$/)
  .transform(value => value.replace(/[০-৯]/g, digit => String("০১২৩৪৫৬৭৮৯".indexOf(digit))));

export const PlaceOrderSchema = z.object({
  requestId: z.uuid(),
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30).refine(value => /^\+?[\d(). -]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ""))),
    email: z.string().trim().max(254).email(),
    note: z.string().trim().max(1000).default(""),
  }),
  deliveryAddress: z.object({
    addressLine: z.string().trim().min(1).max(400),
    district: z.string().trim().min(1).max(100),
    postalCode: PostalCodeSchema.optional(),
    dhakaArea: DhakaAreaSchema.optional(),
  }),
  shippingMinor: ShippingFeeSchema,
  coupon: z.object({
    code: CouponCodeSchema,
    discountMinor: z.number().int().nonnegative().max(495_000_000_000),
  }).optional(),
  payment: z.object({
    method: PaymentMethodSchema,
    amountMinor: z.number().int().nonnegative().max(495_001_000_000),
    transactionId: BkashTransactionIdSchema.optional(),
  }).optional(),
  items: z.array(OrderLineSchema).min(1).max(50).refine(
    items => new Set(items.map(item => `${item.productId}:${item.variantId}:${item.customization ? JSON.stringify(item.customization) : ""}`)).size === items.length,
    "Order lines must be unique",
  ),
});
export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;
export type OrderLine = z.infer<typeof OrderLineSchema> & { name: string; variantName: string };
export const orderStatuses = ["AWAITING_PAYMENT", "RECEIVED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export const OrderFulfillmentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("PROCESSING") }),
  z.object({ status: z.literal("SHIPPED"), trackingId: z.string().trim().min(1).max(100) }),
]);
export const AdminOrderSearchSchema = z.object({
  beforeId: z.uuid().optional(), query: z.string().trim().max(254).optional(),
  payment: z.enum(["PENDING_VERIFICATION", "VERIFIED"]).optional(),
  delivery: z.enum(orderStatuses).optional(), qr: z.enum(["AWAITING_QR", "PARTIAL", "ASSIGNED"]).optional(),
});
export type AdminOrderSearch = z.infer<typeof AdminOrderSearchSchema>;
export type OrderTracking = {
  invoiceNumber?: string | null;
  status: typeof orderStatuses[number];
  createdAt: string;
  processingAt?: string | null;
  shippedAt?: string | null;
  activationMethod?: "LEGACY" | "ORDER_SECRET";
  packedAt?: string | null;
  deliveredAt?: string | null;
  courierTrackingId?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  paymentVerifiedAt?: string | null;
  cards?: { total: number; qrGenerated: number; nfcWritten: number; qcPassed: number };
};
export type OrderReceipt = OrderTracking & {
  id: string;
  paymentMethod: z.infer<typeof PaymentMethodSchema>;
  paymentAmountMinor?: number;
  paymentStatus?: "PENDING_VERIFICATION" | "VERIFIED";
  shippingZone: ShippingZone;
  subtotalMinor: number;
  shippingMinor: number;
  couponCode: string | null;
  discountMinor: number;
  totalMinor: number;
  confirmationEmail?: "accepted" | "failed";
  trackingPath?: string;
  reviewInviteSentAt?: string | null;
  qrAllocation?: { required: number; assigned: number; pending: number; status: "AWAITING_QR" | "PARTIAL" | "ASSIGNED" };

};
export type StoreOrder = OrderReceipt & Pick<PlaceOrderInput, "customer" | "deliveryAddress"> & { items: OrderLine[]; transactionId?: string | null;
  codCollectedMinor?: number | null; codSettledMinor?: number | null;
  profileId?: string | null; assignedCards?: { id: string; publicSlug: string; canonicalUrl: string; qcStatus: string;
    lineIndex?: number; unitIndex?: number; printConfirmedAt?: string | null; nfcStatus?: string; inventoryStatus?: string }[] };
