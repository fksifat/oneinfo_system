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
