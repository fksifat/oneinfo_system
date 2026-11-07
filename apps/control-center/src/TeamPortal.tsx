import { AccountAccess, AccountSettings } from "./AccountAccess.js";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api.js";
import { customerApi, LeadInbox, ProfileAnalytics } from "./CardPortal.js";
import { ProfileView, type PublicProfileData } from "./ProfileView.js";
import { readEmployeeCsv } from "./company-csv.js";

type Company = { id: string; name: string; domain: string | null; logoUrl: string; headline: string; bio: string; theme: string; allowEmployeeEdits: boolean };
type Workspace = { company: Company; employees: { id: string; name: string; email: string; profileId: string; publicSlug: string; active: boolean }[];
  cards: { id: string; profileId: string | null; publicSlug: string; lifecycleStatus: string }[] };
type PublicBrand = { company: Pick<Company, "name" | "logoUrl" | "theme">; employees: PublicProfileData["profile"][]; links: PublicProfileData["links"] };
const companyApi = <T,>(path: string, method = "GET", body?: unknown, token?: string) => customerApi<T>(path, method, body, token, "company");
const accountKey = "oneinfo.customer.token";
const values = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));
const messageFor = (error: unknown) => error instanceof Error ? error.message : "Request could not be completed.";
const themeOptions = <><option value="MIDNIGHT">Midnight</option><option value="IVORY">Ivory</option><option value="MINT">Mint</option></>;

function TeamPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="card-portal"><section><h1>{title}</h1>{children}</section></main>;
}

export function TeamPortal() {
  const [accountHash, setAccountHash] = useState(location.hash);
  useEffect(() => { const changed = () => setAccountHash(location.hash); window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed); }, []);
  const query = new URLSearchParams(location.search);
  const manage = query.has("manage");
  const secret = location.hash.startsWith("#edit/") ? location.hash.slice(6) : "";
  const profileSlug = query.get("profile");
  const [brand, setBrand] = useState<PublicBrand | null>();
  useEffect(() => {
    if (manage || secret) return;
    const controller = new AbortController();
    const endpoint = `${import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001"}/api/v1/company/public/${encodeURIComponent(location.hostname)}${profileSlug ? `?profile=${encodeURIComponent(profileSlug)}` : ""}`;
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => setBrand(response.ok ? await response.json() as PublicBrand : null))
      .catch(() => { if (!controller.signal.aborted) setBrand(null); });
    return () => controller.abort();
  }, [manage, secret, profileSlug]);
  if (accountHash === "#recover" || accountHash.startsWith("#account/")) return <AccountAccess key={accountHash} secret={accountHash.startsWith("#account/") ? accountHash.slice(9) : undefined} />;
  if (secret) return <EmployeeEditor secret={secret} />;
  if (!manage && brand === undefined) return <TeamPage title="Company portal"><p role="status">Loading…</p></TeamPage>;
  if (brand) {
    const { company, employees } = brand;
    const logo = company.logoUrl && <img className="team-logo" src={company.logoUrl} alt={company.name} />;
    if (profileSlug && employees[0]) return <><header className="portal-owner-bar">{logo}<a href="/team">{company.name} directory</a></header><ProfileView data={{ profile: employees[0], links: brand.links }} /></>;
    return <TeamPage title={company.name}>{logo}<ul>{employees.map(employee => <li key={employee.publicSlug}>
      <a href={`/team?profile=${encodeURIComponent(employee.publicSlug)}`}>{employee.displayName}</a>{employee.headline && ` · ${employee.headline}`}</li>)}</ul></TeamPage>;
  }
  if (profileSlug) return <TeamPage title="Profile unavailable"><a href="/team">Back to the company portal</a></TeamPage>;
  return <CompanyWorkspace />;
}

function CompanyWorkspace() {
  const [token, setToken] = useState(() => sessionStorage.getItem(accountKey) ?? "");
  const [companies, setCompanies] = useState<Company[]>();
  const [selected, setSelected] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [editLink, setEditLink] = useState("");
  const [csv, setCsv] = useState("");
  const endpoint = `/me/${selected}`;
  const signOut = () => { sessionStorage.removeItem(accountKey); setToken(""); setCompanies(undefined); setWorkspace(undefined); setSelected(""); setEditLink(""); };

  useEffect(() => {
    if (!token) return;
    let current = true;
    companyApi<{ items: Company[] }>("/me", "GET", undefined, token).then(({ items }) => {
      if (current) { setCompanies(items); setSelected(items[0]?.id ?? ""); }
    }).catch(error => { if (current) { if (error.status === 401) signOut(); setFeedback(messageFor(error)); } });
    return () => { current = false; };
  }, [token]);

  useEffect(() => {
    if (!selected || !token) return;
    let current = true;
    setWorkspace(undefined); setEditLink("");
    companyApi<Workspace>(endpoint, "GET", undefined, token).then(data => { if (current) setWorkspace(data); })
      .catch(error => { if (current) setFeedback(messageFor(error)); });
    return () => { current = false; };
  }, [selected, token]);

  async function run(action: () => Promise<string>, reload = true) {
    if (busy) return;
    setBusy(true); setFeedback("");
    try {
      const result = await action();
      if (reload) setWorkspace(await companyApi<Workspace>(endpoint, "GET", undefined, token));
      setFeedback(result);
    } catch (error) { if ((error as { status?: number }).status === 401) signOut(); setFeedback(messageFor(error)); }
    finally { setBusy(false); }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = values(event.currentTarget);
    void run(async () => {
      const { accessToken } = await customerApi<{ accessToken: string }>("/login", "POST", input);
      sessionStorage.setItem(accountKey, accessToken); setToken(accessToken);
      return "Signed in.";
    }, false);
  }

  return <TeamPage title="Company workspace">
    {feedback && <p role="status">{feedback}</p>}
    {!token ? <form onSubmit={login}>
      <label>Account email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy}>Sign in</button><a href="/team#recover">Forgot password?</a>
    </form> : <>
      <button type="button" className="quiet" disabled={busy} onClick={signOut}>Sign out</button><AccountSettings token={token} onSignOut={signOut} />
      {companies === undefined ? <p>Loading your companies…</p> : companies.length === 0 ? <p>This account has no company workspaces.</p> :
        <label>Company<select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>{companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {workspace && <>
        {workspace.company.domain && <p><a href={`https://${workspace.company.domain}/team`} target="_blank" rel="noreferrer">Open branded portal</a></p>}
        <h2>Branding and profile defaults</h2>
        <form key={workspace.company.id} onSubmit={event => {
          event.preventDefault(); const input = values(event.currentTarget);
          void run(async () => { await companyApi(`${endpoint}/settings`, "PUT", { ...input, allowEmployeeEdits: input.allowEmployeeEdits === "on" }, token); return "Company settings saved."; });
        }}>
          <label>Company name<input name="name" required maxLength={120} defaultValue={workspace.company.name} /></label>
          <label>Logo URL<input name="logoUrl" type="url" defaultValue={workspace.company.logoUrl} /></label>
          <label>Profile headline default<input name="headline" maxLength={160} defaultValue={workspace.company.headline} /></label>
          <label>Profile bio default<textarea name="bio" maxLength={600} defaultValue={workspace.company.bio} /></label>
          <label>Profile theme<select name="theme" defaultValue={workspace.company.theme}>{themeOptions}</select></label>
          <label className="team-check"><input name="allowEmployeeEdits" type="checkbox" defaultChecked={workspace.company.allowEmployeeEdits} /> Allow employees to edit their public information</label>
          <button disabled={busy}>Save settings</button>
        </form>
        <h2>Import employees</h2><p>CSV headers are name, email and optional headline. Employee account emails stay private.</p>
        <form onSubmit={event => {
          event.preventDefault(); void run(async () => {
            const employees = readEmployeeCsv(csv);
            const result = await companyApi<{ added: number; skipped: number }>(`${endpoint}/employees`, "POST", { employees }, token);
            setCsv(""); return `Imported ${result.added}. Skipped ${result.skipped} already listed.`;
          });
        }}><label>CSV file<input type="file" accept=".csv,text/csv" onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 128 * 1024) { setFeedback("Choose a CSV file under 128 KB."); return; }
          void file.text().then(setCsv).catch(() => setFeedback("Could not read the CSV file."));
        }} /></label><label>CSV contents<textarea required value={csv} onChange={event => setCsv(event.target.value)} placeholder="name,email,headline" /></label><button disabled={busy}>Import employees</button></form>
        <h2>Employees</h2>
        {editLink && <label>Private edit link, valid for seven days<input readOnly value={editLink} onFocus={event => event.currentTarget.select()} /></label>}
        <ul className="team-list">{workspace.employees.map(employee => <li key={employee.id}>
          <strong>{employee.name}</strong> · {employee.email} · {employee.active ? "Active" : "Inactive"}
          <div><button className="quiet" type="button" disabled={busy} onClick={() => {
            if (employee.active && !confirm(`Deactivate ${employee.name} and their assigned cards?`)) return;
            void run(async () => { setEditLink(""); await companyApi(`${endpoint}/employees/${employee.id}`, "PATCH", { active: !employee.active }, token); return "Employee status updated."; });
          }}>{employee.active ? "Deactivate" : "Reactivate"}</button>
          {employee.active && workspace.company.allowEmployeeEdits && <button className="quiet" type="button" disabled={busy} onClick={() => void run(async () => {
            const result = await companyApi<{ path: string }>(`${endpoint}/employees/${employee.id}/edit-link`, "POST", undefined, token);
            setEditLink(new URL(result.path, location.origin).href); return "Private edit link created. Share it with this employee.";
          }, false)}>Create edit link</button>}</div>
        </li>)}</ul>
        <h2>Company cards</h2>
        {workspace.cards.length === 0 && <p>Oneinfo Admin can reserve QC-passed cards for this company.</p>}
        <ul className="team-list">{workspace.cards.map(card => <li key={card.id}>
          <strong>{card.publicSlug}</strong> · {card.lifecycleStatus}
          {card.lifecycleStatus === "ACTIVATED" && <p><a href={`/c/${card.publicSlug}?source=nfc`}>NFC link</a> · <a href={`/c/${card.publicSlug}?source=qr`}>QR link</a></p>}
          {["QC_PASSED", "ACTIVATED", "SUSPENDED"].includes(card.lifecycleStatus) && <form key={`${card.id}-${card.profileId}`} onSubmit={event => {
            event.preventDefault(); const employeeId = values(event.currentTarget).employeeId || null;
            void run(async () => { await companyApi(`${endpoint}/cards/${card.id}`, "PUT", { employeeId }, token); return "Card assignment saved."; });
          }}><label>Assigned employee<select name="employeeId" defaultValue={workspace.employees.find(item => item.profileId === card.profileId)?.id ?? ""}>
            <option value="">Unassigned</option>{workspace.employees.filter(item => item.active || item.profileId === card.profileId).map(item => <option key={item.id} value={item.id} disabled={!item.active}>{item.name}</option>)}</select></label>
            <button disabled={busy}>Save assignment</button></form>}
        </li>)}</ul>
        <LeadInbox key={`${token}:${selected}`} token={token} companyId={selected} />
        <ProfileAnalytics key={selected} token={token} companyId={selected} />
      </>}
    </>}
  </TeamPage>;
}

function EmployeeEditor({ secret }: { secret: string }) {
  const [profile, setProfile] = useState<PublicProfileData["profile"]>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    companyApi<{ profile: NonNullable<typeof profile> }>("/employee/profile", "POST", { token: secret }).then(result => { if (current) setProfile(result.profile); })
      .catch(error => { if (current) setMessage(messageFor(error)); });
    return () => { current = false; };
  }, [secret]);
  return <TeamPage title="Edit your company profile">{message && <p role="status">{message}</p>}{profile && <form onSubmit={event => {
    event.preventDefault(); const input = values(event.currentTarget); setBusy(true); setMessage("");
    void companyApi("/employee/profile", "POST", { token: secret, profile: input }).then(() => setMessage("Public profile saved."))
      .catch(error => setMessage(messageFor(error))).finally(() => setBusy(false));
  }}>
    <label>Name<input name="displayName" required maxLength={120} defaultValue={profile.displayName} /></label>
    <label>Headline<input name="headline" maxLength={160} defaultValue={profile.headline} /></label>
    <label>Bio<textarea name="bio" maxLength={600} defaultValue={profile.bio} /></label>
    <label>Public phone<input name="phone" type="tel" maxLength={40} defaultValue={profile.phone} /></label>
    <label>Public email<input name="email" type="email" defaultValue={profile.email} /></label>
    <label>Website<input name="website" type="url" defaultValue={profile.website} /></label>
    <label>Photo URL<input name="avatarUrl" type="url" defaultValue={profile.avatarUrl} /></label>
    <button disabled={busy}>Save public profile</button>
  </form>}</TeamPage>;
}

export function TeamAdmin({ token }: { token: string }) {
  const [items, setItems] = useState<{ id: string; name: string; ownerEmail: string; domain: string | null }[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const path = "/api/v1/company/admin";
  const read = () => api<{ items: typeof items }>(path, token).then(result => setItems(result.items));
  useEffect(() => { void read().catch(error => setMessage(messageFor(error))); }, [token]);
  async function submit(event: FormEvent<HTMLFormElement>, route: string, method: string, field?: "domain" | "cardSlug") {
    event.preventDefault();
    const form = event.currentTarget, input = values(form);
    if (!input.domain) delete input.domain;
    const body = field === "domain" ? { domain: input.domain || null } : input;
    setBusy(true); setMessage("");
    try {
      const result = await api<{ invited?: boolean }>(route, token, { method, body: JSON.stringify(body) });
      if (field !== "domain") form.reset();
      await read();
      setMessage(result.invited ? "Invitation emailed to the owner. They can create their account and workspace using that link within 72 hours." : "Company updated.");
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel team-admin-container">
      <TeamEnquiries token={token} />

      <div className="team-admin-header">
        <span className="eyebrow">ORGANIZATION MANAGEMENT</span>
        <h2>Company workspaces</h2>
        <p>
          Create a workspace for an existing account, or email an invitation to a new owner. The owner can sign in at{" "}
          <a href="/team?manage=1" className="workspace-signin-link">Company workspace ↗</a>.
        </p>
      </div>

      {message && <p role="status" className="status-feedback-banner">{message}</p>}

      <div className="workspace-creator-card">
        <div className="creator-card-header">
          <span className="control-kicker">NEW WORKSPACE REGISTRATION</span>
          <h3>Register new organization</h3>
        </div>
        <form className="workspace-creator-form" onSubmit={event => void submit(event, path, "POST")}>
          <div className="creator-fields-grid">
            <label className="creator-field-label">
              <span className="field-kicker">Company name</span>
              <div className="creator-input-wrap">
                <span className="field-glyph" aria-hidden="true">🏢</span>
                <input name="name" required maxLength={120} placeholder="e.g. Acme Corporation" />
              </div>
            </label>
            <label className="creator-field-label">
              <span className="field-kicker">Owner email</span>
              <div className="creator-input-wrap">
                <span className="field-glyph" aria-hidden="true">✉️</span>
                <input name="ownerEmail" type="email" required placeholder="owner@company.com" />
              </div>
            </label>
            <label className="creator-field-label">
              <span className="field-kicker">Custom domain (optional)</span>
              <div className="creator-input-wrap">
                <span className="field-glyph" aria-hidden="true">🌐</span>
                <input name="domain" placeholder="cards.company.com" />
              </div>
            </label>
          </div>
          <button className="button-create-workspace" disabled={busy}>
            {busy ? "Registering…" : "Create workspace"}
          </button>
        </form>
      </div>

      <div className="registered-workspaces-section">
        <div className="workspaces-section-header">
          <h3>Registered workspaces</h3>
          <span className="workspaces-count-badge">{items.length} organizations</span>
        </div>

        {items.length === 0 ? (
          <p className="workspaces-empty-text">No company workspaces registered yet. Create the first organization above.</p>
        ) : (
          <div className="team-cards-grid">
            {items.map(company => (
              <div className="company-tile-card" key={company.id}>
                <div className="company-tile-head">
                  <div className="company-avatar-glyph" aria-hidden="true">
                    <span>🏢</span>
                  </div>
                  <div className="company-tile-meta">
                    <h4>{company.name}</h4>
                    <p className="company-owner-email">{company.ownerEmail}</p>
                  </div>
                </div>

                <div className="company-tile-domain-status">
                  {company.domain ? (
                    <span className="table-status-pill is-good">
                      <span className="status-dot"></span>
                      {company.domain}
                    </span>
                  ) : (
                    <span className="table-status-pill is-neutral">
                      <span className="status-dot"></span>
                      No custom domain
                    </span>
                  )}
                </div>

                <div className="company-tile-actions-area">
                  <form className="micro-manage-form" onSubmit={event => void submit(event, `${path}/${company.id}/domain`, "PUT", "domain")}>
                    <label className="micro-form-label">
                      <span className="micro-kicker">Domain</span>
                      <input name="domain" defaultValue={company.domain ?? ""} placeholder="cards.company.com" />
                    </label>
                    <button className="button-micro-action" disabled={busy}>Save domain</button>
                  </form>

                  <form className="micro-manage-form" onSubmit={event => void submit(event, `${path}/${company.id}/cards`, "POST", "cardSlug")}>
                    <label className="micro-form-label">
                      <span className="micro-kicker">Available card slug</span>
                      <input name="cardSlug" required maxLength={64} placeholder="e.g. Card-Slug-123" />
                    </label>
                    <button className="button-micro-action" disabled={busy}>Reserve card for company</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TeamEnquiries({ token }: { token: string }) {
  const [items, setItems] = useState<{ id: string; name: string; email: string; company: string; quantity: string; createdAt: string }[]>([]);
  const [page, setPage] = useState(1), [query, setQuery] = useState("");
  const [more, setMore] = useState(false), [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api<{ items: typeof items; hasMore: boolean }>(`/api/v1/company/admin/enquiries?page=${page}&query=${encodeURIComponent(query)}`, token)
      .then(result => { if (active) { setItems(result.items); setMore(result.hasMore); setError(""); } }).catch(reason => { if (active) setError(messageFor(reason)); });
    return () => { active = false; };
  }, [token, page, query, open]);
  return (
    <details className="team-enquiries-panel" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="team-enquiries-summary">
        <div className="summary-left">
          <span className="summary-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <div className="summary-titles">
            <span className="eyebrow">B2B INQUIRY QUEUE</span>
            <strong className="summary-title">Team enquiries</strong>
          </div>
        </div>
        <span className="summary-badge">
          {items.length ? items.length + " incoming leads" : "Expand leads queue"}
        </span>
      </summary>
      <div className="team-enquiries-content">
        <form className="list-toolbar enquiries-search-toolbar" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(String(new FormData(event.currentTarget).get("query") ?? "")); }}>
          <label className="enquiries-search-label">
            <span className="search-glyph" aria-hidden="true">🔍</span>
            <input name="query" type="search" maxLength={120} placeholder="Search enquiries by company or contact..." />
          </label>
          <button type="submit" className="button-enquiries-search">Search</button>
        </form>
        {error && <p role="alert" className="lookup-error-banner">{error}</p>}
        {!items.length && !error && <p className="enquiries-empty">No enquiries found on this page.</p>}
        <div className="enquiries-cards-grid">
          {items.map(item => (
            <div className="enquiry-card" key={item.id}>
              <div className="enquiry-card-head">
                <div className="enquiry-company-meta">
                  <strong>{item.company}</strong>
                  <span className="enquiry-cards-pill">{item.quantity} cards</span>
                </div>
                <small className="enquiry-time">{new Date(item.createdAt).toLocaleDateString("en-BD")}</small>
              </div>
              <div className="enquiry-contact-row">
                <span className="enquiry-contact-name">{item.name}</span>
                <span className="enquiry-sep">·</span>
                <a href={"mailto:" + item.email} className="enquiry-email-link">{item.email}</a>
              </div>
            </div>
          ))}
        </div>
        <nav className="list-pagination-bar" aria-label="Enquiry pages">
          <button className="pagination-button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>
            Previous
          </button>
          <span className="pagination-indicator">Page {page}</span>
          <button className="pagination-button" disabled={!more} onClick={() => setPage(value => value + 1)}>
            Next
          </button>
        </nav>
      </div>
    </details>
  );
}