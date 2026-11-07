import { AccountAccess, AccountSettings } from "./AccountAccess.js";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api.js";
import { customerApi, LeadInbox, ProfileAnalytics } from "./CardPortal.js";
import { ProfileView, type PublicProfileData } from "./ProfileView.js";
import { readEmployeeCsv } from "./company-csv.js";

type Company = { id: string; name: string; domain: string | null; logoUrl: string; headline: string; bio: string; theme: string; allowEmployeeEdits: boolean };
type Workspace = { company: Company; employees: { id: string; name: string; email: string; profileId: string; publicSlug: string; active: boolean;
  inviteEmailStatus?: "pending" | "sending" | "accepted" | "failed" | null }[];
  cards: { id: string; profileId: string | null; publicSlug: string; lifecycleStatus: string }[] };
type PublicBrand = { company: Pick<Company, "name" | "logoUrl" | "theme">; employees: PublicProfileData["profile"][]; links: PublicProfileData["links"] };
const companyApi = <T,>(path: string, method = "GET", body?: unknown, token?: string) => customerApi<T>(path, method, body, token, "company");
const accountKey = "oneinfo.customer.token";
const values = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));
const messageFor = (error: unknown) => error instanceof Error ? error.message : "Request could not be completed.";
const themeOptions = <><option value="MIDNIGHT">Midnight</option><option value="IVORY">Ivory</option><option value="MINT">Mint</option></>;
const welcomeEmailLabels = { pending: "Welcome email queued", sending: "Sending welcome email", accepted: "Welcome email sent", failed: "Welcome email failed" };

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

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

function CompanyWorkspace() {
  const [token, setToken] = useState(() => sessionStorage.getItem(accountKey) ?? "");
  const [companies, setCompanies] = useState<Company[]>();
  const [selected, setSelected] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [editLink, setEditLink] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [csv, setCsv] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState<"all" | "active" | "inactive">("all");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");

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
    setWorkspace(undefined); setEditLink(""); setCardFilter("all"); setFeedback(""); setEmployeeSearch(""); setEmployeeFilter("all"); setShowQuickAdd(false);
    companyApi<Workspace>(endpoint, "GET", undefined, token).then(data => {
      if (current) {
        setWorkspace(data);
        setLogoUrl(data.company.logoUrl ?? "");
      }
    }).catch(error => { if (current) setFeedback(messageFor(error)); });
    return () => { current = false; };
  }, [selected, token]);

  async function run(action: () => Promise<string>, reload = true) {
    if (busy) return;
    setBusy(true); setFeedback("");
    try {
      const result = await action();
      if (reload) {
        const fresh = await companyApi<Workspace>(endpoint, "GET", undefined, token);
        setWorkspace(fresh);
        setLogoUrl(fresh.company.logoUrl ?? "");
      }
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

  async function handleLogoUpload(file: File) {
    if (busy) return;
    setBusy(true); setFeedback("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("Choose a JPEG, PNG or WebP image.");
      }
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a logo under 5 MB.");
      const extension = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
      const response = await fetch(`${API_URL}/api/v1/product-media/profile/${extension}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
        body: file
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.message ?? "Logo upload failed.");
      const fullUrl = new URL(data.url, API_URL || window.location.origin).href;
      setLogoUrl(fullUrl);
      setFeedback("Logo uploaded successfully. Click 'Save settings' to save your branding.");
    } catch (err) {
      setFeedback(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function exportRosterCsv() {
    if (!workspace || workspace.employees.length === 0) return;
    const headers = ["Name", "Email", "Status", "Public Slug", "Assigned Card"];
    const rows = workspace.employees.map(e => {
      const card = workspace.cards.find(c => c.profileId === e.profileId);
      return [
        `"${e.name.replace(/"/g, '""')}"`,
        `"${e.email.replace(/"/g, '""')}"`,
        `"${e.active ? "Active" : "Inactive"}"`,
        `"${e.publicSlug || ""}"`,
        `"${card?.publicSlug || "Unassigned"}"`
      ].join(",");
    });
    const csvContent = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workspace.company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-roster.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (!token) {
    return <TeamPage title="Company workspace">
      {feedback && <p role="status">{feedback}</p>}
      <form onSubmit={login}>
        <label>Account email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={busy}>Sign in</button><a href="/team#recover">Forgot password?</a>
      </form>
    </TeamPage>;
  }

  const deployed = workspace?.cards.filter(card => card.lifecycleStatus === "ACTIVATED").length ?? 0;
  const visibleCards = workspace?.cards.filter(card => cardFilter === "all" ||
    (cardFilter === "deployed" ? card.lifecycleStatus === "ACTIVATED" : cardFilter === "unassigned" ? !card.profileId : card.lifecycleStatus === "SUSPENDED")) ?? [];

  const activeStaffCount = workspace?.employees.filter(e => e.active).length ?? 0;
  const filteredEmployees = workspace?.employees.filter(employee => {
    const q = employeeSearch.trim().toLowerCase();
    const matchesSearch = !q ||
      employee.name.toLowerCase().includes(q) ||
      employee.email.toLowerCase().includes(q) ||
      (employee.publicSlug && employee.publicSlug.toLowerCase().includes(q));
    const matchesStatus = employeeFilter === "all" ||
      (employeeFilter === "active" ? employee.active : !employee.active);
    return matchesSearch && matchesStatus;
  }) ?? [];

  return <main className="card-portal card-portal-studio"><section className="studio-container">
    <header className="studio-header">
      <div className="studio-header-main">
        <div className="studio-badge-row">
          <span className="studio-eyebrow">ONEINFO // B2B WORKSPACE</span>
          <span className="studio-status-pill">● ENTERPRISE ACTIVE</span>
        </div>
        <h1>Company workspace</h1>
        <p className="portal-privacy">Manage organization branding, digital NFC cards, employee directories, and visitor inquiries in real time.</p>
      </div>
      <div className="studio-header-actions company-workspace-actions">
        {companies && companies.length > 0 && (
          <label className="company-select-wrap">
            <span className="sr-only">Company</span>
            <select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)} className="company-select-dropdown">
              {companies.map(item => <option key={item.id} value={item.id}>🏢 {item.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="quiet studio-btn-back" disabled={busy} onClick={signOut}>Sign out</button>
        {workspace && <button type="button" className="quiet studio-btn-back" disabled={busy}
          onClick={() => void run(async () => "Workspace refreshed.")}>Refresh workspace</button>}
      </div>
    </header>

    {workspace && (
      <nav className="studio-quick-nav" aria-label="Workspace sections">
        <a href="#section-branding" className="studio-nav-pill">🎨 Branding</a>
        <a href="#section-employees" className="studio-nav-pill">👥 Team ({workspace.employees.length})</a>
        <a href="#section-cards" className="studio-nav-pill">💳 NFC Cards ({deployed}/{workspace.cards.length})</a>
        <a href="#company-leads" className="studio-nav-pill">📬 Shared Contacts</a>
        <a href="#company-analytics" className="studio-nav-pill">📊 Analytics</a>
        <a href="#company-security" className="studio-nav-pill">🔒 Security</a>
      </nav>
    )}

    {feedback && <p role="status" className="status-feedback-banner">{feedback}</p>}

    {companies === undefined ? (
      <div className="studio-card"><p>Loading your companies…</p></div>
    ) : companies.length === 0 ? (
      <div className="studio-card"><p>This account has no company workspaces.</p></div>
    ) : !workspace ? <div className="studio-card"><p role="status">{feedback ? "The workspace could not be opened." : "Loading workspace…"}</p>
      {feedback && <button type="button" disabled={busy} onClick={() => void run(async () => "Workspace refreshed.")}>Retry workspace</button>}
    </div> : (
      <div className="studio-workspace-grid">
        <div className="studio-editor-column">
          {/* 1. Branding and profile defaults */}
          <div className="studio-card" id="section-branding">
            <div className="studio-card-top-row">
              <h2>Branding and profile defaults</h2>
              {workspace.company.domain && (
                <a href={`https://${workspace.company.domain}/team`} target="_blank" rel="noreferrer" className="studio-portal-link">
                  Open branded portal ↗
                </a>
              )}
            </div>
            <form key={workspace.company.id} onSubmit={event => {
              event.preventDefault(); const input = values(event.currentTarget);
              void run(async () => { await companyApi(`${endpoint}/settings`, "PUT", { ...input, allowEmployeeEdits: input.allowEmployeeEdits === "on" }, token); return "Company settings saved."; });
            }}>
              <div className="studio-form-grid">
                <label>Company name<input name="name" required maxLength={120} defaultValue={workspace.company.name} /></label>
                <div className="logo-field-wrapper">
                  <label>Logo URL
                    <input name="logoUrl" type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." />
                  </label>
                  <div className="logo-upload-row">
                    <label className="logo-file-btn">
                      <span>{busy ? "Uploading…" : "📁 Upload logo image"}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          if (file) void handleLogoUpload(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {logoUrl && (
                      <button type="button" className="quiet logo-clear-btn" onClick={() => setLogoUrl("")}>
                        Clear logo
                      </button>
                    )}
                  </div>
                </div>
                <label>Profile theme<select name="theme" defaultValue={workspace.company.theme}>{themeOptions}</select></label>
                <label>Profile headline default<input name="headline" maxLength={160} defaultValue={workspace.company.headline} placeholder="e.g. Executive at..." /></label>
              </div>
              <label className="studio-bio-label">Profile bio default<textarea name="bio" maxLength={600} defaultValue={workspace.company.bio} placeholder="Standard introduction for company digital profiles..." /></label>
              <label className="team-check studio-check-label"><input name="allowEmployeeEdits" type="checkbox" defaultChecked={workspace.company.allowEmployeeEdits} /> Allow employees to edit their public information</label>
              <div className="studio-save-action">
                <button className="studio-save-button" disabled={busy}>Save settings</button>
              </div>
            </form>
          </div>

          {/* 2. Employees list & Quick Add */}
          <div className="studio-card" id="section-employees">
            <div className="studio-card-top-row">
              <h2 id="company-employees" tabIndex={-1}>Employees</h2>
              <div className="studio-card-header-actions">
                <button
                  type="button"
                  className="studio-btn-pill-action"
                  onClick={() => setShowQuickAdd(prev => !prev)}
                >
                  {showQuickAdd ? "✕ Close quick add" : "+ Quick add member"}
                </button>
                <button
                  type="button"
                  className="studio-btn-pill-action"
                  onClick={exportRosterCsv}
                  title="Download employee directory as CSV"
                >
                  📥 Export CSV
                </button>
                <span className="studio-counter-pill">{workspace.employees.length} members ({activeStaffCount} active)</span>
              </div>
            </div>

            {/* Quick Add Inline Form */}
            {showQuickAdd && (
              <form
                className="quick-add-employee-card"
                onSubmit={event => {
                  event.preventDefault();
                  const input = values(event.currentTarget) as { singleName?: string; singleEmail?: string; singleHeadline?: string };
                  if (!input.singleName || !input.singleEmail) return;
                  const newMember = {
                    name: input.singleName.trim(),
                    email: input.singleEmail.trim(),
                    headline: input.singleHeadline?.trim() || undefined
                  };
                  void run(async () => {
                    const result = await companyApi<{ added: number; skipped: number; queued?: number }>(
                      `${endpoint}/employees`,
                      "POST",
                      { employees: [newMember] },
                      token
                    );
                    setShowQuickAdd(false);
                    const mail = result.queued ? ` Welcome email queued for ${newMember.name}.` : "";
                    return `Team member ${newMember.name} added.${mail}`;
                  });
                }}
              >
                <div className="quick-add-header">
                  <strong>⚡ Quick Add Team Member</strong>
                  <p>Directly onboard a single colleague without formatting a CSV file.</p>
                </div>
                <div className="studio-form-grid">
                  <label>Full name<input name="singleName" required maxLength={120} placeholder="e.g. Alex Morgan" /></label>
                  <label>Work email<input name="singleEmail" type="email" required placeholder="alex@company.com" /></label>
                  <label className="studio-col-span-2">Job headline (optional)<input name="singleHeadline" maxLength={160} placeholder="e.g. Head of Engineering" /></label>
                </div>
                <div className="quick-add-footer">
                  <button className="studio-save-button" disabled={busy}>Add team member</button>
                  <button type="button" className="quiet" onClick={() => setShowQuickAdd(false)}>Cancel</button>
                </div>
              </form>
            )}

            {/* Live Search and Status Filter */}
            <div className="team-roster-toolbar">
              <div className="roster-search-wrap">
                <span className="roster-search-icon" aria-hidden="true">🔍</span>
                <input
                  type="search"
                  className="roster-search-input"
                  placeholder="Search roster by name, email, or handle…"
                  value={employeeSearch}
                  onChange={e => setEmployeeSearch(e.target.value)}
                  aria-label="Filter employees"
                />
                {employeeSearch && (
                  <button type="button" className="roster-clear-search" onClick={() => setEmployeeSearch("")} aria-label="Clear search">✕</button>
                )}
              </div>
              <div className="roster-status-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={employeeFilter === "all"}
                  className={`roster-status-tab ${employeeFilter === "all" ? "active" : ""}`}
                  onClick={() => setEmployeeFilter("all")}
                >
                  All ({workspace.employees.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={employeeFilter === "active"}
                  className={`roster-status-tab ${employeeFilter === "active" ? "active" : ""}`}
                  onClick={() => setEmployeeFilter("active")}
                >
                  Active ({activeStaffCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={employeeFilter === "inactive"}
                  className={`roster-status-tab ${employeeFilter === "inactive" ? "active" : ""}`}
                  onClick={() => setEmployeeFilter("inactive")}
                >
                  Inactive ({workspace.employees.length - activeStaffCount})
                </button>
              </div>
            </div>

            {/* Generated Edit Link Box */}
            {editLink && (
              <div className="studio-edit-link-card">
                <div className="studio-edit-link-header">
                  <span className="studio-edit-link-badge">⚡ 7-DAY ACCESS LINK READY</span>
                  <p className="studio-edit-link-sub">Share this secure link with the employee so they can customize their public profile.</p>
                </div>
                <label className="studio-edit-link-box">
                  <span>Private edit link, valid for seven days</span>
                  <div className="studio-link-input-group">
                    <input readOnly value={editLink} onFocus={event => event.currentTarget.select()} />
                    <button
                      type="button"
                      className="studio-btn-copy"
                      onClick={() => {
                        void navigator.clipboard.writeText(editLink);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2500);
                      }}
                    >
                      {copiedLink ? "✓ Copied!" : "📋 Copy link"}
                    </button>
                  </div>
                </label>
              </div>
            )}

            {filteredEmployees.length === 0 ? (
              <p role="status" className="studio-empty-text">No team members match the search query or filter.</p>
            ) : (
              <ul className="team-list">
                {filteredEmployees.map(employee => <li key={employee.id} className="team-employee-item">
                  <div className="employee-info-col">
                    <div className="employee-avatar-circle">{employee.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "OI"}</div>
                    <div className="employee-details">
                      <div className="employee-title-line">
                        <strong>{employee.name}</strong> · <span className="employee-email-sub">{employee.email}</span> · <span className={`employee-status-tag ${employee.active ? "active" : "inactive"}`}>{employee.active ? "Active" : "Inactive"}</span>
                      </div>
                      <div className="employee-secondary-line">
                        {employee.publicSlug && (
                          <a href={`/team?profile=${encodeURIComponent(employee.publicSlug)}`} target="_blank" rel="noreferrer" className="employee-view-link">
                            Public profile ↗
                          </a>
                        )}
                        {employee.inviteEmailStatus && <small className="employee-email-sub"> · {welcomeEmailLabels[employee.inviteEmailStatus]}</small>}
                      </div>
                    </div>
                  </div>
                  <div className="employee-actions-row">
                    <button className="quiet studio-btn-emp" type="button" disabled={busy} onClick={() => {
                      if (employee.active && !confirm(`Deactivate ${employee.name} and their assigned cards?`)) return;
                      void run(async () => { setEditLink(""); await companyApi(`${endpoint}/employees/${employee.id}`, "PATCH", { active: !employee.active }, token); return "Employee status updated."; });
                    }}>{employee.active ? "Deactivate" : "Reactivate"}</button>
                    {employee.active && employee.inviteEmailStatus !== undefined && <button className="quiet studio-btn-emp" type="button"
                      disabled={busy || employee.inviteEmailStatus === "pending" || employee.inviteEmailStatus === "sending"} onClick={() => void run(async () => {
                        await companyApi(`${endpoint}/employees/${employee.id}/welcome-email`, "POST", undefined, token);
                        return `Welcome email queued for ${employee.name}. Refresh the workspace for status.`;
                      })}>{employee.inviteEmailStatus === "failed" || employee.inviteEmailStatus === "accepted" ? "Resend welcome email" : "Send welcome email"}</button>}
                    {employee.active && workspace.company.allowEmployeeEdits && <button className="quiet studio-btn-emp" type="button" disabled={busy} onClick={() => void run(async () => {
                      const result = await companyApi<{ path: string }>(`${endpoint}/employees/${employee.id}/edit-link`, "POST", undefined, token);
                      setEditLink(new URL(result.path, location.origin).href); return "Private edit link created. Share it with this employee.";
                    }, false)}>Create edit link</button>}
                  </div>
                </li>)}
              </ul>
            )}
          </div>

          {/* 3. Import employees */}
          <div className="studio-card">
            <h2>Import employees</h2>
            <p>CSV headers are name, email and optional headline. New employees receive a welcome email at the address you enter. Email addresses stay private.</p>
            <p>{workspace.company.allowEmployeeEdits ? "Welcome emails include a private profile edit link valid for seven days." : "Enable employee profile edits above to include an edit link in welcome emails."}</p>
            <form onSubmit={event => {
              event.preventDefault(); void run(async () => {
                const employees = readEmployeeCsv(csv);
                const result = await companyApi<{ added: number; skipped: number; queued?: number }>(`${endpoint}/employees`, "POST", { employees }, token);
                setCsv("");
                const mail = result.queued ? ` Welcome emails queued for ${result.queued}. Refresh the workspace for status.`
                  : result.added && result.queued === 0 ? " Employee email is unavailable. You can retry from the employee list when it is configured." : "";
                return `Imported ${result.added}. Skipped ${result.skipped} already listed.${mail}`;
              });
            }}>
              <label className="studio-upload-label">
                <span>CSV file</span>
                <input type="file" accept=".csv,text/csv" onChange={event => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 128 * 1024) { setFeedback("Choose a CSV file under 128 KB."); return; }
                  void file.text().then(setCsv).catch(() => setFeedback("Could not read the CSV file."));
                }} />
              </label>
              <label className="studio-bio-label">CSV contents<textarea required value={csv} onChange={event => setCsv(event.target.value)} placeholder="name,email,headline" /></label>
              <div className="studio-save-action">
                <button className="studio-save-button" disabled={busy}>Import employees</button>
              </div>
            </form>
          </div>

          {/* 4. Company cards */}
          <div className="studio-card" id="section-cards">
            <div className="studio-card-top-row">
              <h2 id="company-cards" tabIndex={-1}>Company cards</h2>
              <span className="studio-counter-pill">{workspace.cards.length} cards ({deployed} deployed)</span>
            </div>
            {workspace.cards.length === 0 ? <p className="studio-empty-text">Ask your Oneinfo Admin to reserve QC-passed cards for {workspace.company.name}, then refresh this workspace to assign them.</p> :
              <label>Card status<select value={cardFilter} onChange={event => setCardFilter(event.target.value)}>
                <option value="all">All cards</option><option value="deployed">Deployed</option><option value="unassigned">Unassigned</option><option value="suspended">Suspended</option>
              </select></label>}
            {workspace.cards.length > 0 && visibleCards.length === 0 && <p role="status">No cards match this status.</p>}
            <ul className="team-list">
              {visibleCards.map(card => {
                const assignedEmployee = workspace.employees.find(item => item.profileId === card.profileId);
                return (
                  <li key={card.id} className="team-card-item">
                    <div className="card-top-meta">
                      <span className="card-slug-mono">💳 {card.publicSlug}</span>
                      <span className={`card-status-pill status-${card.lifecycleStatus.toLowerCase()}`}>{card.lifecycleStatus}</span>
                    </div>
                    {assignedEmployee && (
                      <div className="card-assigned-sub">
                        <span>👤 Assigned to: <strong>{assignedEmployee.name}</strong> ({assignedEmployee.email})</span>
                      </div>
                    )}
                    {card.lifecycleStatus === "ACTIVATED" && <div className="card-live-links"><a href={`/c/${card.publicSlug}?source=nfc`} target="_blank" rel="noreferrer">NFC link ↗</a> · <a href={`/c/${card.publicSlug}?source=qr`} target="_blank" rel="noreferrer">QR link ↗</a> · <button className="quiet" type="button" disabled={busy} onClick={() => void run(async () => {
                      await navigator.clipboard.writeText(new URL(`/c/${card.publicSlug}`, location.origin).href); return "Public card link copied.";
                    }, false)}>Copy public link</button></div>}
                    {["QC_PASSED", "ACTIVATED", "SUSPENDED"].includes(card.lifecycleStatus) && <form key={`${card.id}-${card.profileId}`} onSubmit={event => {
                      event.preventDefault(); const employeeId = values(event.currentTarget).employeeId || null;
                      void run(async () => { await companyApi(`${endpoint}/cards/${card.id}`, "PUT", { employeeId }, token); return "Card assignment saved."; });
                    }} className="card-assign-form">
                      <label className="card-assign-label">Assigned employee<select name="employeeId" defaultValue={assignedEmployee?.id ?? ""}>
                        <option value="">Unassigned</option>{workspace.employees.filter(item => item.active || item.profileId === card.profileId).map(item => <option key={item.id} value={item.id} disabled={!item.active}>{item.name}</option>)}</select></label>
                      <button disabled={busy} className="studio-btn-assign">Save assignment</button>
                    </form>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <aside className="studio-sidebar-column">
          {/* Company Preview Card */}
          <div className="studio-card studio-preview-card">
            <div className="studio-preview-header">
              <span className="studio-card-tag">ORGANIZATION SNAPSHOT</span>
              <span className="studio-theme-indicator">{workspace.company.theme}</span>
            </div>
            <div className={`company-profile-preview-card preview-theme-${workspace.company.theme.toLowerCase()}`}>
              <div className="mockup-nfc-chip" aria-hidden="true">
                <span>⚡ NFC SMART BUSINESS ID</span>
              </div>
              {workspace.company.logoUrl ? (
                <img className="team-logo company-mockup-logo" src={workspace.company.logoUrl} alt={workspace.company.name} />
              ) : (
                <div className="company-mockup-monogram">
                  {workspace.company.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "CO"}
                </div>
              )}
              <h3 className="company-preview-name">{workspace.company.name}</h3>
              {workspace.company.headline && <p className="company-preview-headline">{workspace.company.headline}</p>}
              {workspace.company.domain && <a className="company-domain-tag" href={`https://${workspace.company.domain}/team`} target="_blank" rel="noreferrer">{workspace.company.domain} ↗</a>}
              <div className="company-stats-grid">
                <a className="company-stat-cell" href="#company-employees">
                  <strong>{activeStaffCount}</strong>
                  <span>Active staff</span>
                </a>
                <a className="company-stat-cell" href="#company-cards" onClick={() => setCardFilter("deployed")}>
                  <strong>{deployed}</strong>
                  <span>Cards deployed</span>
                </a>
              </div>
              <div className="mockup-footer-row">
                <span className="mockup-tap-tag">🛜 Tap or scan card to view</span>
                <a href={workspace.company.domain ? `https://${workspace.company.domain}/team` : "/team"} target="_blank" rel="noreferrer" className="mockup-open-btn">
                  Directory ↗
                </a>
              </div>
            </div>
          </div>

          {/* Lead Inbox */}
          <div className="studio-card studio-side-panel" id="company-leads">
            <LeadInbox key={`${token}:${selected}`} token={token} companyId={selected} />
          </div>

          {/* Profile Analytics */}
          <div className="studio-card studio-side-panel" id="company-analytics">
            <ProfileAnalytics key={selected} token={token} companyId={selected} />
          </div>

          {/* Account Security */}
          <div className="studio-card studio-side-panel studio-security-panel" id="company-security">
            <AccountSettings token={token} onSignOut={signOut} />
          </div>

          <small className="profile-footer">Powered by Arise Studio · Oneinfo Enterprise</small>
        </aside>
      </div>
    )}
  </section></main>;
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
