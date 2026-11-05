import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serialize, deserialize } from "node:v8";
import type { NfcUtilityInput, NfcBridgeResultInput, NfcReadResultInput } from "@oneinfo/contracts";

export interface Pairing {
  code: string;
  secretHash: string;
  stationId: string;
  operatorId: string;
  expiresAt: Date;
}

export interface NfcDevice {
  id: string;
  stationId: string;
  operatorId: string;
  tokenHash: string;
  name: string;
  runtimeVersion: string;
  pairedAt: Date;
  lastSeenAt: Date;
}

export interface BridgeSession {
  id: string;
  jobId: string;
  cardId: string;
  stationId: string;
  expectedUrl: string;
  state: "PENDING" | "WRITING" | "SUCCEEDED" | "FAILED";
  deviceId?: string;
  phoneInitiated?: boolean;
  result?: NfcBridgeResultInput;
  createdAt: Date;
  expiresAt: Date;
}

export interface ReadSession {
  id: string;
  stationId: string;
  state: "PENDING" | "READING" | "COMPLETED" | "FAILED" | "CANCELLED";
  utility?: NfcUtilityInput;
  deviceId?: string;
  result?: NfcReadResultInput;
  createdAt: Date;
  expiresAt: Date;
}

export interface VerificationSession {
  id: string;
  cardId: string;
  stationId: string;
  method: "QR_CAMERA" | "NFC_READ";
  expectedUrl: string;
  state: "PENDING" | "SCANNING" | "MATCHED" | "MISMATCH";
  deviceId?: string;
  result?: { scannedValue: string; uid?: string | undefined; errorCode?: string | undefined; deviceMetadata: Record<string, unknown> };
  expiresAt: Date;
}

export function openNfcState(filename: string | null) {
  let state = {
    pairings: new Map<string, Pairing>(), devices: new Map<string, NfcDevice>(),
    sessions: new Map<string, BridgeSession>(), readSessions: new Map<string, ReadSession>(),
    verificationSessions: new Map<string, VerificationSession>(),
    qrScans: new Map<string, { id: string; cardId: string; deviceId: string; expectedUrl: string; expiresAt: Date }>(),
  };
  let previous: Buffer | undefined;
  if (filename && existsSync(filename)) {
    previous = readFileSync(filename);
    const saved = deserialize(previous) as { version: number; state: typeof state };
    if (saved.version !== 1 || Object.keys(state).some(key => !(saved.state?.[key as keyof typeof state] instanceof Map))) throw new Error("NFC state cannot be loaded. Restore the workstation state backup.");
    state = saved.state;
  }
  return { state, save() {
    if (!filename) return;
    const bytes = serialize({ version: 1, state });
    if (previous?.equals(bytes)) return;
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename + ".tmp", bytes, { mode: 0o600, flush: true });
    renameSync(filename + ".tmp", filename);
    previous = bytes;
  } };
}
