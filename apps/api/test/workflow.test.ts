import { describe, expect, it } from "vitest";
import { canClaimJob, canPassQualityControl, nextNfcJobStatus } from "../src/domain/workflow.js";

describe("production workflow invariants", () => {
  it("allows an unassigned queued job to be claimed", () => {
    expect(canClaimJob("QUEUED", null, "station-a")).toBe(true);
  });

  it("does not allow another station to take an assigned retry", () => {
    expect(canClaimJob("RETRYABLE_FAILURE", "station-a", "station-b")).toBe(false);
  });

  it("requires both QR and NFC completion before QC passes", () => {
    expect(canPassQualityControl("GENERATED", "WRITTEN")).toBe(true);
    expect(canPassQualityControl("PENDING", "WRITTEN")).toBe(false);
    expect(canPassQualityControl("GENERATED", "PENDING")).toBe(false);
  });

  it("keeps failed NFC work retryable", () => {
    expect(nextNfcJobStatus("FAILED")).toBe("RETRYABLE_FAILURE");
    expect(nextNfcJobStatus("SUCCEEDED")).toBe("COMPLETED");
  });
});
