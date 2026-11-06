import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActivateCardSchema, CustomerProfileSchema, type ContactLead } from "@oneinfo/contracts";
import { ProfileView, ShareContact, type PublicProfileData } from "./ProfileView.js";
import type { z } from "zod";

import { ProfilePhoto } from "./ProfilePhoto.js";

type Draft = z.infer<typeof CustomerProfileSchema>;
type CardResponse = { status: "PROFILE"; canShareContact?: boolean; crmEnabled?: boolean; profile: PublicProfileData["profile"]; links: PublicProfileData["links"] } |
  { status: "ACTIVATION_REQUIRED" | "UNAVAILABLE" };
const emptyProfile: Draft = { displayName: "", headline: "", company: "", bio: "", phone: "", email: "", website: "", avatarUrl: "", theme: "MIDNIGHT", links: [], profileMode: "BUSINESS", modeContent: {} };
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

export async function customerApi<T>(path: string, method = "GET", body?: unknown, token?: string, namespace = "customer"): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1/${namespace}${path}`, { method, cache: "no-store", keepalive: method === "POST" && path.endsWith("/activity"), headers: {
    ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 204) return undefined as T;
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const trackedView = useRef("");
  const base = `/c/${encodeURIComponent(slug)}`;
  const rawSource = new URLSearchParams(location.search).get("source");
  const source = rawSource === "nfc" ? "NFC" : rawSource === "qr" ? "QR" : "DIRECT";
  const track = (event: "VIEW" | "SAVE" | "LINK", linkId?: string) => {
    void customerApi(`/cards/${encodeURIComponent(slug)}/activity`, "POST", { event, source, linkId }).catch(() => {});
  };
  useEffect(() => {
    const key = `${slug}:${source}`;
    if (mode !== "public" || card?.status !== "PROFILE" || !card.canShareContact || trackedView.current === key) return;
    trackedView.current = key;
    track("VIEW");
  }, [slug, source, mode, card]);
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
    setEmail(owner.email); setProfile({ ...emptyProfile, ...owner.profile }); navigate("details");
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
  const save = (event: FormEvent) => { event.preventDefault(); if (photoBusy) return; void run(async () => {
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
  </div><ProfileView data={card} onActivity={card.canShareContact ? track : undefined} contactAction={card.canShareContact && <ShareContact key={slug} crmEnabled={Boolean(card.crmEnabled)}
    send={input => customerApi(`/cards/${encodeURIComponent(slug)}/contact-leads`, "POST", { ...input, source })} />} /></>;

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
      {mode === "details" && !claimToken && <LeadInbox key={token} token={token} />}
      <p className="portal-privacy">The profile details below will be visible to anyone who scans your QR or NFC. Your password and account email stay private; use Public email only if you want to share it.</p>
      <form onSubmit={save}>
        {mode === "signup" && <fieldset><legend>Private account</legend>
          <label>Account email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Password (at least 12 characters)<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /></label>
        </fieldset>}
        <fieldset><legend>Public profile</legend><ProfilePhoto value={profile.avatarUrl} name={profile.displayName} token={token} claimToken={claimToken} onChange={url => update("avatarUrl", url)} onBusy={setPhotoBusy} /><label>Full name<input autoComplete="name" minLength={2} maxLength={120} required value={profile.displayName} onChange={event => update("displayName", event.target.value)} /></label>
          <label>Headline / profession<input maxLength={160} value={profile.headline} onChange={event => update("headline", event.target.value)} /></label>
          <label>Company<input maxLength={120} value={profile.company} onChange={event => update("company", event.target.value)} /></label>
          <label>About you<textarea maxLength={600} value={profile.bio} onChange={event => update("bio", event.target.value)} /></label>
          <label>Public phone<input type="tel" maxLength={40} value={profile.phone} onChange={event => update("phone", event.target.value)} /></label>
          <label>Public email<input type="email" value={profile.email} onChange={event => update("email", event.target.value)} /></label>
          <label>Website<input type="url" maxLength={500} value={profile.website} onChange={event => update("website", event.target.value)} /></label>
          <label>Theme<select value={profile.theme} onChange={event => update("theme", event.target.value as Draft["theme"])}><option value="MIDNIGHT">Midnight</option><option value="IVORY">Ivory</option><option value="MINT">Mint</option></select></label>
        </fieldset>
        <fieldset><legend>Card mode</legend>
          <label>Active mode<select value={profile.profileMode} onChange={event => update("profileMode", event.target.value as Draft["profileMode"])}>
            <option value="BUSINESS">Business</option><option value="EVENT">Event</option><option value="PORTFOLIO">Portfolio</option>
          </select></label>
          {(["EVENT", "PORTFOLIO"] as const).map(mode => <div key={mode} className="portal-link" hidden={profile.profileMode !== mode}>
            <label>{mode === "EVENT" ? "Event name" : "Portfolio title"}<input maxLength={120} value={profile.modeContent[mode]?.title ?? ""}
              onChange={event => update("modeContent", { ...profile.modeContent, [mode]: { description: profile.modeContent[mode]?.description ?? "", title: event.target.value } })} /></label>
            <label>Description<textarea maxLength={600} value={profile.modeContent[mode]?.description ?? ""}
              onChange={event => update("modeContent", { ...profile.modeContent, [mode]: { title: profile.modeContent[mode]?.title ?? "", description: event.target.value } })} /></label>
          </div>)}
        </fieldset>
        <fieldset><legend>Social & other links</legend>{profile.links.map((link, index) => <div className="portal-link" key={index}>
          <label>Label<input required maxLength={40} value={link.label} onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label>
          <label>URL<input required type="url" maxLength={500} value={link.url} onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /></label>
          <button type="button" className="quiet" onClick={() => update("links", profile.links.filter((_, i) => i !== index))}>Remove link</button>
        </div>)}<button type="button" className="quiet" disabled={profile.links.length >= 12} onClick={() => update("links", [...profile.links, { label: "", url: "", sortOrder: profile.links.length, active: true }])}>Add link</button></fieldset>
        <button disabled={busy || photoBusy}>{photoBusy ? "Uploading photo…" : busy ? "Saving…" : mode === "signup" ? "Create account & save profile" : claimToken ? "Save & claim card" : "Save profile"}</button>
      </form>{mode === "signup" && <button className="quiet" disabled={busy} onClick={() => navigate("login")}>Already have an account? Sign in</button>}
      {mode === "details" && !claimToken && <><ProfileAnalytics token={token} base={base} />
        <p><a href="/team?manage=1">Company workspace</a></p></>}
    </>}
    {error && <p className="portal-error" role="alert">{error}</p>}
    <small className="profile-footer">Powered by Oneinfo · NFC + QR</small>
  </section></main>;
}

export function ProfileAnalytics({ token, base, companyId }: { token: string; base?: string; companyId?: string }) {
  const [items, setItems] = useState<{ mode: string; campaign: string; source: string; event: string; label: string | null; total: number }[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try { setItems((await customerApi<{ items: NonNullable<typeof items> }>(`/me/activity${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`, "GET", undefined, token)).items); }
    catch { setError("Could not load analytics. Check your session and try again."); }
    finally { setBusy(false); }
  }
  return <section className="lead-inbox"><h2>Profile analytics</h2><p>Last 30 days. Contact saves count button clicks.</p>
    {base && <p><a href={`${base}?source=nfc`}>NFC link</a> · <a href={`${base}?source=qr`}>QR link</a></p>}
    <button type="button" className="quiet" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Load analytics"}</button>
    {error && <p role="alert">{error}</p>}
    {items?.length === 0 && <p>No activity recorded yet.</p>}
    {!!items?.length && <ul>{items.map(item => <li key={JSON.stringify([item.mode, item.campaign, item.source, item.event])}>
      <strong>{item.label ?? ({ VIEW: "Profile views", SAVE: "Contact-save clicks", LINK: "Website clicks", LEAD: "Leads" }[item.event] ?? item.event)} · {item.total}</strong>
      <span>{item.campaign || item.mode} · {item.source}</span>
    </li>)}</ul>}
  </section>;
}

export function LeadInbox({ token, companyId }: { token: string; companyId?: string }) {
  const [items, setItems] = useState<ContactLead[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [crmEnabled, setCrmEnabled] = useState(false);

  async function load(before?: string) {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams();
      if (before) query.set("before", before);
      if (companyId) query.set("companyId", companyId);
      const page = await customerApi<{ items: ContactLead[]; nextCursor: string | null; crmEnabled?: boolean }>(
        `/me/contact-leads${query.size ? `?${query}` : ""}`, "GET", undefined, token);
      setItems(previous => before ? [...(previous ?? []), ...page.items] : page.items);
      setNextCursor(page.nextCursor);
      setCrmEnabled(Boolean(page.crmEnabled));
    } catch (error) {
      setError((error as { status?: number }).status === 401 ? "Your session expired. Go back to your card and sign in again." : "Could not load your inbox. Please try again.");
    } finally { setLoading(false); }
  }

  async function forward(lead: ContactLead) {
    if (loading || !confirm("Send this visitor’s shared contact details to the connected CRM?")) return;
    setLoading(true); setError("");
    try {
      const { forwardedAt } = await customerApi<{ forwardedAt: string }>(`/me/contact-leads/${lead.id}/crm`, "POST", undefined, token);
      setItems(previous => previous?.map(item => item.id === lead.id ? { ...item, forwardedAt } : item));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not send to CRM."); }
    finally { setLoading(false); }
  }

  return <section className="lead-inbox" aria-labelledby="lead-inbox-heading">
    <h2 id="lead-inbox-heading">Shared contacts</h2>
    <p>Contacts that visitors chose to share with you.</p>
    <button type="button" className="quiet" disabled={loading} onClick={() => void load()}>
      {loading ? "Loading…" : items ? "Refresh inbox" : "Open inbox"}
    </button>
    {error && <p className="portal-error" role="alert">{error}</p>}
    {items?.length === 0 && <p role="status">No contacts have been shared yet.</p>}
    {!!items?.length && <ul>{items.map(lead => <li key={lead.id}>
      <strong>{lead.name}</strong> <time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleString()}</time>
      {lead.recipientName && <small>Shared via {lead.recipientName}’s card</small>}
      {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
      {lead.phone && <a href={`tel:${lead.phone}`}>{lead.phone}</a>}
      {lead.message && <p>{lead.message}</p>}
      {lead.forwardedAt ? <small>Sent to CRM</small> : crmEnabled && lead.crmAllowed && <button className="quiet" type="button" disabled={loading} onClick={() => void forward(lead)}>Send to CRM</button>}
    </li>)}</ul>}
    {nextCursor && <button type="button" className="quiet" disabled={loading} onClick={() => void load(nextCursor)}>Load older contacts</button>}
  </section>;
}
