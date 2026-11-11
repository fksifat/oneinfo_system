import type { FastifyPluginAsync } from "fastify";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { requireOperator, requireStation } from "../auth.js";
import { config } from "../config.js";
import { parseBody } from "../http.js";
import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";
import { backupDirectory, backupPath, createDatabaseBackup, listDatabaseBackups, readDatabaseBackup } from "../domain/database-backup.js";

export const databaseBackupRoutes: FastifyPluginAsync = async app => {
  let running = false;
  app.addHook("preHandler", async request => {
    // Use the socket, not forwarded headers: phone/LAN callers cannot export the database.
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.raw.socket.remoteAddress ?? "")) throw Object.assign(new Error("Database backups are available only on this PC"), { statusCode: 403 });
    await requireOperator(request, ["SUPER_ADMIN"]);
    await requireStation(request);
  });
  app.get("/", async () => ({ directory: backupDirectory(), items: await listDatabaseBackups() }));
  app.post("/", async (request, reply) => {
    if (running) return reply.code(409).send({ message: "A database backup is already running. Wait for it to finish." });
    running = true;
    try {
      const actor = await requireOperator(request, ["SUPER_ADMIN"]);
      const backup = await createDatabaseBackup(config.DATABASE_URL);
      await db.insert(auditLogs).values({ actorId: actor.operatorId, action: "DATABASE_BACKUP_CREATED", targetType: "database_backup", targetId: backup.id,
        requestId: request.id, metadata: { fileName: backup.fileName, bytes: backup.bytes, sha256: backup.sha256 } });
      return reply.code(201).send(backup);
    } catch {
      request.log.error("Database backup failed; check backup tools, connection and available disk space");
      return reply.code(503).send({ message: "Backup could not be completed. Check free disk space, the database connection and PostgreSQL/SSH backup tools. Existing backups are retained." });
    } finally { running = false; }
  });
  app.get("/:id/download", async (request, reply) => {
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    try {
      const backup = await readDatabaseBackup(id, true);
      return reply.type("application/octet-stream").header("Content-Disposition", `attachment; filename="${backup.fileName}"`)
        .header("Content-Length", backup.bytes).send(createReadStream(backupPath(id)));
    } catch {
      return reply.code(409).send({ message: "Backup is missing or failed its integrity check. Create a new backup; the database has not been changed." });
    }
  });
};
