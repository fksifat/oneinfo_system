import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";
import { batchRoutes } from "./routes/batches.js";
import { cardRoutes } from "./routes/cards.js";
import { devRoutes } from "./routes/dev.js";
import { jobRoutes } from "./routes/jobs.js";
import { stationRoutes } from "./routes/stations.js";
import { profileRoutes } from "./routes/profiles.js";
import { adminRoutes } from "./routes/admin.js";
import { localNfcRoutes } from "./routes/local-nfc.js";

import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";
import { productMediaRoutes } from "./routes/product-media.js";
import { reviewRoutes } from "./routes/reviews.js";

export function buildApp() {
  const app = Fastify({ logger: true, requestIdHeader: "x-request-id" });

  app.register(cors, {
    origin: config.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-station-key", "x-request-id", "x-oneinfo-device-token"],
  });
  app.get("/health", async () => ({ status: "ok", service: "oneinfo-production-api" }));
  app.register(devRoutes, { prefix: "/api/v1/dev" });
  app.register(stationRoutes, { prefix: "/api/v1/production/stations" });
  app.register(batchRoutes, { prefix: "/api/v1/production/batches" });
  app.register(jobRoutes, { prefix: "/api/v1/production/jobs" });
  app.register(cardRoutes, { prefix: "/api/v1/production/cards" });
  app.register(profileRoutes, { prefix: "/api/v1/profiles" });
  app.register(orderRoutes, { prefix: "/api/v1/orders" });
  app.register(productRoutes, { prefix: "/api/v1/products" });
  app.register(productMediaRoutes, { prefix: "/api/v1/product-media" });
  app.register(reviewRoutes, { prefix: "/api/v1/reviews" });
  app.register(adminRoutes, { prefix: "/api/v1/admin" });
  app.register(localNfcRoutes, { prefix: "/api/v1/local-nfc" });

  app.setErrorHandler((error, request, reply) => {
    const normalized = error as Error & { statusCode?: number; details?: unknown; code?: string; cause?: { code?: string } };
    const dbCode = normalized.cause?.code ?? normalized.code;
    const statusCode = normalized.statusCode ?? (dbCode === "23505" ? 409 : dbCode === "22P02" ? 400 : 500);
    const details = normalized.details;
    request.log.error({ error, statusCode }, "request failed");
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "InternalServerError" : normalized.name,
      message: dbCode === "23505" ? "This identifier already exists" : dbCode === "22P02" ? "Invalid identifier" : statusCode >= 500 ? "An unexpected error occurred" : normalized.message,
      requestId: request.id,
      ...(details ? { details } : {}),
    });
  });

  return app;
}
