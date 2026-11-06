import { afterEach, expect, it } from "vitest";
import { config } from "../src/config.js";
import { isManagedCardUrl, managedCardBases } from "../src/domain/card-urls.js";

const previous = config.PUBLIC_CARD_BASE_URL_ALIASES;
afterEach(() => { config.PUBLIC_CARD_BASE_URL_ALIASES = previous; });
it("accepts only configured legacy card domains and exact saved card paths", () => {
  config.PUBLIC_CARD_BASE_URL_ALIASES = ["https://legacy.example/c/", config.PUBLIC_CARD_BASE_URL];
  expect(managedCardBases()).toHaveLength(2);
  expect(isManagedCardUrl("https://legacy.example/c/test-card", "test-card")).toBe(true);
  for (const url of ["https://other.example/c/test-card", "https://legacy.example/c/other-card", "https://legacy.example/c/test-card?redirect=1", "https://legacy.example/c/test-card#fragment"]) {
    expect(isManagedCardUrl(url, "test-card")).toBe(false);
  }
});
