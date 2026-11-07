import { z } from "zod";
import { parseBody } from "../http.js";
export const adminPage = (query: unknown) => parseBody(z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), query: z.string().trim().max(120).default("") }), query);
