import { useEffect, useState, type FormEvent } from "react";
import { ActivateCardSchema, CustomerProfileSchema } from "@oneinfo/contracts";
import { ProfileView, type PublicProfileData } from "./ProfileView.js";
import type { z } from "zod";

type Draft = z.infer<typeof CustomerProfileSchema>;
type CardResponse = { status: "PROFILE"; profile: PublicProfileData["profile"]; links: PublicProfileData["links"] } |
  { status: "ACTIVATION_REQUIRED" | "UNAVAILABLE" };
const emptyProfile: Draft = { displayName: "", headline: "", company: "", bio: "", phone: "", email: "", website: "", avatarUrl: "", theme: "MIDNIGHT", links: [] };
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

async function customerApi<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1/customer${path}`, { method, cache: "no-store", headers: {
    ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message ?? "Request failed. Please try again."), { status: response.status });
  return data as T;
}

export function CardPortal({ slug }: { slug: string }) {
  const claimKey = `oneinfo.card-claim.${slug}`;
  const [claimToken, setClaimToken] = useState(() => sessionStorage.getItem(claimKey) ?? "");
  const [token, setToken] = useState(() => sessionStorage.getItem("oneinfo.customer.token") ?? "");
  const initialMode = () => window.location.pathname.endsWith("/edit") && sessionStorage.getItem("oneinfo.customer.token") ? "loading-owner" : window.location.pathname.endsWith("/signup") && sessionStorage.getItem(claimKey) ? "signup" :
    window.location.pathname.endsWith("/login") || window.location.pathname.endsWith("/edit") ? "login" : "public";
  const [mode, setMode] = useState(initialMode);
  const [card, setCard] = useState<CardResponse>();
  const [secretCode, setSecretCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<Draft>(emptyProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/c/${encodeURIComponent(slug)}`;
  const navigate = (next: string) => {
    setMode(next);
    window.history.pushState(null, "", `${base}${next === "public" ? "" : next === "details" ? "/edit" : `/${next}`}`);
  };
  const clearClaim = () => { sessionStorage.removeItem(claimKey); setClaimToken(""); };
  const refresh = async () => {
    const result = await customerApi<CardResponse>(`/cards/${encodeURIComponent(slug)}`);
    setCard(result);
    if (result.status === "PROFILE") clearClaim();
  };
  useEffect(() => {
    let disposed = false;
    customerApi<CardResponse>(`/cards/${encodeURIComponent(slug)}`).then(result => { if (!disposed) setCard(result); })
      .catch(error => { if (!disposed) setError(error.message); });
    const pop = () => setMode(initialMode());
    window.addEventListener("popstate", pop);
    return () => { disposed = true; window.removeEventListener("popstate", pop); };
  }, [slug]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (error) {
      const reason = error as Error & { status?: number };
      setError(reason.message);
      if (reason.status === 401 && /[Aa]ctivation/.test(reason.message)) { clearClaim(); navigate("public"); }
      else if (reason.status === 401) { sessionStorage.removeItem("oneinfo.customer.token"); setToken(""); navigate("login"); }
    } finally { setBusy(false); }
  }
  function remember(accessToken: string) { sessionStorage.setItem("oneinfo.customer.token", accessToken); setToken(accessToken); setPassword(""); }
  async function loadOwner(accessToken: string) {
    const owner = await customerApi<{ email: string; profile: Draft; cards: { publicSlug: string }[] }>("/me", "GET", undefined, accessToken);
    if (!claimToken && !owner.cards.some(card => card.publicSlug === slug)) throw new Error("Your account does not own this card. Use its secret code to claim an unactivated card.");
    setEmail(owner.email); setProfile(owner.profile); navigate("details");
  }
  useEffect(() => {
    if (mode !== "loading-owner") return;
    void loadOwner(token).catch(error => {
      setError(error.message);
      if (error.status === 401) { sessionStorage.removeItem("oneinfo.customer.token"); setToken(""); }
      navigate("login");
    });
  }, [mode]);
  const activate = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const parsed = ActivateCardSchema.safeParse({ secretCode });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Enter the secret code supplied with your card.");
    const result = await customerApi<{ claimToken: string }>(`/cards/${encodeURIComponent(slug)}/activate`, "POST", parsed.data);
    sessionStorage.setItem(claimKey, result.claimToken); setClaimToken(result.claimToken); setSecretCode(""); navigate("signup");
  }); };
  const login = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await customerApi<{ accessToken: string }>("/login", "POST", { email, password });
    remember(result.accessToken); await loadOwner(result.accessToken);
  }); };
  const save = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const parsed = CustomerProfileSchema.safeParse(profile);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your profile details.");
    if (mode === "signup") {
      const result = await customerApi<{ accessToken: string }>("/signup", "POST", { email, password, claimToken, profile: parsed.data });
      remember(result.accessToken);
    } else if (claimToken) await customerApi("/claim", "POST", { claimToken, profile: parsed.data }, token);
    else await customerApi("/me/profile", "PATCH", parsed.data, token);
    clearClaim(); navigate("public"); await refresh();
  }); };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setProfile(previous => ({ ...previous, [key]: value }));

  if (!card) return <div className="card-portal"><section><h1>Oneinfo</h1><p role={error ? "alert" : "status"}>{error || "Opening your card…"}</p><button onClick={() => void run(refresh)} disabled={busy}>Try again</button></section></div>;
  if (mode === "loading-owner") return <div className="card-portal"><section><p role="status">Loading your profile…</p></section></div>;
  if (card.status === "UNAVAILABLE") return <div className="card-portal"><section><p className="eyebrow">ONEINFO CARD</p><h1>Card unavailable</h1><p>This card is not ready yet, or its profile is unavailable. Please contact Oneinfo.</p></section></div>;
  if (mode === "public" && card.status === "PROFILE") return <><div className="portal-owner-bar">
    <button disabled={busy} onClick={() => void run(async () => {
      if (token) { try { await loadOwner(token); } catch (error) { if ((error as { status?: number }).status !== 401) throw error; sessionStorage.removeItem("oneinfo.customer.token"); setToken(""); navigate("login"); } }
      else navigate("login");
    })}>Manage this card</button>
    {token && <button onClick={() => { sessionStorage.removeItem("oneinfo.customer.token"); setToken(""); }}>Sign out</button>}
    {error && <span role="alert">{error}</span>}
  </div><ProfileView data={card} /></>;

  return <main className="card-portal"><section>
    <p className="eyebrow">ONEINFO · YOUR DIGITAL CARD</p>
    {mode !== "public" && <button type="button" className="quiet" disabled={busy} onClick={() => navigate("public")}>← Back to card</button>}
    {mode === "public" || (mode === "signup" && !claimToken) ? <>
      <h1>Activate your card</h1><p>Enter the private secret code supplied with your card. Then create your account and save your public profile.</p>
      {claimToken && <button type="button" className="quiet" onClick={() => navigate("signup")}>Continue account setup</button>}
      <form onSubmit={activate}><label>Secret code<input autoComplete="off" spellCheck={false} autoCapitalize="characters" required maxLength={64} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" value={secretCode} onChange={event => setSecretCode(event.target.value)} /></label>
        <button disabled={busy}>{busy ? "Checking…" : "Activate & continue"}</button></form>
    </> : mode === "login" ? <>
      <h1>Sign in</h1><p>{claimToken ? "Sign in to link this card to your existing profile." : "Sign in to manage your card and public details."}</p>
      <form onSubmit={login}><label>Account email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label><button disabled={busy}>Sign in</button></form>
      {claimToken && <button className="quiet" disabled={busy} onClick={() => navigate("signup")}>Create a new account</button>}
    </> : <>
      <h1>{mode === "signup" ? "Create your account" : claimToken ? "Set up your card" : "Edit your public profile"}</h1>
      <p className="portal-privacy">The profile details below will be visible to anyone who scans your QR or NFC. Your password and account email stay private; use Public email only if you want to share it.</p>
      <form onSubmit={save}>
        {mode === "signup" && <fieldset><legend>Private account</legend>
          <label>Account email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Password (at least 12 characters)<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /></label>
        </fieldset>}
        <fieldset><legend>Public profile</legend><label>Full name<input autoComplete="name" minLength={2} maxLength={120} required value={profile.displayName} onChange={event => update("displayName", event.target.value)} /></label>
          <label>Headline / profession<input maxLength={160} value={profile.headline} onChange={event => update("headline", event.target.value)} /></label>
          <label>Company<input maxLength={120} value={profile.company} onChange={event => update("company", event.target.value)} /></label>
          <label>About you<textarea maxLength={600} value={profile.bio} onChange={event => update("bio", event.target.value)} /></label>
          <label>Public phone<input type="tel" maxLength={40} value={profile.phone} onChange={event => update("phone", event.target.value)} /></label>
          <label>Public email<input type="email" value={profile.email} onChange={event => update("email", event.target.value)} /></label>
          <label>Website<input type="url" maxLength={500} value={profile.website} onChange={event => update("website", event.target.value)} /></label>
          <label>Photo URL<input type="url" maxLength={500} value={profile.avatarUrl} onChange={event => update("avatarUrl", event.target.value)} /></label>
          <label>Theme<select value={profile.theme} onChange={event => update("theme", event.target.value as Draft["theme"])}><option value="MIDNIGHT">Midnight</option><option value="IVORY">Ivory</option><option value="MINT">Mint</option></select></label>
        </fieldset>
        <fieldset><legend>Social & other links</legend>{profile.links.map((link, index) => <div className="portal-link" key={index}>
          <label>Label<input required maxLength={40} value={link.label} onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label>
          <label>URL<input required type="url" maxLength={500} value={link.url} onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /></label>
          <button type="button" className="quiet" onClick={() => update("links", profile.links.filter((_, i) => i !== index))}>Remove link</button>
        </div>)}<button type="button" className="quiet" disabled={profile.links.length >= 12} onClick={() => update("links", [...profile.links, { label: "", url: "", sortOrder: profile.links.length, active: true }])}>Add link</button></fieldset>
        <button disabled={busy}>{busy ? "Saving…" : mode === "signup" ? "Create account & save profile" : claimToken ? "Save & claim card" : "Save profile"}</button>
      </form>{mode === "signup" && <button className="quiet" disabled={busy} onClick={() => navigate("login")}>Already have an account? Sign in</button>}
    </>}
    {error && <p className="portal-error" role="alert">{error}</p>}
    <small className="profile-footer">Powered by Oneinfo · NFC + QR</small>
  </section></main>;
}
