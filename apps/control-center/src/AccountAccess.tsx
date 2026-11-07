import { useEffect, useState, type FormEvent } from "react";
import { customerApi } from "./CardPortal.js";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Could not complete the request. Try again.";

export function AccountAccess({ secret }: { secret?: string | undefined }) {
  const [link, setLink] = useState<{ purpose: string; email: string; companyName?: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (secret) void customerApi<typeof link>("/account-link", "POST", { token: secret }).then(setLink).catch(error => setMessage(errorMessage(error)));
  }, [secret]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setMessage("");
    try {
      const result = await customerApi<{ message: string }>(secret ? "/account-link/complete" : "/request-reset", "POST", secret ? { ...input, token: secret } : input);
      setMessage(result.message); setDone(Boolean(secret));
      if (secret) sessionStorage.removeItem("oneinfo.customer.token");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="card-portal"><section>
    <h1>{link?.purpose === "invite" ? "Create your company account" : link?.purpose === "verify" ? "Verify your email" : "Reset your password"}</h1>
    {message && <p role="status">{message}</p>}
    {secret && !link && !message && <p role="status">Checking your link…</p>}
    {!done && (!secret || link) && <form onSubmit={event => void submit(event)}>
      {link ? <p>{link.email}{link.companyName && ` · ${link.companyName}`}</p> : <label>Account email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>}
      {link?.purpose === "invite" && <label>Your name<input name="displayName" autoComplete="name" required minLength={2} maxLength={120} /></label>}
      {link && link.purpose !== "verify" && <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>}
      <button disabled={busy}>{busy ? "Please wait…" : !secret ? "Email reset link" : link?.purpose === "verify" ? "Verify email" : "Save account"}</button>
    </form>}
    <a href="/team?manage=1">Back to sign in</a>
  </section></main>;
}

export function AccountSettings({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [verified, setVerified] = useState<boolean>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void customerApi<{ emailVerified: boolean }>("/me", "GET", undefined, token).then(result => setVerified(result.emailVerified)).catch(error => setMessage(errorMessage(error))); }, [token]);
  async function run(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await customerApi<{ message: string }>(path, "POST", body, token);
      setMessage(result.message);
      if (path.endsWith("/password")) onSignOut();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <details><summary>Account security</summary>
    {message && <p role="status">{message}</p>}
    {verified === true ? <p>Email verified</p> : <button type="button" disabled={busy || verified === undefined} onClick={() => void run("/me/verify-email")}>Send verification email</button>}
    <form onSubmit={event => { event.preventDefault(); void run("/me/password", Object.fromEntries(new FormData(event.currentTarget))); }}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <button disabled={busy}>Change password and sign out</button>
    </form>
  </details>;
}
