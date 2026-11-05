import { afterAll, expect, it, vi } from "vitest";
import { closeDatabase, pool } from "../src/db/client.js";

afterAll(async () => { vi.restoreAllMocks(); await closeDatabase(); });

it("keeps the API alive after an idle database connection drops without logging client credentials", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT", client: { password: "private-database-password" } });
  expect(() => pool.emit("error", error)).not.toThrow();
  expect(warning).toHaveBeenCalled();
  expect(JSON.stringify(warning.mock.calls)).not.toContain("private-database-password");
});

it("still returns active query failures to the caller without replaying writes", async () => {
  const error = Object.assign(new Error("Connection lost"), { code: "ECONNRESET" });
  const query = vi.spyOn(pool, "query").mockRejectedValueOnce(error as never);
  await expect(pool.query("select 1")).rejects.toBe(error);
  expect(query).toHaveBeenCalledTimes(1);
  query.mockRestore();
});
