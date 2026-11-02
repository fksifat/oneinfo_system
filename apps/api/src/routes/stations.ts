import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { RegisterStationSchema } from "@oneinfo/contracts";
import { db } from "../db/client.js";
import { auditLogs, productionStations } from "../db/schema.js";
import { createStationCredential, hashCredential, requireOperator } from "../auth.js";
import { parseBody, sendCreated } from "../http.js";

export const stationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(RegisterStationSchema, request.body);
    const stationId = randomUUID();
    const stationCredential = createStationCredential(stationId);

    const [station] = await db.transaction(async (tx) => {
      const created = await tx
        .insert(productionStations)
        .values({
          id: stationId,
          stationCode: input.stationCode,
          name: input.name,
          metadata: input.metadata,
          credentialHash: hashCredential(stationCredential),
        })
        .returning({
          id: productionStations.id,
          stationCode: productionStations.stationCode,
          name: productionStations.name,
          status: productionStations.status,
        });
      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "STATION_REGISTERED",
        targetType: "production_station",
        targetId: stationId,
        requestId: request.id,
      });
      return created;
    });

    return sendCreated(reply, { station, stationCredential });
  });
};
