import { describe, expect, it } from "vitest";
import { checkoutDeliveryZone, defaultShippingRates, deliveryZone, suggestDhakaArea } from "../../../packages/contracts/src/index.js";

describe("checkout delivery zones", () => {
  it("prices city, suburbs, and other districts separately", () => {
    expect(defaultShippingRates).toEqual({ insideDhaka: 6000, subDhaka: 10000, outsideDhaka: 12000 });
    expect(deliveryZone("ঢাকা জেলা", suggestDhakaArea("Road 7, Dhanmondi"))).toBe("insideDhaka");
    expect(deliveryZone("Dhaka", suggestDhakaArea("বাড়ি ১২, সাভার"))).toBe("subDhaka");
    expect(deliveryZone("Gazipur District")).toBe("subDhaka");
    expect(deliveryZone("Sylhet", "city")).toBe("outsideDhaka");
  });

  it("asks the customer to disambiguate Dhaka if the address is unclear", () => {
    expect(deliveryZone("Dhaka", suggestDhakaArea("House 12, Road 7"))).toBeNull();
    expect(suggestDhakaArea("Savarland Road")).toBeUndefined();
  });

  it("quotes shipping from the full address without a separate area field", () => {
    expect(checkoutDeliveryZone("Dhaka", "House 12, Savar")).toBe("subDhaka");
    expect(checkoutDeliveryZone("ঢাকা", "House 12, Road 7")).toBe("insideDhaka");
    expect(checkoutDeliveryZone("Dhaka", "")).toBeNull();
  });
});
