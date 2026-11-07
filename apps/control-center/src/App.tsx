import { Orders } from "./Orders.js";
import { Products } from "./Products.js";
import { Reviews } from "./Reviews.js";
import oneinfoLogo from "../../../sites/storefront/assets/oneinfo-logo.svg";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api.js";
import { ProfilePhoto } from "./ProfilePhoto.js";
import { ProfileView } from "./ProfileView.js";
import { CardPassport } from "./CardPassport.js";
import { CardPortal } from "./CardPortal.js";
import { TeamAdmin, TeamPortal } from "./TeamPortal.js";
import { ActivationCode } from "./ActivationCode.js";
import { CreateProfileSchema, UpdateProfileSchema } from "@oneinfo/contracts";

type View = "orders" | "products" | "reviews" | "overview" | "profiles" | "cards" | "batches" | "stations" | "audit" | "production" | "companies";
const nav: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◫" }, { id: "products", label: "Products", icon: "▣" },
  { id: "orders", label: "Orders", icon: "≡" }, { id: "reviews", label: "Reviews", icon: "☆" }, { id: "profiles", label: "Client profiles", icon: "◎" },
  { id: "cards", label: "Cards & inventory", icon: "▱" }, { id: "batches", label: "Production batches", icon: "▦" },
  { id: "production", label: "NFC & QR operations", icon: "⌁" }, { id: "stations", label: "Stations", icon: "⌂" },
  { id: "audit", label: "Audit history", icon: "≡" },
  { id: "companies", label: "Companies", icon: "▦" },
];
const currentView = () => nav.find(item => item.id === window.location.hash.slice(1))?.id ?? "overview";
const PRODUCTION_URL = (import.meta.env.VITE_PRODUCTION_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");


interface Overview {
  profiles: number;
  cards: number;
  batches: number;
  stations: number;
  pendingJobs: number;
  qrArtifacts: number;
  nfcAttempts: number;
  inventory: Record<string, number>;
  stockAlerts?: { name: string; remaining: number }[];
}

interface ProfileLink { id?: string; label: string; url: string; sortOrder: number; active: boolean }
interface Profile {
  handle?: string | null;
  id: string;
  publicSlug: string;
  displayName: string;
  headline: string;
  company: string;
  bio: string;
  phone: string;
  email: string;
  website: string;
  avatarUrl: string;
  theme: "MIDNIGHT" | "IVORY" | "MINT";
  published: boolean;
  links?: ProfileLink[];
  cards?: Card[];
}

interface Card {
  id: string;
  publicSlug: string;
  canonicalUrl: string;
  profileId: string | null;
  customerAccountId: string | null;
  lifecycleStatus: string;
  qrStatus: string;
  nfcStatus: string;
  qcStatus: string;
  inventoryStatus: string;
  createdAt: string;
}

interface CardRow { card: Card; profileName: string | null; imageData: string | null; activationCodeIssuedAt: string | null }
interface Batch { id: string; batchCode: string; productVariantId: string; plannedQuantity: number; status: string; createdAt: string; total: number; qrGenerated: number; nfcWritten: number; qcPassed: number }
interface Station { id: string; stationCode: string; name: string; status: string; lastSeenAt: string | null; createdAt: string }
interface Audit { id: string; action: string; targetType: string; targetId: string; createdAt: string }

interface ProfileDraft {
  publicSlug: string;
  displayName: string;
  headline: string;
  company: string;
  bio: string;
  phone: string;
  email: string;
  website: string;
  avatarUrl: string;
  theme: "MIDNIGHT" | "IVORY" | "MINT";
  published: boolean;
  links: ProfileLink[];
}

const blankProfile: ProfileDraft = {
  publicSlug: "",
  displayName: "",
  headline: "",
  company: "",
  bio: "",
  phone: "",
  email: "",
  website: "",
  avatarUrl: "",
  theme: "MIDNIGHT",
  published: false,
  links: [] as ProfileLink[],
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "OI";
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function NavIcon({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>
    {name === "overview" ? <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></> : null}
    {name === "products" ? <><path d="m12 3.8 8.2 4.3v7.8L12 20.2l-8.2-4.3V8.1L12 3.8Z" /><path d="m3.9 8.2 8.1 4.3 8.1-4.3M12 12.5v7.3" /></> : null}
    {name === "orders" ? <><path d="M7 3.5h10l3 3v14H4v-17h3Z" /><path d="M8 10h8M8 14h8M8 18h5" /></> : null}
    {name === "reviews" ? <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L12 3.5Z" /> : null}
    {name === "profiles" ? <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.3-3.4 2.1-5.2 5.5-5.2s5.2 1.8 5.5 5.2M16 5.3a3.2 3.2 0 0 1 0 6.1M17 14.9c2.2.5 3.4 2.2 3.6 5.1" /></> : null}
    {name === "cards" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="11" r="2" /><path d="M5.5 16c.4-1.5 1.4-2.2 3-2.2s2.6.7 3 2.2M14 10h4M14 14h4" /></> : null}
    {name === "batches" ? <><path d="m12 3.5 8 4.2-8 4.2-8-4.2 8-4.2Z" /><path d="m4 12 8 4.2 8-4.2M4 16.3l8 4.2 8-4.2" /></> : null}
    {name === "production" ? <><path d="M7 7a7 7 0 0 1 11.8 4.9M17 17a7 7 0 0 1-11.8-4.9" /><path d="M18.8 7v4.9h-4.9M5.2 17v-4.9h4.9" /><path d="M10 10h.01M14 14h.01" /></> : null}
    {name === "stations" ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 8h10" /></> : null}
    {name === "audit" ? <><path d="M5 4.5h10l4 4V20H5V4.5Z" /><path d="M14.5 4.8v4h4M8 12h8M8 15.5h8M8 19h5" /></> : null}
    {name === "companies" ? <><path d="M5 20V8h6V4h8v16H5Z" /><path d="M8 11v1m0 3v1m6-9v1m0 3v1m0 3v1" /></> : null}
  </svg>;
}

function PublicProfile({ slug }: { slug: string }) {
  const [data, setData] = useState<{ profile: Profile; links: ProfileLink[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ profile: Profile; links: ProfileLink[] }>(`/api/v1/profiles/public/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Profile unavailable"));
  }, [slug]);

  if (error) return <div className="profile-page"><div className="profile-error"><span>ONEINFO</span><h1>Profile unavailable</h1><p>{error}</p></div></div>;
  if (!data) return <div className="profile-page"><div className="profile-loader">Loading Oneinfo profile…</div></div>;
  return <ProfileView data={data} />;
}

function NamedProfile({ handle }: { handle: string }) {
  const [data, setData] = useState<(import("./ProfileView.js").PublicProfileData & { cardSlug: string | null })>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api<NonNullable<typeof data>>(`/api/v1/profiles/handle/${encodeURIComponent(handle)}`).then(result => { if (current) setData(result); })
      .catch(() => { if (current) setError("This profile is unavailable. Check the link or contact the card owner."); });
    return () => { current = false; };
  }, [handle]);
  if (!data) return <main className="card-portal"><section><h1>{error ? "Profile unavailable" : "Opening profile…"}</h1>{error && <p role="alert">{error}</p>}<a href="/">Oneinfo home</a></section></main>;
  return data.cardSlug ? <CardPortal slug={data.cardSlug} /> : <ProfileView data={data} />;
}

export function App() {
  if (/^\/team\/?$/.test(window.location.pathname)) return <TeamPortal />;
  const cardPath = window.location.pathname.match(/^\/c\/([A-Za-z0-9_-]{1,64})(?:\/(?:signup|login|edit))?\/?$/);
  if (cardPath) return <CardPortal slug={cardPath[1]!} />;
  const namedPath = window.location.pathname.match(/^\/([A-Za-z0-9]{1,64})\/?$/);
  if (namedPath && !["admin", "team", "dashboard", "health", "api", "c"].includes(namedPath[1]!.toLowerCase())) return <NamedProfile handle={namedPath[1]!} />;
  const profileSlug = new URLSearchParams(window.location.search).get("profile");
  if (profileSlug) return <PublicProfile slug={profileSlug} />;

  const productionLocation = new URL(PRODUCTION_URL, window.location.href);
  const embedProduction = productionLocation.hostname === window.location.hostname && productionLocation.protocol === window.location.protocol;

  const [token, setToken] = useState(() => localStorage.getItem("oneinfo.admin.token") ?? "");
  const [view, setView] = useState<View>(currentView);
  const [ordersSettingsOpen, setOrdersSettingsOpen] = useState(false);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [cardPages, setCardPages] = useState(1);
  const [moreCards, setMoreCards] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [editing, setEditing] = useState<(ProfileDraft & { id?: string }) | null>(null);
  const [profileError, setProfileError] = useState("");
  const [message, setMessage] = useState("System ready");
  const [busy, setBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [search, setSearch] = useState("");
  const [listPage, setListPage] = useState(1);
  const [listQuery, setListQuery] = useState("");
  const [listMore, setListMore] = useState({ profiles: false, batches: false, audit: false });
  useEffect(() => { setSearch(""); setListQuery(""); setListPage(1); }, [view]);
  useEffect(() => { const timer = setTimeout(() => { setListQuery(search); setListPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const listParams = (target: string) => `?page=${view === target ? listPage : 1}&query=${encodeURIComponent(view === target ? listQuery : "")}`;
  const [syncError, setSyncError] = useState("");
  const [lastSynced, setLastSynced] = useState("");
  const refreshing = useRef<symbol | undefined>(undefined);
  useEffect(() => {
    const changed = () => { setView(currentView()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  useEffect(() => {
    const expired = () => { localStorage.removeItem("oneinfo.admin.token"); setToken(""); };
    window.addEventListener("oneinfo-session-expired", expired);
    return () => window.removeEventListener("oneinfo-session-expired", expired);
  }, []);
  useEffect(() => { setOrdersSettingsOpen(false); }, [view]);


  const bootstrap = async () => {
    setBusy(true);
    try {
      const response = await api<{ accessToken: string }>("/api/v1/dev/token", undefined, { method: "POST" });
      localStorage.setItem("oneinfo.admin.token", response.accessToken);
      setToken(response.accessToken);
      setMessage("Development administrator authenticated");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed");
    } finally { setBusy(false); }
  };

  const refresh = useCallback(async () => {
    if (!token || refreshing.current) return;
    const refreshId = Symbol();
    refreshing.current = refreshId;
    try {
      const [summary, profileList, cardList, batchList, stationList, auditList] = await Promise.all([
        api<Overview>("/api/v1/admin/overview", token),
        api<{ items: Profile[]; hasMore: boolean }>(`/api/v1/profiles${listParams("profiles")}`, token),
        (async () => {
          const items: CardRow[] = [];
          let hasMore = true;
          for (let page = 0; page < cardPages && hasMore; page++) {
            const response = await api<{ items: CardRow[]; hasMore: boolean }>(`/api/v1/admin/cards${items.length ? `?beforeId=${items.at(-1)!.card.id}` : ""}`, token);
            items.push(...response.items); hasMore = response.hasMore;
          }
          return { items, hasMore };
        })(),
        api<{ items: Batch[]; hasMore: boolean }>(`/api/v1/admin/batches${listParams("batches")}`, token),
        api<{ items: Station[] }>("/api/v1/admin/stations", token),
        api<{ items: Audit[]; hasMore: boolean }>(`/api/v1/admin/audit-logs${listParams("audit")}`, token),
      ]);
      if (refreshing.current !== refreshId) return;
      setOverview(summary);
      setProfiles(profileList.items);
      setListMore({ profiles: profileList.hasMore, batches: batchList.hasMore, audit: auditList.hasMore });
      setCards(cardList.items);
      setMoreCards(cardList.hasMore);
      setBatches(batchList.items);
      setStations(stationList.items);
      setAudits(auditList.items);
      setSyncError("");
      setLastSynced(new Date().toLocaleTimeString());
    } catch (error) {
      if (refreshing.current !== refreshId) return;
      const message = error instanceof Error ? error.message : "Could not refresh data";
      setSyncError(message); setMessage(message);
    } finally { if (refreshing.current === refreshId) refreshing.current = undefined; }
  }, [token, cardPages, listPage, listQuery, view]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { refreshing.current = undefined; window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const editProfile = async (profile: Profile) => {
    setProfileError("");
    setBusy(true);
    try {
      const detail = await api<Profile>(`/api/v1/profiles/${profile.id}`, token);
      setEditing({ ...blankProfile, ...detail, links: detail.links ?? [] });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load profile"); }
    finally { setBusy(false); }
  };

  const saveProfile = async () => {
    if (!editing || busy) return;
    setProfileError("");
    const parsed = (editing.id ? UpdateProfileSchema : CreateProfileSchema).safeParse(editing);
    if (!parsed.success) { setProfileError(parsed.error.issues[0]?.message ?? "Check your profile details."); return; }
    setBusy(true);
    try {
      const { id } = editing;
      const payload = parsed.data;
      const saved = id
        ? await api<Profile>(`/api/v1/profiles/${id}`, token, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<Profile>("/api/v1/profiles", token, { method: "POST", body: JSON.stringify(payload) });
      setEditing(null);
      setMessage(`${saved.displayName} saved`);
      await refresh();
    } catch (error) { setProfileError(error instanceof Error ? error.message : "Could not save profile"); }
    finally { setBusy(false); }
  };

  const recoverStation = async (station: Station) => {
    if (!window.confirm(`Stop all writers at ${station.stationCode} first. Revoke its access and return unfinished jobs to the queue? Register a new station before continuing.`)) return;
    setBusy(true);
    try {
      const result = await api<{ recovered: number }>(`/api/v1/admin/stations/${station.id}/recover-jobs`, token, { method: "POST" });
      setMessage(`${result.recovered} jobs recovered. Register a new station before continuing.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Job recovery failed."); }
    finally { setBusy(false); }
  };
  const revokeStation = async (station: Station) => {
    if (!window.confirm(`Revoke ${station.stationCode}? Its connected devices will lose access until the workstation is registered again.`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/stations/${station.id}/revoke`, token, { method: "POST" });
      setMessage(`${station.stationCode} revoked`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke station"); }
    finally { setBusy(false); }
  };

  const deferredSearch = useDeferredValue(search);
  const filteredProfiles = profiles;

  if (!token) return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="logo"><img src={oneinfoLogo} alt="Oneinfo" /></div>
        <p className="eyebrow">CONTROL CENTER</p>
        <h1>Run the entire card lifecycle.</h1>
        <p>Manage client profiles, cards, production batches, NFC/QR operations, stations, inventory, and audit history.</p>
        {import.meta.env.VITE_OPERATOR_LOGIN === "password" ? <form className="admin-login" onSubmit={event => {
          event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
          void api<{ accessToken: string }>("/api/v1/auth/login", undefined, { method: "POST", body: JSON.stringify({ email: loginEmail, password: loginPassword }) })
            .then(result => { localStorage.setItem("oneinfo.admin.token", result.accessToken); setToken(result.accessToken); setLoginPassword(""); })
            .catch(error => setMessage(error instanceof Error ? error.message : "Could not sign in."))
            .finally(() => setBusy(false));
        }}>
          <label>Email<input type="email" autoComplete="username" required value={loginEmail} onChange={event => setLoginEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required maxLength={256} value={loginPassword} onChange={event => setLoginPassword(event.target.value)} /></label>
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form> : <><button disabled={busy} onClick={() => void bootstrap()}>Enter development workspace</button><small>Local development workspace</small></>}
        {message && <p role="alert">{message}</p>}
      </section>
      <aside className="auth-visual"><div className="auth-card-art"><span>ONEINFO</span><strong>CONTROL<br />CENTER</strong><small>IDENTITY · PRODUCTION · INVENTORY</small></div></aside>
    </div>
  );


  return (
    <div className="control-shell">
      <aside className="sidebar">
        <div className="logo light"><img src={oneinfoLogo} alt="Oneinfo" /></div>
        <p className="workspace-label">OPERATIONS WORKSPACE</p>
        <nav aria-label="Admin pages">{nav.map((item) => <button key={item.id} aria-current={view === item.id ? "page" : undefined} className={view === item.id ? "active" : ""} onClick={() => { window.location.hash = item.id; }}><NavIcon name={item.id} />{item.label}</button>)}</nav>
        <div className="sidebar-foot"><span className={`health-dot ${syncError ? "offline" : ""}`}></span><div><strong>{syncError ? "API disconnected" : lastSynced ? "Live API connected" : "Connecting…"}</strong><small>{lastSynced ? `Synced ${lastSynced} · every 5s` : "Connecting to shared production API"}</small></div></div>

      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">{view.replaceAll("_", " ")}</p><h1>{nav.find((item) => item.id === view)?.label}</h1></div>
          <div className="header-tools">{view === "orders" && <button className="quiet" onClick={() => setOrdersSettingsOpen(true)}>Settings</button>}<button className="quiet" onClick={() => void refresh()}>Refresh</button><div className="user-chip">FA</div></div>
        </header>
        {syncError && <div className="workspace-error" role="alert"><span>Live updates paused: {syncError}</span><button className="quiet" onClick={() => void refresh()}>Retry connection</button></div>}
        {!lastSynced && !syncError && <p role="status">Loading your workspace…</p>}

        {view === "overview" && overview ? <section className="dashboard">
          {!!overview.stockAlerts?.length && <section className="panel"><div className="panel-head"><h2>Low stock</h2></div>
            <ul>{overview.stockAlerts.map((alert, index) => <li key={`${alert.name}-${index}`}>{alert.name} · {alert.remaining} remaining</li>)}</ul></section>}
          <div className="metric-grid">
            <Metric label="Client profiles" value={overview.profiles} detail="Digital identities" />
            <Metric label="Physical cards" value={overview.cards} detail={`${overview.inventory.SALEABLE ?? 0} saleable`} />
            <Metric label="Pending jobs" value={overview.pendingJobs} detail="Across QR, NFC and QC" highlight />
            <Metric label="Active stations" value={overview.stations} detail="Registered workstations" />
          </div>
          <div className="dashboard-grid">
            <article className="panel lifecycle-panel"><div className="panel-head"><div><p className="eyebrow">CARD LIFECYCLE</p><h2>Production readiness</h2></div><span>{overview.cards} cards</span></div>
              <div className="lifecycle"><div><span>01</span><strong>{overview.batches}</strong><small>Batches</small></div><i></i><div><span>02</span><strong>{overview.qrArtifacts}</strong><small>QR artifacts</small></div><i></i><div><span>03</span><strong>{overview.nfcAttempts}</strong><small>NFC attempts</small></div><i></i><div><span>04</span><strong>{overview.inventory.SALEABLE ?? 0}</strong><small>Saleable</small></div></div>
            </article>
            <article className="panel inventory-panel"><div className="panel-head"><div><p className="eyebrow">INVENTORY</p><h2>Current state</h2></div></div>
              {Object.entries(overview.inventory).map(([status, value]) => <div className="inventory-row" key={status}><span>{status.replaceAll("_", " ")}</span><b>{value}</b></div>)}
              {Object.keys(overview.inventory).length === 0 ? <p className="empty">No inventory yet</p> : null}
            </article>
          </div>
        </section> : null}

        {view === "products" ? <Products token={token} /> : null}
        {view === "orders" ? <Orders token={token} settingsOpen={ordersSettingsOpen} onSettingsOpenChange={setOrdersSettingsOpen} /> : null}
        {view === "reviews" ? <Reviews token={token} /> : null}
        {view === "companies" ? <TeamAdmin token={token} /> : null}

        {view === "profiles" ? <section>
          <div className="list-toolbar"><input type="search" aria-label="Search client profiles" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients or profile slugs" /><button onClick={() => { setProfileError(""); setEditing({ ...blankProfile }); }}>New client profile</button></div>
          <div className="profile-grid">{filteredProfiles.map((profile) => <article className="profile-tile" key={profile.id}>
            <div className={`tile-cover theme-${profile.theme.toLowerCase()}`}></div><div className="tile-avatar">{initials(profile.displayName)}</div>
            <span className={profile.published ? "pill success" : "pill"}>{profile.published ? "Published" : "Draft"}</span>
            <h3>{profile.displayName}</h3><p>{profile.headline || "No headline"}{profile.company ? ` · ${profile.company}` : ""}</p>
            <small>oneinfo / {profile.handle || profile.publicSlug}</small><div className="tile-actions"><button onClick={() => void editProfile(profile)}>Edit</button>{profile.published ? <a href={profile.handle ? `/${profile.handle}` : `?profile=${profile.publicSlug}`} target="_blank">Open profile ↗</a> : null}</div>
          </article>)}</div>
          {filteredProfiles.length === 0 ? <Empty title="No client profiles" text="Clients create their profile after activating a QC-passed card with its private secret code. Administrators can also create standalone profiles." action="Create profile" onAction={() => setEditing({ ...blankProfile })} /> : null}
        </section> : null}

        {view === "cards" ? <><DataPanel title="Confirmed printed QR stock" columns={["Card / QR", "Profile", "QR", "NFC", "QC", "Inventory", "Private activation"]} rows={cards.map(({ card, profileName, imageData, activationCodeIssuedAt }) => [<div key={card.id}><a href={card.canonicalUrl} target="_blank" rel="noreferrer">{imageData && <img src={imageData} width="72" height="72" alt={`QR ${card.publicSlug}`} />}<br />{card.publicSlug}</a><CardPassport cardId={card.id} token={token} /></div>, profileName ?? "Awaiting client signup", card.qrStatus, card.nfcStatus, card.qcStatus, card.inventoryStatus,
          <ActivationCode key={card.id} cardId={card.id} slug={card.publicSlug} token={token} issued={Boolean(activationCodeIssuedAt)} claimed={Boolean(card.customerAccountId)} ready={card.qcStatus === "PASSED"} />])} />{moreCards && <button onClick={() => setCardPages(count => count + 1)}>Load more QR codes</button>}</> : null}
        {["batches", "audit"].includes(view) && <div className="list-toolbar"><label>Search {view}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>}
        {view === "batches" ? <DataPanel title="Production batches · live" columns={["Batch", "QR ready", "NFC written", "QC approved", "Status", "Workspace"]} rows={batches.map((batch) => [batch.batchCode, `${batch.qrGenerated}/${batch.total}`, `${batch.nfcWritten}/${batch.total}`, `${batch.qcPassed}/${batch.total}`, batch.status, <a href={`${PRODUCTION_URL}/?batch=${encodeURIComponent(batch.id)}`} target="_blank" rel="noreferrer">Open batch ↗</a>])} /> : null}
        {view === "stations" ? <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Production stations</h2></div></div><div className="data-table"><div className="data-row data-header"><span>Station</span><span>Status</span><span>Last seen</span><span>Action</span></div>{stations.map((station) => <div className="data-row station-row" key={station.id}><span><strong>{station.stationCode}</strong><small>{station.name}</small></span><span><b className={`status-text ${station.status.toLowerCase()}`}>{station.status}</b></span><span>{formatDate(station.lastSeenAt)}</span><span>{station.status === "ACTIVE" ? <button className="danger-link" disabled={busy} onClick={() => void revokeStation(station)}>Revoke</button> : "—"}<button className="quiet" disabled={busy} onClick={() => void recoverStation(station)}>Recover unfinished jobs</button></span></div>)}</div></section> : null}
        {view === "audit" ? <DataPanel title="Audit history" columns={["Action", "Target", "Identifier", "Time"]} rows={audits.map((audit) => [audit.action.replaceAll("_", " "), audit.targetType, audit.targetId.slice(0, 12), formatDate(audit.createdAt)])} /> : null}
        {view === "production" ? <section className="production-hub">
          <article className="panel connected-production-head"><div><p className="eyebrow">CONNECTED PRODUCTION WORKSPACE</p><h2>QR, NFC and final QC</h2><p>Your production workstation shares card, order and QC records with this Admin through the cloud database. This dashboard refreshes every five seconds.</p></div>{embedProduction ? <a href={PRODUCTION_URL} target="_blank" rel="noreferrer">Open full console ↗</a> : null}</article>
          {overview ? <div className="metric-grid"><Metric label="Production batches" value={overview.batches} detail="Shared with the console" /><Metric label="Physical cards" value={overview.cards} detail={`${overview.inventory.SALEABLE ?? 0} QC approved and saleable`} /><Metric label="Pending jobs" value={overview.pendingJobs} detail="QR, NFC and QC" /><Metric label="Active stations" value={overview.stations} detail="Managed by this admin panel" /></div> : null}
          {embedProduction ? <><iframe className="production-frame" src={PRODUCTION_URL} title="Connected Oneinfo production console" /><p className="hardware-note">Use the console's registered station and pair your phone there. Operator credentials stay in the console; no access tokens are sent in links.</p></> : <article className="panel workstation-launch">
            <p className="eyebrow">PRODUCTION PC</p><h2>Open your workstation console</h2>
            <p>Generate and print QR batches, read or write NFC tags, and complete phone QC in the console on your production PC.</p>
            <ol><li>Start Oneinfo on the PC where it is installed.</li><li>Open the console below in its own tab to use this browser's saved station.</li><li>Use its Connection tab to pair your phone and continue production.</li></ol>
            <a href={PRODUCTION_URL} target="_blank" rel="noreferrer">Open production console on this PC ↗</a>
            <p className="workstation-help">If the tab cannot connect, start Oneinfo on this PC and try again. Production updates will appear here automatically.</p>
          </article>}
        </section> : null}
        {(view === "profiles" || view === "batches" || view === "audit") && <nav className="list-toolbar" aria-label="List pages">
          <button className="quiet" disabled={listPage === 1} onClick={() => setListPage(page => page - 1)}>Previous page</button>
          <span>Page {listPage}</span><button className="quiet" disabled={!listMore[view]} onClick={() => setListPage(page => page + 1)}>Next page</button>
        </nav>}
      </main>

      <footer className="status-bar" role="status" aria-live="polite"><span className={busy ? "working" : ""}></span>{busy ? "Working." : message}</footer>
      {editing ? <ProfileEditor token={token} value={editing} setValue={setEditing} onClose={() => { setEditing(null); setProfileError(""); }} onSave={() => void saveProfile()} busy={busy} error={profileError} /> : null}
    </div>
  );
}

function Metric({ label, value, detail, highlight = false }: { label: string; value: number; detail: string; highlight?: boolean }) {
  return <article className={`metric ${highlight ? "highlight" : ""}`}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>;
}

function Empty({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><span>◎</span><h2>{title}</h2><p>{text}</p><button onClick={onAction}>{action}</button></div>;
}

function DataPanel({ title, columns, rows }: { title: string; columns: string[]; rows: ReactNode[][] }) {
  return <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">SYSTEM RECORDS</p><h2>{title}</h2></div><span>{rows.length} records</span></div><div className="data-table" role="region" aria-label={title} tabIndex={0}><table aria-label={title}><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{rows.length === 0 ? <p className="empty">No records yet</p> : null}</section>;
}

function ProfileEditor({ token, value, setValue, onClose, onSave, busy, error }: { token: string; value: ProfileDraft & { id?: string }; setValue: (value: ProfileDraft & { id?: string }) => void; onClose: () => void; onSave: () => void; busy: boolean; error: string }) {
  const [photoBusy, setPhotoBusy] = useState(false);
  const currentValue = useRef(value);
  currentValue.current = value;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; const opener = document.activeElement as HTMLElement | null; element?.showModal(); return () => { element?.close(); opener?.focus(); }; }, []);
  const update = (field: keyof typeof blankProfile, next: unknown) => setValue({ ...currentValue.current, [field]: next });
  const addLink = () => update("links", [...value.links, { label: "", url: "https://", sortOrder: value.links.length, active: true }]);
  return <dialog ref={dialog} className="editor-panel" aria-label="Client profile editor" onCancel={event => { event.preventDefault(); if (!busy && !photoBusy) onClose(); }}><header><div><p className="eyebrow">CLIENT PROFILE</p><h2>{value.id ? "Edit digital identity" : "Create digital identity"}</h2></div><button disabled={busy || photoBusy} aria-label="Close profile editor" onClick={onClose}>×</button></header><div className="editor-layout"><form onSubmit={(event) => { event.preventDefault(); if (!photoBusy) onSave(); }}>
    <ProfilePhoto value={value.avatarUrl} name={value.displayName} token={token} operator onChange={url => update("avatarUrl", url)} onBusy={setPhotoBusy} />
    <div className="form-grid"><label>Public slug<input required disabled={Boolean(value.id)} value={value.publicSlug} onChange={(event) => update("publicSlug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></label><label>Display name<input required value={value.displayName} onChange={(event) => update("displayName", event.target.value)} /></label><label>Headline<input value={value.headline} onChange={(event) => update("headline", event.target.value)} /></label><label>Company<input value={value.company} onChange={(event) => update("company", event.target.value)} /></label><label>Email<input type="email" value={value.email} onChange={(event) => update("email", event.target.value)} /></label><label>Phone<input value={value.phone} onChange={(event) => update("phone", event.target.value)} /></label><label>Website<input type="url" value={value.website} onChange={(event) => update("website", event.target.value)} /></label><label>Theme<select value={value.theme} onChange={(event) => update("theme", event.target.value)}><option value="MIDNIGHT">Midnight</option><option value="IVORY">Ivory</option><option value="MINT">Mint</option></select></label><label className="full">Bio<textarea rows={3} value={value.bio} onChange={(event) => update("bio", event.target.value)} /></label></div>
    <div className="links-editor"><div><h3>Profile links</h3><button type="button" disabled={value.links.length >= 12 || busy} onClick={addLink}>Add link</button></div>{value.links.map((link, index) => <div className="link-row" key={index}><input required aria-label={`Link ${index + 1} label`} maxLength={40} placeholder="Label" value={link.label} onChange={(event) => update("links", value.links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /><input required type="url" aria-label={`Link ${index + 1} URL`} maxLength={500} placeholder="https://" value={link.url} onChange={(event) => update("links", value.links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} /><button type="button" disabled={busy} aria-label={`Remove link ${index + 1}`} onClick={() => update("links", value.links.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>
    <label className="publish-toggle"><input type="checkbox" checked={value.published} onChange={(event) => update("published", event.target.checked)} /><span></span><div><strong>Publish profile</strong><small>Allow assigned NFC and QR cards to resolve publicly</small></div></label>
    {error && <p role="alert" className="profile-save-error">{error}</p>}
    <button className="save-button" disabled={busy || photoBusy} type="submit">{busy ? "Saving…" : "Save profile"}</button>
  </form><div className={`editor-preview theme-${value.theme.toLowerCase()}`}><span className="preview-brand">ONEINFO</span><div className="preview-avatar">{value.avatarUrl ? <img src={value.avatarUrl} alt="Profile preview" /> : initials(value.displayName)}</div><small>DIGITAL BUSINESS PROFILE</small><h3>{value.displayName || "Client name"}</h3><p>{value.headline || "Professional headline"}{value.company ? ` · ${value.company}` : ""}</p><div className="preview-actions"><i></i><i></i><i></i></div>{value.website ? <div className="preview-link">Website <b>↗</b></div> : null}{value.links.slice(0, 3).map((link, index) => <div className="preview-link" key={index}>{link.label || "Link"}<b>↗</b></div>)}</div></div></dialog>;
}
