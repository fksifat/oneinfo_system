import type { FastifyPluginAsync } from "fastify";
import { ensureDevelopmentAdmin, issueOperatorToken } from "../auth.js";

export const devRoutes: FastifyPluginAsync = async (app) => {
  app.post("/token", async () => {
    const identity = await ensureDevelopmentAdmin();
    return {
      accessToken: await issueOperatorToken(identity),
      operator: identity,
      expiresInSeconds: 1_800,
    };
  });
};
