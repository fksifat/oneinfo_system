import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const directory = resolve(process.env.PRODUCT_MEDIA_DIR || ".product-media");
const formats = {
  png: { mime: "image/png" },
  jpg: { mime: "image/jpeg" },
  webp: { mime: "image/webp" },
  svg: { mime: "image/svg+xml" },
  mp4: { mime: "video/mp4" },
  webm: { mime: "video/webm" },
};

const driveId = z.string().regex(/^[\w-]{1,128}$/);
const driveQuery = z.object({ resourcekey: driveId.optional() });
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const maxImageBytes = 10 * 1024 * 1024;
const maxDriveRequests = 8;

export const productMediaRoutes: FastifyPluginAsync = async app => {
  let activeDriveRequests = 0;
  app.get<{ Params: { fileId: string } }>("/drive/:fileId", async (request, reply) => {
    const id = driveId.safeParse(request.params.fileId);
    const query = driveQuery.safeParse(request.query);
    if (!id.success || !query.success) return reply.code(400).send();
    if (activeDriveRequests >= maxDriveRequests) return reply.code(503).header("Retry-After", "5").send();

    const source = new URL("https://drive.usercontent.google.com/download");
    source.searchParams.set("id", id.data);
    source.searchParams.set("export", "download");
    if (query.data.resourcekey) source.searchParams.set("resourcekey", query.data.resourcekey);

    activeDriveRequests++;
    try {
      const response = await fetch(source, { redirect:"error", signal:AbortSignal.timeout(25_000) });
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (!response.ok || !response.body || !type || !imageTypes.has(type)) {
        await response.body?.cancel();
        return reply.code(404).send();
      }
      if (Number(response.headers.get("content-length")) > maxImageBytes) {
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
        if (size > maxImageBytes) {
          await reader.cancel();
          return reply.code(413).send();
        }
        chunks.push(value);
      }

      return reply.type(type)
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header("Cache-Control", "public, max-age=300")
        .send(Buffer.concat(chunks, size));
    } catch (error) {
      const failure = error as { name?: string; cause?: { code?: string } };
      request.log.warn({ name:failure.name, code:failure.cause?.code }, "Drive image fetch failed");
      return reply.code(502).send();
    } finally {
      activeDriveRequests--;
    }
  });

  app.get<{ Params: { filename: string } }>("/:filename", async (request, reply) => {
    const { filename } = request.params;
    const match = /^[a-f0-9-]{36}\.(png|jpg|webp|svg|mp4|webm)$/.exec(filename);
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
