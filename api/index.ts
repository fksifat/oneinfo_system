import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../apps/api/src/app.js";

const app = buildApp();
const ready = app.ready();

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await ready;
  app.server.emit("request", request, response);
}
