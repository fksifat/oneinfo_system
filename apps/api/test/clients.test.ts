import { afterEach, describe, expect, it, vi } from "vitest";
import { contactVcard } from "../../control-center/src/contact.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("browser client regressions", () => {
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
