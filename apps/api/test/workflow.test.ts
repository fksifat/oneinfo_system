import { describe, expect, it } from "vitest";
import { canClaimJob, canPassQualityControl, nextNfcJobStatus, verificationSummary, productionBatchSummary } from "../src/domain/workflow.js";

describe("production workflow invariants", () => {
  it("reports the same batch progress for admin and production without completing failed QC", () => {
    const pending = { qrStatus: "PENDING", nfcStatus: "PENDING", qcStatus: "PENDING" };
    expect(productionBatchSummary([]).status).toBe("READY");
    expect(productionBatchSummary([pending]).status).toBe("READY");
    expect(productionBatchSummary([{ ...pending, qrStatus: "GENERATED" }, pending])).toEqual({ total: 2, qrGenerated: 1, nfcWritten: 0, qcPassed: 0, status: "IN_PRODUCTION" });
    expect(productionBatchSummary([{ qrStatus: "GENERATED", nfcStatus: "WRITTEN", qcStatus: "FAILED" }]).status).toBe("IN_PRODUCTION");
    expect(productionBatchSummary([{ qrStatus: "GENERATED", nfcStatus: "WRITTEN", qcStatus: "PASSED" }]).status).toBe("COMPLETED");
  });
  it("requires the latest camera and NFC scans to match, including after a failed rescan", () => {
    const checks = [
      { method: "QR_CAMERA", matched: true, createdAt: new Date(1) },
      { method: "NFC_READ", matched: true, createdAt: new Date(2) },
      { method: "NFC_READ", matched: false, createdAt: new Date(3) },
    ];
    expect(verificationSummary(checks)).toEqual({ camera: true, nfc: false, cameraResult: "MATCHED", nfcResult: "MISMATCH" });
    expect(verificationSummary([])).toEqual({ camera: false, nfc: false, cameraResult: "PENDING", nfcResult: "PENDING" });
  });
  it("allows an unassigned queued job to be claimed", () => {
    expect(canClaimJob("QUEUED", null, "station-a")).toBe(true);
  });

  it("requires a fresh QR/NFC pair after writing and never reuses an earlier NFC scan", () => {
    const pair = (method: string, time: number, scanId: string) => ({ method, matched: true, createdAt: new Date(time), deviceMetadata: { scanId } });
    const checks = [pair("QR_CAMERA", 1, "first"), pair("NFC_READ", 2, "first")];
    expect(verificationSummary(checks, new Date(3)).camera).toBe(false);
    checks.push(pair("QR_CAMERA", 4, "second"));
    expect(verificationSummary(checks).nfcResult).toBe("PENDING");
    checks.push(pair("NFC_READ", 5, "first"));
    expect(verificationSummary(checks).nfc).toBe(false);
    checks.push(pair("NFC_READ", 6, "second"));
    expect(verificationSummary(checks, new Date(3)).nfc).toBe(true);
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
