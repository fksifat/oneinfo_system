import { describe, expect, it } from "vitest";
import { profileHandleBase } from "../src/domain/profile-handles.js";
import { qrUrl, nfcUrlFromQr } from "../src/domain/card-urls.js";
import { config } from "../src/config.js";

describe("public profile handles and source links", () => {
  it("makes compact names while protecting application routes", () => {
    expect(profileHandleBase("Sushmoy Nandi")).toBe("SushmoyNandi");
    expect(profileHandleBase("ADMIN")).toBe("ADMINProfile");
    expect(profileHandleBase("José Doe")).toBe("JoseDoe");
    expect(profileHandleBase("বাংলা")).toBe("Oneinfo");
    expect(profileHandleBase("a".repeat(120))).toHaveLength(48);
  });
  it("separates new QR/NFC links without changing legacy or external links", () => {
    const legacy = `${config.PUBLIC_CARD_BASE_URL}/abc`;
    expect(qrUrl(legacy)).toBe(legacy);
    expect(qrUrl(`${legacy}?source=nfc`)).toBe(`${legacy}?source=qr`);
    expect(nfcUrlFromQr(`${legacy}?source=qr`)).toBe(`${legacy}?source=nfc`);
    const external = "https://example.com/abc?source=nfc";
    expect(qrUrl(external)).toBe(external);
  });
});
