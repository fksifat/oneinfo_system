import { z } from "zod";

const developmentSecret = "development-only-secret-change-before-prod";

const ConfigSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgresql://oneinfo:oneinfo@localhost:55432/oneinfo"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  JWT_SECRET: z.string().min(32).default(developmentSecret),
  PUBLIC_CARD_BASE_URL: z.string().url().default("https://cards.oneinfo.example/c"),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175"),
  DEV_ADMIN_EMAIL: z.string().email().default("admin@oneinfo.local"),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    ORDER_EMAIL_FROM: z.string().trim().min(1).optional(),
    STOREFRONT_URL: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && value.JWT_SECRET === developmentSecret) {
      context.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "A unique production secret is required" });
    }
    if (value.NODE_ENV === "production" && value.PUBLIC_CARD_BASE_URL.includes(".example")) {
      context.addIssue({ code: "custom", path: ["PUBLIC_CARD_BASE_URL"], message: "The real public card domain is required" });
    }
  });

export const config = ConfigSchema.parse(process.env);
