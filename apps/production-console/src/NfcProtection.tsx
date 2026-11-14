import { useEffect, useState, type FormEvent } from "react";
import { NfcProtectionSchema } from "@oneinfo/contracts";
import { api, type Credentials } from "./api.js";

interface Session { id: string; state: string; result?: { errorCode?: string }; protection?: { cardId: string; operation: string } }
interface Props {
  card: { id: string; publicSlug: string; nfcStatus: string; writeProtection?: string | null };
  credentials: Credentials;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function NfcProtection({ card, credentials, onMessage, onChanged }: Props) {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const pending = Boolean(session && ["PENDING", "READING"].includes(session.state));
  useEffect(() => { setPassword(""); setSaved(false); setError(""); }, [card.id]);

  useEffect(() => {
    if (!pending || !session) return;
    let disposed = false, loading = false;
    const sync = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await api<Session>(`/api/v1/local-nfc/read-sessions/${session.id}`, {}, credentials);
        if (disposed) return;
        setSession(result);
        if (result.state === "COMPLETED") {
          onMessage(`NFC password protection ${result.protection?.operation === "PROTECT" ? "enabled" : "removed"}. Public read verified by the phone.`);
          await onChanged();
        } else if (result.state === "FAILED") setError(result.result?.errorCode ?? "Operation expired. Read the tag and retry with the same password if protection was interrupted.");
      } catch (error) { if (!disposed) setError(error instanceof Error ? error.message : "Could not check protection status"); }
      finally { loading = false; }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [session?.id, pending, credentials, onMessage, onChanged]);

  const start = async (operation: "PROTECT" | "UNPROTECT") => {
    setError("");
    const input = NfcProtectionSchema.safeParse({ cardId: card.id, operation, keyHex: password, confirmed: saved });
    if (!input.success) { setError("Enter a private 12-character hexadecimal password (0–9, A–F) and confirm you have saved it."); return; }
    setSubmitting(true);
    try {
      const result = await api<Session>("/api/v1/local-nfc/protection-sessions", { method: "POST", body: JSON.stringify(input.data) }, credentials);
      setSession(result); setPassword(""); setSaved(false);
      onMessage(`Protection request for ${card.publicSlug} queued. Hold this card against the phone using the updated Oneinfo APK.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start protection"); }
    finally { setSubmitting(false); }
  };

  const cancel = async () => {
    if (!session || session.state !== "PENDING") return;
    try {
      await api(`/api/v1/local-nfc/utility-sessions/${session.id}/cancel`, { method: "POST" }, credentials);
      setSession(current => current ? { ...current, state: "CANCELLED" } : null);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not cancel"); }
  };

  return <section className="nfc-protection" aria-label="NFC rewrite protection">
    <p className="section-label">NFC REWRITE PROTECTION</p>
    <h3>Password protection: {card.writeProtection === "PROTECTED" ? "Enabled · last verified by phone" : card.writeProtection === "UNPROTECTED" ? "Removed · last verified by phone" : "Not verified"}</h3>
    <p>For standard NDEF MIFARE Classic 1K cards. Normal reading stays available. Remove protection with the same password before rewriting, then protect again.</p>
    {card.nfcStatus !== "WRITTEN" ? <p>Complete Load to NFC and its readback first.</p> : null}
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void start("PROTECT"); }}>
      <fieldset disabled={submitting || pending || card.nfcStatus !== "WRITTEN"}>
        <label>Rewrite password · 12 hexadecimal characters<input type="password" autoComplete="off" spellCheck={false} minLength={12} maxLength={12} pattern="[0-9A-Fa-f]{12}" value={password} onChange={event => { setPassword(event.target.value); setSaved(false); }} /></label>
        <button type="button" className="secondary" onClick={() => { setPassword(Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase()); setSaved(false); }}>Generate password</button>
        <button type="button" className="secondary" disabled={!password} onClick={() => void navigator.clipboard.writeText(password).then(() => onMessage("Rewrite password copied. Save it in your password manager.")).catch(() => setError("Clipboard unavailable. Enter and save your own 12-character hexadecimal password."))}>Copy password</button>
        <label className="checkbox-label"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />I have saved this password. If interrupted, I will retry with the same password.</label>
        <div className="actions"><button type="submit" disabled={!saved}>Protect NFC tag</button><button type="button" className="secondary" disabled={!saved} onClick={() => void start("UNPROTECT")}>Remove protection</button></div>
      </fieldset>
    </form>
    {pending ? <p role="status">{session?.state === "PENDING" ? "Waiting for the phone. Updated APK required." : "Phone has received the request. Keep the card still until completion."}{session?.state === "PENDING" ? <button className="text-button" onClick={() => void cancel()}>Cancel waiting request</button> : null}</p> : null}
    {error ? <p className="tool-error" role="alert">{error}</p> : null}
    <small>This protects normal rewriting; it does not prevent copying the public link or guarantee resistance to MIFARE Classic key-recovery attacks. The password is not saved in browser storage or cloud records.</small>
  </section>;
}
