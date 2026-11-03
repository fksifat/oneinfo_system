import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyPluginAsync } from "fastify";

const directory = resolve(process.env.PRODUCT_MEDIA_DIR || ".product-media");
const formats = {
  png: { mime: "image/png" },
  jpg: { mime: "image/jpeg" },
  webp: { mime: "image/webp" },
  svg: { mime: "image/svg+xml" },
  mp4: { mime: "video/mp4" },
  webm: { mime: "video/webm" },
};

export const productMediaRoutes: FastifyPluginAsync = async app => {
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
