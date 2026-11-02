import { api, type Credentials } from "./api.js";

export interface NfcWriteResult {
  result: "SUCCEEDED" | "FAILED";
  expectedUrl: string;
  readbackUrl?: string;
  errorCode?: string;
  deviceMetadata: Record<string, unknown>;
}

interface BridgeSession {
  id: string;
  state: "PENDING" | "WRITING" | "SUCCEEDED" | "FAILED";
  result?: {
    result: "SUCCEEDED" | "FAILED";
    expectedUrl: string;
    readbackUrl?: string;
    errorCode?: string;
    deviceMetadata: Record<string, unknown>;
  };
}

export interface NfcWriteRequest {
  jobId: string;
  url: string;
  credentials: Credentials;
}

export interface NfcAdapter {
  readonly name: string;
  writeAndReadBack(request: NfcWriteRequest): Promise<NfcWriteResult>;
}

class DesktopNfcAdapter implements NfcAdapter {
  readonly name = "Paired local NFC device";

  async writeAndReadBack({ jobId, url, credentials }: NfcWriteRequest): Promise<NfcWriteResult> {
    const created = await api<BridgeSession>(
      "/api/v1/local-nfc/sessions",
      { method: "POST", body: JSON.stringify({ jobId, expectedUrl: url }) },
      credentials,
    );

    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const session = await api<BridgeSession>(`/api/v1/local-nfc/sessions/${created.id}`, {}, credentials);
      if (session.state === "FAILED" && session.result) {
        return {
          result: "FAILED",
          expectedUrl: session.result.expectedUrl,
          ...(session.result.readbackUrl ? { readbackUrl: session.result.readbackUrl } : {}),
          errorCode: session.result.errorCode ?? "WRITE_FAILED",
          deviceMetadata: session.result.deviceMetadata,
        };
      }
      if (session.state === "SUCCEEDED" && session.result?.readbackUrl) {
        return {
          result: "SUCCEEDED",
          expectedUrl: session.result.expectedUrl,
          readbackUrl: session.result.readbackUrl,
          deviceMetadata: session.result.deviceMetadata,
        };
      }
    }
    throw new Error("Paired NFC device did not complete the write before the session expired");
  }
}

export const nfcAdapter: NfcAdapter = new DesktopNfcAdapter();
