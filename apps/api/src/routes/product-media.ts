import { lockPrintedStock } from "../domain/printed-stock.js";
import { orderProfileClaimable } from "../domain/order-activation.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireOperator } from "../auth.js";
import { put } from "@vercel/blob";
import { requireCustomer, readClaimToken } from "../domain/customer-auth.js";
import { allowAuthAttempt } from "../domain/auth-attempts.js";
import { db } from "../db/client.js";
import { cardActivationSecrets, cards, storeOrders, companyEmployees } from "../db/schema.js";
import { and, eq, gt } from "drizzle-orm";
import { invoiceActivationTarget } from "../domain/order-invoice.js";

const directory = resolve(process.env.PRODUCT_MEDIA_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.product-media"));
const formats = {
  png: { mime: "image/png" },
  jpg: { mime: "image/jpeg" },
  webp: { mime: "image/webp" },
  svg: { mime: "image/svg+xml" },
  mp4: { mime: "video/mp4" },
  webm: { mime: "video/webm" },
  glb: { mime: "model/gltf-binary" },
};

const driveId = z.string().regex(/^[\w-]{1,128}$/);
const driveQuery = z.object({ resourcekey: driveId.optional(), format: z.literal("glb").optional() });
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const modelTypes = new Set(["model/gltf-binary", "application/octet-stream"]);
const maxMediaBytes = 10 * 1024 * 1024;
const maxDriveRequests = 8;

export const productMediaRoutes: FastifyPluginAsync = async app => {
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: maxMediaBytes }, (_request, body, done) => done(null, body));
  let activeDriveRequests = 0;
  app.get<{ Params: { fileId: string } }>("/drive/:fileId", async (request, reply) => {
    const id = driveId.safeParse(request.params.fileId);
    const query = driveQuery.safeParse(request.query);
    if (!id.success || !query.success) return reply.code(400).send();
    if (activeDriveRequests >= maxDriveRequests) return reply.code(503).header("Retry-After", "5").send();

    const isModel = query.data.format === "glb";
    const allowedTypes = isModel ? modelTypes : imageTypes;
    const source = new URL("https://drive.usercontent.google.com/download");
    source.searchParams.set("id", id.data);
    source.searchParams.set("export", "download");
    if (query.data.resourcekey) source.searchParams.set("resourcekey", query.data.resourcekey);

    activeDriveRequests++;
    try {
      const response = await fetch(source, { redirect:"error", signal:AbortSignal.timeout(25_000) });
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (!response.ok || !response.body || !type || !allowedTypes.has(type)) {
        await response.body?.cancel();
        return reply.code(404).send();
      }
      if (Number(response.headers.get("content-length")) > maxMediaBytes) {
        await response.body.cancel();
        return reply.code(413).send();
      }

      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxMediaBytes) {
          await reader.cancel();
          return reply.code(413).send();
        }
        chunks.push(value);
      }

      const body = Buffer.concat(chunks, size);
      if (isModel && (size < 20 || body.toString("ascii", 0, 4) !== "glTF" ||
        body.readUInt32LE(4) !== 2 || body.readUInt32LE(8) !== size)) {
        return reply.code(415).send();
      }

      return reply.type(isModel ? "model/gltf-binary" : type)
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header("Cache-Control", "public, max-age=300")
        .send(body);
    } catch (error) {
      const failure = error as { name?: string; cause?: { code?: string } };
      request.log.warn({ name:failure.name, code:failure.cause?.code }, "Drive media fetch failed");
      return reply.code(502).send();
    } finally {
      activeDriveRequests--;
    }
  });

  for (const kind of ["upload", "profile", "profile-claim", "profile-employee", "custom-logo"] as const) app.post<{ Params: { extension: string } }>(`/${kind}/:extension`, { bodyLimit: kind === "upload" ? maxMediaBytes : 2 * 1024 * 1024 }, async (request, reply) => {
    if (kind === "upload") await requireOperator(request, ["SUPER_ADMIN"]);
    else if (kind === "custom-logo") {
      if (!await allowAuthAttempt(`custom-logo:${request.ip}`, 60, 60 * 60_000)) return reply.code(429).header("Retry-After", "3600").send({ message: "Photo upload limit reached. Please try again in an hour." });
    } else {
      let subject: string;
      if (kind === "profile-employee") {
        const rawToken = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const digest = createHash("sha256").update(rawToken).digest("hex");
        const [employee] = await db.select({ profileId: companyEmployees.profileId }).from(companyEmployees)
          .where(and(eq(companyEmployees.editTokenHash, digest), gt(companyEmployees.editTokenExpiresAt, new Date()), eq(companyEmployees.active, true))).limit(1);
        if (!employee) return reply.code(401).send({ message: "Employee edit link invalid or expired." });
        subject = `employee:${employee.profileId}`;
      } else if (kind === "profile-claim") {
        const claim = await readClaimToken(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
        if (claim.orderProfileId) {
          await db.transaction(async tx => { await lockPrintedStock(tx); await orderProfileClaimable(tx, claim.cardId, claim.orderProfileId!); });
        } else if (claim.orderId) {
          if (!await invoiceActivationTarget(and(eq(storeOrders.id, claim.orderId), eq(cards.id, claim.cardId)))) {
            return reply.code(401).send({ message: "Activation expired. Request a new email link." });
          }
        } else {
          const [secret] = await db.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, claim.cardId)).limit(1);
          if (!secret?.codeHash || secret.redeemedAt || secret.version !== claim.version) return reply.code(401).send({ message: "Activation expired. Scan your card and enter its secret code again." });
        }
        subject = `claim:${claim.cardId}`;
      } else subject = `customer:${(await requireCustomer(request)).id}`;
      if (!await allowAuthAttempt(`profile-photo:${subject}`, 30, 60 * 60_000)) return reply.code(429).header("Retry-After", "3600").send({ message: "Photo upload limit reached. Please try again in an hour." });
    }
    const extension = request.params.extension.toLowerCase();
    if (kind === "custom-logo" && !["png", "jpg", "webp", "svg"].includes(extension)) return reply.code(415).send({ message: "Choose a PNG, JPEG, WebP or SVG logo" });
    if (kind !== "upload" && kind !== "custom-logo" && !["png", "jpg", "webp"].includes(extension)) return reply.code(415).send({ message: "Choose a JPEG, PNG or WebP photo" });
    if (!Object.hasOwn(formats, extension)) return reply.code(415).send({ message: "Unsupported media format" });
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return reply.code(400).send({ message: "Choose a media file to upload" });
    const body = request.body;
    const isValid = extension === "png" ? body.toString("hex", 0, 8) === "89504e470d0a1a0a"
      : extension === "jpg" ? body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
      : extension === "webp" ? body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP"
      : extension === "svg" ? (() => { const text = body.toString("utf8"); return /<svg\b/i.test(text) && !/<script\b|<foreignObject\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:javascript:|https?:|\/\/)/i.test(text); })()
      : extension === "mp4" ? body.length >= 12 && body.toString("ascii", 4, 8) === "ftyp"
      : extension === "webm" ? body.toString("hex", 0, 4) === "1a45dfa3"
      : body.length >= 20 && body.toString("ascii", 0, 4) === "glTF" && body.readUInt32LE(4) === 2 && body.readUInt32LE(8) === body.length;
    if (!isValid) return reply.code(415).send({ message: "The file content does not match its format" });

    const filename = `${randomUUID()}.${extension}`;
    if (process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return reply.code(503).send({ message: "Cloud media storage is not configured." });
      if (process.env.VERCEL && body.length > 4 * 1024 * 1024) return reply.code(413).send({ message: "Cloud uploads support files up to 4 MB. Use a hosted URL for larger files." });
      const blob = await put(`product-media/${filename}`, body, { access: "public", contentType: formats[extension as keyof typeof formats].mime, addRandomSuffix: false });
      return reply.code(201).send({ url: blob.url });
    }
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, filename), body, { flag: "wx" });
    return reply.code(201).send({ url: `/api/v1/product-media/${filename}` });
  });

  app.get<{ Params: { filename: string } }>("/:filename", async (request, reply) => {
    const { filename } = request.params;
    const match = /^[a-f0-9-]{36}\.(png|jpg|webp|svg|mp4|webm|glb)$/.exec(filename);
    if (!match) return reply.code(404).send();
    const format = formats[match[1] as keyof typeof formats];
    try {
      const body = await readFile(resolve(directory, filename));
      return reply.type(format.mime)
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send();
      throw error;
    }
  });
};
