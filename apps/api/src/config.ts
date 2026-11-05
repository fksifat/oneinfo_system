import { z } from "zod";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const developmentSecret = "development-only-secret-change-before-prod";

const ConfigSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgresql://oneinfo:oneinfo@localhost:55432/oneinfo"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  NFC_LAN_PORT: z.coerce.number().int().min(1).max(65_535).default(3443),
  JWT_SECRET: z.string().min(32).default(developmentSecret),
  PUBLIC_CARD_BASE_URL: z.string().url().refine(value => {
    const url = new URL(value);
    return url.pathname.replace(/\/$/, "") === "/c" && !url.search && !url.hash;
  }, "Use the customer site's /c base URL without query parameters or fragments").default("http://127.0.0.1:5174/c"),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175"),
  DEV_ADMIN_EMAIL: z.string().email().default("admin@oneinfo.local"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD_HASH: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/).optional(),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    ORDER_EMAIL_FROM: z.string().trim().min(1).optional(),
    STOREFRONT_URL: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && value.JWT_SECRET === developmentSecret) {
      context.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "A unique production secret is required" });
    }
    const cardUrl = new URL(value.PUBLIC_CARD_BASE_URL);
    if (value.NODE_ENV === "production" && (cardUrl.protocol !== "https:" || cardUrl.hostname.endsWith(".example") || ["localhost", "127.0.0.1", "[::1]"].includes(cardUrl.hostname))) {
      context.addIssue({ code: "custom", path: ["PUBLIC_CARD_BASE_URL"], message: "The real public card domain is required" });
    }
  });

export const config = ConfigSchema.parse(process.env);
