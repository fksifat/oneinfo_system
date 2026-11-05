export type ClaimableJobStatus = "QUEUED" | "CLAIMED" | "RETRYABLE_FAILURE" | "COMPLETED" | "CANCELLED";

export function canClaimJob(status: ClaimableJobStatus, assignedStationId: string | null, stationId: string): boolean {
  if (status === "QUEUED") return assignedStationId === null || assignedStationId === stationId;
  if (status === "RETRYABLE_FAILURE") return assignedStationId === stationId;
  return false;
}

export function canPassQualityControl(qrStatus: string, nfcStatus: string): boolean {
  return qrStatus === "GENERATED" && nfcStatus === "WRITTEN";
}

export function nextNfcJobStatus(result: "SUCCEEDED" | "FAILED"): "COMPLETED" | "RETRYABLE_FAILURE" {
  return result === "SUCCEEDED" ? "COMPLETED" : "RETRYABLE_FAILURE";
}

export function productionBatchSummary(cards: { qrStatus: string; nfcStatus: string; qcStatus: string }[]) {
  const total = cards.length;
  const qrGenerated = cards.filter((card) => card.qrStatus === "GENERATED").length;
  const nfcWritten = cards.filter((card) => card.nfcStatus === "WRITTEN").length;
  const qcPassed = cards.filter((card) => card.qcStatus === "PASSED").length;
  const status = total > 0 && qcPassed === total ? "COMPLETED" : cards.some((card) => card.qrStatus !== "PENDING" || card.nfcStatus !== "PENDING" || card.qcStatus !== "PENDING") ? "IN_PRODUCTION" : "READY";
  return { total, qrGenerated, nfcWritten, qcPassed, status };
}

export function verificationSummary(checks: { method: string; matched: boolean; createdAt: Date; deviceMetadata?: Record<string, unknown> }[], writtenAt?: Date) {
  const latest = checks.filter((check) => !writtenAt || check.createdAt > writtenAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const camera = latest.find((check) => check.method === "QR_CAMERA");
  const nfc = latest.find((check) => check.method === "NFC_READ" && (!camera || check.createdAt >= camera.createdAt) &&
    (!camera?.deviceMetadata?.scanId || check.deviceMetadata?.scanId === camera.deviceMetadata.scanId));
  return {
    camera: camera?.matched ?? false,
    nfc: nfc?.matched ?? false,
    cameraResult: camera ? (camera.matched ? "MATCHED" : "MISMATCH") : "PENDING",
    nfcResult: nfc ? (nfc.matched ? "MATCHED" : "MISMATCH") : "PENDING",
  };
}
