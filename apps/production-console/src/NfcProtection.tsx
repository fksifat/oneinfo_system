import { useEffect, useState, type FormEvent } from "react";
import { NfcProtectionSchema, SaveNfcProtectionPasswordSchema } from "@oneinfo/contracts";
import { api, type Credentials } from "./api.js";

interface Session { id: string; state: string; result?: { errorCode?: string }; protection?: { cardId: string; operation: string } }
interface SavedPassword { saved: boolean; kind: "CUSTOM" | "KEY" | null; updatedAt: string | null }
interface Props {
  card: { id: string; publicSlug: string; nfcStatus: string; writeProtection?: string | null };
  credentials: Credentials;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}
const protectionErrors: Record<string, string> = {
  PROTECTION_FAILED_CHECK_TAG_AND_RETRY_SAME_PASSWORD: "The phone could not communicate with the tag or its existing key differs. Keep it still and retry with the SAME password. Already-protected cards need their original password.",
  PROTECTION_INTERRUPTED_RETRY_SAME_PASSWORD: "Protection was interrupted and some sectors may already be changed. Keep the tag still and retry with the SAME password; do not generate a different one.",
  WRONG_PASSWORD_OR_ISSUER_KEY: "The password does not match this tag's existing key, or the card uses a custom issuer key. Use its original password/key.",
  ONLY_NDEF_CLASSIC_1K_SUPPORTED: "This tag is not a supported MIFARE Classic 1K card.",
  ONLY_DEDICATED_NDEF_CARDS_SUPPORTED: "This card has a nonstandard or shared sector layout. Protection was stopped before changing it.",
  PROTECTION_NOT_VERIFIED: "The phone did not verify protection. Use the updated Oneinfo app and retry with the same password.",
  WRONG_CARD_LINK: "This tag's link does not match the selected card. Tap the correct card.",
};

export function NfcProtection({ card, credentials, onMessage, onChanged }: Props) {
  const [password, setPassword] = useState("");
  const [format, setFormat] = useState<"CUSTOM" | "KEY">("CUSTOM");
  const [acknowledged, setAcknowledged] = useState(false);
  const [savedPassword, setSavedPassword] = useState<SavedPassword | null>(null);
  const [useSaved, setUseSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const pending = Boolean(session && ["PENDING", "READING"].includes(session.state));
  useEffect(() => { setError(""); }, [card.id]);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void api<SavedPassword>("/api/v1/local-nfc/protection-password", {}, credentials)
      .then(result => { if (!disposed) { setSavedPassword(result); setUseSaved(result.saved); } })
      .catch(error => { if (!disposed) setError(error instanceof Error ? error.message : "Could not load shared password settings"); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [credentials]);

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
        } else if (result.state === "FAILED") {
          const code = result.result?.errorCode;
          setError(code ? protectionErrors[code] ?? code : "Operation expired. Read the tag and retry with the same password if protection was interrupted.");
        }
      } catch (error) { if (!disposed) setError(error instanceof Error ? error.message : "Could not check protection status"); }
      finally { loading = false; }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [session?.id, pending, credentials, onMessage, onChanged]);

  const enteredPassword = () => format === "KEY" ? { keyHex: password } : { password };
  const saveForAll = async () => {
    setError("");
    const input = SaveNfcProtectionPasswordSchema.safeParse({ ...enteredPassword(), confirmed: acknowledged });
    if (!input.success) { setError(input.error.issues[0]?.message ?? "Enter and back up your password first."); return; }
    setSubmitting(true);
    try {
      const result = await api<SavedPassword>("/api/v1/local-nfc/protection-password", { method: "PUT", body: JSON.stringify(input.data) }, credentials);
      setSavedPassword(result); setUseSaved(true); setPassword(""); setAcknowledged(false);
      onMessage("Shared NFC password saved encrypted on this workstation. It will be reused for every card you protect here. Existing tags were not changed.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the shared password"); }
    finally { setSubmitting(false); }
  };
  const start = async (operation: "PROTECT" | "UNPROTECT") => {
    setError("");
    const input = NfcProtectionSchema.safeParse({ cardId: card.id, operation, ...(useSaved ? { useSavedPassword: true } : enteredPassword()), confirmed: useSaved || acknowledged });
    if (!input.success) { setError("Enter a custom password (8–128 characters) or the existing 12-character NFC key, and confirm it is backed up."); return; }
    setSubmitting(true);
    try {
      const result = await api<Session>("/api/v1/local-nfc/protection-sessions", { method: "POST", body: JSON.stringify(input.data) }, credentials);
      setSession(result);
      onMessage(`Protection request for ${card.publicSlug} queued. Keep the card still against the phone until completion.`);
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
    <p>Set your own password once and reuse it for every card on this workstation. Supported: standard NDEF MIFARE Classic 1K cards. Normal reading stays available.</p>
    {loading ? <p role="status">Loading saved password settings…</p> : null}
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void start("PROTECT"); }}>
      <fieldset disabled={submitting || pending || loading}>
        {savedPassword?.saved ? <label className="checkbox-label"><input type="checkbox" checked={useSaved} onChange={event => { setUseSaved(event.target.checked); setError(""); }} />Use the saved password for all cards on this workstation</label> : null}
        {useSaved ? <p role="status">Saved {savedPassword?.kind === "KEY" ? "NFC key" : "custom password"} selected. No need to enter it again when changing cards or restarting Oneinfo.</p> : <>
          <label>Password format<select value={format} onChange={event => { setFormat(event.target.value as "CUSTOM" | "KEY"); setPassword(""); setAcknowledged(false); }}><option value="CUSTOM">Custom text password</option><option value="KEY">Existing 12-character NFC key</option></select></label>
          <label>{format === "CUSTOM" ? "Your custom password · 8–128 characters" : "Existing NFC key · 12 hexadecimal characters"}<input type="password" autoComplete="off" spellCheck={false} minLength={format === "KEY" ? 12 : 8} maxLength={format === "KEY" ? 12 : 128} pattern={format === "KEY" ? "[0-9A-Fa-f]{12}" : undefined} value={password} onChange={event => { setPassword(event.target.value); setAcknowledged(false); }} /></label>
          <button type="button" className="secondary" onClick={() => { setPassword(Array.from(crypto.getRandomValues(new Uint8Array(format === "KEY" ? 6 : 12)), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase()); setAcknowledged(false); }}>Generate password</button>
          <button type="button" className="secondary" disabled={!password} onClick={() => void navigator.clipboard.writeText(password).then(() => onMessage("Password copied. Save it in your password manager.")).catch(() => setError("Clipboard unavailable. Enter and save your own password."))}>Copy password</button>
          <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have backed up this password and will retry with the SAME password if a tap is interrupted.</label>
          <button type="button" className="secondary" disabled={!acknowledged} onClick={() => void saveForAll()}>Save password for all cards</button>
        </>}
        <div className="actions"><button type="submit" disabled={card.nfcStatus !== "WRITTEN" || (!useSaved && !acknowledged)}>Protect NFC tag</button><button type="button" className="secondary" disabled={card.nfcStatus !== "WRITTEN" || (!useSaved && !acknowledged)} onClick={() => void start("UNPROTECT")}>Remove protection</button></div>
      </fieldset>
    </form>
    {card.nfcStatus !== "WRITTEN" ? <p>Complete Load to NFC and its readback before protecting this card. You can save the shared password now.</p> : null}
    {pending ? <p role="status">{session?.state === "PENDING" ? "Waiting for the phone. Updated Oneinfo APK required." : "Phone has the request. Keep the card still until completion."}{session?.state === "PENDING" ? <button className="text-button" onClick={() => void cancel()}>Cancel waiting request</button> : null}</p> : null}
    {error ? <p className="tool-error" role="alert">{error}</p> : null}
    <small>Changing the saved password does not change existing tags: remove their protection with the original password first. Saved keys stay encrypted on this PC, outside the cloud database; keep your password and workstation backup. MIFARE Classic protection does not prevent cloning or key-recovery attacks.</small>
  </section>;
}
