import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://oneinfo:oneinfo@localhost:55432/oneinfo",
  },
  strict: true,
  verbose: true,
});
