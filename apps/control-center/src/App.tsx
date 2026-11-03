import { Products } from "./Products.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

type View = "products" | "overview" | "profiles" | "cards" | "batches" | "stations" | "audit" | "production";

interface Overview {
  profiles: number;
  cards: number;
  batches: number;
  stations: number;
  pendingJobs: number;
  qrArtifacts: number;
  nfcAttempts: number;
  inventory: Record<string, number>;
}

interface ProfileLink { id?: string; label: string; url: string; sortOrder: number; active: boolean }
interface Profile {
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
  lifecycleStatus: string;
  qrStatus: string;
  nfcStatus: string;
  qcStatus: string;
  inventoryStatus: string;
  createdAt: string;
}

interface CardRow { card: Card; profileName: string | null }
interface Batch { id: string; batchCode: string; productVariantId: string; plannedQuantity: number; status: string; createdAt: string }
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
  const { profile, links } = data;
  return (
    <div className={`profile-page theme-${profile.theme.toLowerCase()}`}>
      <main className="public-profile">
        <div className="profile-brand"><i></i> ONEINFO</div>
        <div className="public-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials(profile.displayName)}</div>
        <p className="profile-kicker">DIGITAL BUSINESS PROFILE</p>
        <h1>{profile.displayName}</h1>
        <p className="public-headline">{profile.headline}{profile.company ? ` · ${profile.company}` : ""}</p>
        {profile.bio ? <p className="public-bio">{profile.bio}</p> : null}
        <div className="contact-actions">
          {profile.phone ? <a href={`tel:${profile.phone}`}>Call</a> : null}
          {profile.email ? <a href={`mailto:${profile.email}`}>Email</a> : null}
          <button type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</button>
        </div>
        <div className="public-links">
          {profile.website ? <a href={profile.website} target="_blank" rel="noreferrer"><span>Website</span><b>↗</b></a> : null}
          {links.map((link) => <a key={link.id ?? link.url} href={link.url} target="_blank" rel="noreferrer"><span>{link.label}</span><b>↗</b></a>)}
        </div>
        <button className="save-contact" type="button" onClick={() => window.location.href = `mailto:${profile.email}?subject=Contact%20from%20Oneinfo`}>Save contact details</button>
        <small className="profile-footer">Powered by Oneinfo · NFC + QR</small>
      </main>
    </div>
  );
}

export function App() {
  const profileSlug = new URLSearchParams(window.location.search).get("profile");
  if (profileSlug) return <PublicProfile slug={profileSlug} />;

  const [token, setToken] = useState(() => localStorage.getItem("oneinfo.admin.token") ?? "");
  const [view, setView] = useState<View>(() => window.location.hash === "#products" ? "products" : "overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [editing, setEditing] = useState<(ProfileDraft & { id?: string }) | null>(null);
  const [message, setMessage] = useState("System ready");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const expired = () => { localStorage.removeItem("oneinfo.admin.token"); setToken(""); };
    window.addEventListener("oneinfo-session-expired", expired);
    return () => window.removeEventListener("oneinfo-session-expired", expired);
  }, []);

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
    if (!token) return;
    try {
      const [summary, profileList, cardList, batchList, stationList, auditList] = await Promise.all([
        api<Overview>("/api/v1/admin/overview", token),
        api<{ items: Profile[] }>("/api/v1/profiles", token),
        api<{ items: CardRow[] }>("/api/v1/admin/cards", token),
        api<{ items: Batch[] }>("/api/v1/admin/batches", token),
        api<{ items: Station[] }>("/api/v1/admin/stations", token),
        api<{ items: Audit[] }>("/api/v1/admin/audit-logs", token),
      ]);
      setOverview(summary);
      setProfiles(profileList.items);
      setCards(cardList.items);
      setBatches(batchList.items);
      setStations(stationList.items);
      setAudits(auditList.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh data");
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const editProfile = async (profile: Profile) => {
    setBusy(true);
    try {
      const detail = await api<Profile>(`/api/v1/profiles/${profile.id}`, token);
      setEditing({ ...blankProfile, ...detail, links: detail.links ?? [] });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load profile"); }
    finally { setBusy(false); }
  };

  const saveProfile = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...payload } = editing;
      const saved = id
        ? await api<Profile>(`/api/v1/profiles/${id}`, token, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<Profile>("/api/v1/profiles", token, { method: "POST", body: JSON.stringify(payload) });
      setEditing(null);
      setMessage(`${saved.displayName} saved`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save profile"); }
    finally { setBusy(false); }
  };

  const revokeStation = async (station: Station) => {
    setBusy(true);
    try {
      await api(`/api/v1/admin/stations/${station.id}/revoke`, token, { method: "POST" });
      setMessage(`${station.stationCode} revoked`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke station"); }
    finally { setBusy(false); }
  };

  const filteredProfiles = useMemo(() => profiles.filter((profile) => `${profile.displayName} ${profile.company} ${profile.publicSlug}`.toLowerCase().includes(search.toLowerCase())), [profiles, search]);

  if (!token) return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="logo"><i></i><span>ONEINFO</span></div>
        <p className="eyebrow">CONTROL CENTER</p>
        <h1>Run the entire card lifecycle.</h1>
        <p>Manage client profiles, cards, production batches, NFC/QR operations, stations, inventory, and audit history.</p>
        <button disabled={busy} onClick={() => void bootstrap()}>Enter development workspace</button>
        <small>Development authentication only. Connect the production identity provider before launch.</small>
      </section>
      <aside className="auth-visual"><div className="auth-card-art"><span>ONEINFO</span><strong>CONTROL<br />CENTER</strong><small>IDENTITY · PRODUCTION · INVENTORY</small></div></aside>
    </div>
  );

  const nav: { id: View; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "◫" },
    { id: "products", label: "Products", icon: "▣" },
    { id: "profiles", label: "Client profiles", icon: "◎" },
    { id: "cards", label: "Cards & inventory", icon: "▱" },
    { id: "batches", label: "Production batches", icon: "▦" },
    { id: "production", label: "NFC & QR operations", icon: "⌁" },
    { id: "stations", label: "Stations", icon: "⌂" },
    { id: "audit", label: "Audit history", icon: "≡" },
  ];

  return (
    <div className="control-shell">
      <aside className="sidebar">
        <div className="logo light"><i></i><span>ONEINFO</span></div>
        <p className="workspace-label">OPERATIONS WORKSPACE</p>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-foot"><span className="health-dot"></span><div><strong>API connected</strong><small>Development environment</small></div></div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">{view.replaceAll("_", " ")}</p><h1>{nav.find((item) => item.id === view)?.label}</h1></div>
          <div className="header-tools"><button className="quiet" onClick={() => void refresh()}>Refresh</button><div className="user-chip">FA</div></div>
        </header>

        {view === "overview" && overview ? <section className="dashboard">
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

        {view === "profiles" ? <section>
          <div className="list-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients or profile slugs" /><button onClick={() => setEditing({ ...blankProfile })}>New client profile</button></div>
          <div className="profile-grid">{filteredProfiles.map((profile) => <article className="profile-tile" key={profile.id}>
            <div className={`tile-cover theme-${profile.theme.toLowerCase()}`}></div><div className="tile-avatar">{initials(profile.displayName)}</div>
            <span className={profile.published ? "pill success" : "pill"}>{profile.published ? "Published" : "Draft"}</span>
            <h3>{profile.displayName}</h3><p>{profile.headline || "No headline"}{profile.company ? ` · ${profile.company}` : ""}</p>
            <small>oneinfo / {profile.publicSlug}</small><div className="tile-actions"><button onClick={() => void editProfile(profile)}>Edit</button>{profile.published ? <a href={`?profile=${profile.publicSlug}`} target="_blank">Open profile ↗</a> : null}</div>
          </article>)}</div>
          {filteredProfiles.length === 0 ? <Empty title="No client profiles" text="Create the first digital identity, then assign a QC-passed card." action="Create profile" onAction={() => setEditing({ ...blankProfile })} /> : null}
        </section> : null}

        {view === "cards" ? <DataPanel title="Cards and inventory" columns={["Card", "Profile", "QR", "NFC", "QC", "Inventory"]} rows={cards.map(({ card, profileName }) => [card.publicSlug, profileName ?? "Unassigned", card.qrStatus, card.nfcStatus, card.qcStatus, card.inventoryStatus])} /> : null}
        {view === "batches" ? <DataPanel title="Production batches" columns={["Batch", "Variant", "Quantity", "Status", "Created"]} rows={batches.map((batch) => [batch.batchCode, batch.productVariantId, String(batch.plannedQuantity), batch.status, formatDate(batch.createdAt)])} /> : null}
        {view === "stations" ? <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Production stations</h2></div></div><div className="data-table"><div className="data-row data-header"><span>Station</span><span>Status</span><span>Last seen</span><span>Action</span></div>{stations.map((station) => <div className="data-row station-row" key={station.id}><span><strong>{station.stationCode}</strong><small>{station.name}</small></span><span><b className={`status-text ${station.status.toLowerCase()}`}>{station.status}</b></span><span>{formatDate(station.lastSeenAt)}</span><span>{station.status === "ACTIVE" ? <button className="danger-link" disabled={busy} onClick={() => void revokeStation(station)}>Revoke</button> : "—"}</span></div>)}</div></section> : null}
        {view === "audit" ? <DataPanel title="Audit history" columns={["Action", "Target", "Identifier", "Time"]} rows={audits.map((audit) => [audit.action.replaceAll("_", " "), audit.targetType, audit.targetId.slice(0, 12), formatDate(audit.createdAt)])} /> : null}
        {view === "production" ? <section className="production-hub"><article className="production-hero"><p className="eyebrow">PHYSICAL PRODUCTION</p><h2>QR, NFC and quality control.</h2><p>Operators use the dedicated local station console to claim authorized jobs, generate QR artifacts, write NDEF URI records, verify tag read-back, and record QC results.</p><a href="http://localhost:5173" target="_blank">Open production console ↗</a></article><div className="operation-grid"><Operation number="01" title="QR generation" text="Produce PNG assets, record checksums, and retain the canonical card URL." /><Operation number="02" title="NFC encoding" text="Write the same URL through Android USB or a PC/SC reader and verify tag read-back." /><Operation number="03" title="Quality control" text="Gate saleable inventory on QR, NFC, visual, and policy checks." /></div><p className="hardware-note"><strong>Local hardware:</strong> connect an NFC-capable Android phone through ADB, or use a PC/SC USB reader. The management system remains local.</p></section> : null}
      </main>

      <footer className="status-bar"><span className={busy ? "working" : ""}></span>{busy ? "Working…" : message}</footer>
      {editing ? <ProfileEditor value={editing} setValue={setEditing} onClose={() => setEditing(null)} onSave={() => void saveProfile()} busy={busy} /> : null}
    </div>
  );
}

function Metric({ label, value, detail, highlight = false }: { label: string; value: number; detail: string; highlight?: boolean }) {
  return <article className={`metric ${highlight ? "highlight" : ""}`}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>;
}

function Operation({ number, title, text }: { number: string; title: string; text: string }) {
  return <article className="operation"><span>{number}</span><h3>{title}</h3><p>{text}</p></article>;
}

function Empty({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><span>◎</span><h2>{title}</h2><p>{text}</p><button onClick={onAction}>{action}</button></div>;
}

function DataPanel({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  return <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">SYSTEM RECORDS</p><h2>{title}</h2></div><span>{rows.length} records</span></div><div className="data-table"><div className="data-row data-header" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>{columns.map((column) => <span key={column}>{column}</span>)}</div>{rows.map((row, index) => <div className="data-row" key={index} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>{row.map((cell, cellIndex) => <span key={cellIndex}>{cell}</span>)}</div>)}</div>{rows.length === 0 ? <p className="empty">No records yet</p> : null}</section>;
}

function ProfileEditor({ value, setValue, onClose, onSave, busy }: { value: ProfileDraft & { id?: string }; setValue: (value: ProfileDraft & { id?: string }) => void; onClose: () => void; onSave: () => void; busy: boolean }) {
  const update = (field: keyof typeof blankProfile, next: unknown) => setValue({ ...value, [field]: next });
  const addLink = () => update("links", [...value.links, { label: "", url: "https://", sortOrder: value.links.length, active: true }]);
  return <div className="editor-overlay"><div className="editor-panel"><header><div><p className="eyebrow">CLIENT PROFILE</p><h2>{value.id ? "Edit digital identity" : "Create digital identity"}</h2></div><button onClick={onClose}>×</button></header><div className="editor-layout"><form onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="form-grid"><label>Public slug<input required disabled={Boolean(value.id)} value={value.publicSlug} onChange={(event) => update("publicSlug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></label><label>Display name<input required value={value.displayName} onChange={(event) => update("displayName", event.target.value)} /></label><label>Headline<input value={value.headline} onChange={(event) => update("headline", event.target.value)} /></label><label>Company<input value={value.company} onChange={(event) => update("company", event.target.value)} /></label><label>Email<input type="email" value={value.email} onChange={(event) => update("email", event.target.value)} /></label><label>Phone<input value={value.phone} onChange={(event) => update("phone", event.target.value)} /></label><label>Website<input type="url" value={value.website} onChange={(event) => update("website", event.target.value)} /></label><label>Theme<select value={value.theme} onChange={(event) => update("theme", event.target.value)}><option value="MIDNIGHT">Midnight</option><option value="IVORY">Ivory</option><option value="MINT">Mint</option></select></label><label className="full">Bio<textarea rows={3} value={value.bio} onChange={(event) => update("bio", event.target.value)} /></label></div>
    <div className="links-editor"><div><h3>Profile links</h3><button type="button" onClick={addLink}>Add link</button></div>{value.links.map((link, index) => <div className="link-row" key={index}><input placeholder="Label" value={link.label} onChange={(event) => update("links", value.links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /><input placeholder="https://" value={link.url} onChange={(event) => update("links", value.links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} /><button type="button" onClick={() => update("links", value.links.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>
    <label className="publish-toggle"><input type="checkbox" checked={value.published} onChange={(event) => update("published", event.target.checked)} /><span></span><div><strong>Publish profile</strong><small>Allow assigned NFC and QR cards to resolve publicly</small></div></label>
    <button className="save-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"}</button>
  </form><div className={`editor-preview theme-${value.theme.toLowerCase()}`}><span className="preview-brand">ONEINFO</span><div className="preview-avatar">{initials(value.displayName)}</div><small>DIGITAL BUSINESS PROFILE</small><h3>{value.displayName || "Client name"}</h3><p>{value.headline || "Professional headline"}{value.company ? ` · ${value.company}` : ""}</p><div className="preview-actions"><i></i><i></i><i></i></div>{value.website ? <div className="preview-link">Website <b>↗</b></div> : null}{value.links.slice(0, 3).map((link, index) => <div className="preview-link" key={index}>{link.label || "Link"}<b>↗</b></div>)}</div></div></div></div>;
}
