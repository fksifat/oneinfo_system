import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw Object.assign(new Error("Request validation failed"), {
      statusCode: 400,
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

export function sendCreated(reply: FastifyReply, value: unknown): FastifyReply {
  return reply.code(201).send(value);
}
