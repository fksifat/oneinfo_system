import { afterEach, describe, expect, it, vi } from "vitest";
import { contactVcard } from "@oneinfo/contracts";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("browser client regressions", () => {
  it("ends an expired cloud admin session without requesting development credentials", async () => {
    vi.stubEnv("VITE_OPERATOR_LOGIN", "password");
    vi.stubGlobal("localStorage", { getItem: () => "expired" });
    const dispatchEvent = vi.fn(); vi.stubGlobal("window", { dispatchEvent });
    const fetcher = vi.fn(async () => Response.json({ message: "Invalid or expired operator token" }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("../../control-center/src/api.js");
    await expect(api("/api/v1/admin/overview", "expired")).rejects.toThrow("Invalid or expired operator token");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe("oneinfo-session-expired");
  });
  it("notifies the console when admin has revoked its station without exposing the station secret", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const dispatchEvent = vi.fn(); vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Invalid or revoked station credential" }, { status: 401 })));
    const { api } = await import("../../production-console/src/api.js");
    await expect(api("/api/v1/production/jobs", {}, { stationKey: "station-id.secret", accessToken: "valid" })).rejects.toMatchObject({ status: 401 });
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe("oneinfo-station-revoked");
    expect(dispatchEvent.mock.calls[0]?.[0].detail).toBe("station-id");
  });
  it("exposes missing-batch status so the console can clear a deleted selection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Batch not found" }, { status: 404 })));
    const { api } = await import("../../production-console/src/api.js");
    await expect(api("/api/v1/production/batches/missing")).rejects.toMatchObject({ status: 404, message: "Batch not found" });
  });
  it("renews expired station tokens once and reuses the stored token on future NFC requests", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const credentials = { accessToken: "expired", stationKey: "station-key" };
    values.set("oneinfo.credentials", JSON.stringify(credentials));
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/dev/token")) return Response.json({ accessToken: "renewed" });
      if ((init.headers as Headers).get("authorization") === "Bearer expired") {
        return Response.json({ message: "Invalid or expired operator token" }, { status: 401 });
      }
      return Response.json({ state: "PENDING" });
    });
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("../../production-console/src/api.js");
    await Promise.all([api("/session/a", {}, credentials), api("/session/b", {}, credentials)]);
    await api("/session/c", {}, credentials);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/dev/token"))).toHaveLength(1);
    expect((fetcher.mock.calls.at(-1)?.[1].headers as Headers).get("authorization")).toBe("Bearer renewed");
  });

  it("exports a real contact file and escapes newlines so fields cannot inject extra vCard properties", () => {
    const card = contactVcard({ displayName: "Farhan, Sifat", company: "One;info", headline: "Engineer\nNOTE:injected",
      phone: "+880123456789", email: "test@example.com", website: "https://example.com" });
    expect(card).toContain("BEGIN:VCARD\r\nVERSION:3.0");
    expect(card).toContain("FN:Farhan\\, Sifat");
    expect(card).toContain("ORG:One\\;info");
    expect(card).not.toContain("\r\nNOTE:");
    expect(card).toContain("END:VCARD\r\n");
  });
});
