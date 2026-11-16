import { useEffect, useState, type FormEvent } from "react";
import { customerApi } from "./customer-api.js";
import oneinfoLogo from "./assets/oneinfo-logo.svg";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Could not complete the request. Try again.";

function SvgArrowLeft({ size = 15 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function FormEmailIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function FormLockIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function FormEyeIcon({ show }: { show: boolean }) {
  if (show) {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function AccountAccess({ secret }: { secret?: string | undefined }) {
  const [link, setLink] = useState<{ purpose: string; email: string; companyName?: string }>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (secret) {
      void customerApi<typeof link>("/account-link", "POST", { token: secret })
        .then(setLink)
        .catch(err => setError(errorMessage(err)));
    }
  }, [secret]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await customerApi<{ message: string }>(
        secret ? "/account-link/complete" : "/request-reset",
        "POST",
        secret ? { ...input, token: secret } : input
      );
      setMessage(result.message);
      setDone(Boolean(secret));
      if (secret) sessionStorage.removeItem("oneinfo.customer.token");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/team";
    }
  }

  return (
    <main className="card-portal card-portal-auth">
      <div className="portal-auth-outer">
        <div className="portal-auth-nav-above">
          <button
            type="button"
            className="portal-btn-back quiet"
            disabled={busy}
            onClick={handleBack}
          >
            <SvgArrowLeft />
            <span>Back to card</span>
          </button>
        </div>

        <section className="portal-auth-card">
          <div className="portal-auth-brand-header">
            <img
              src={oneinfoLogo}
              alt="Oneinfo"
              width="132"
              height="38"
              className="portal-brand-logo-centered"
            />
          </div>

          <h1 className="portal-auth-title" style={{ fontSize: "1.2rem", fontWeight: 700, textAlign: "center", margin: "0 0 20px" }}>
            {link?.purpose === "invite" ? "Create your company account" : link?.purpose === "verify" ? "Verify your email" : "Reset your password"}
          </h1>

          {secret && !link && !error && !message && (
            <p className="portal-auth-subtitle" role="status" style={{ textAlign: "center" }}>Checking your link…</p>
          )}

          {!done && (!secret || link) && (
            <form onSubmit={event => void submit(event)} className="portal-auth-form">
              {link ? (
                <p className="portal-auth-subtitle" style={{ textAlign: "center", marginBottom: "8px" }}>
                  {link.email}{link.companyName && ` · ${link.companyName}`}
                </p>
              ) : (
                <label className="portal-auth-label">
                  <span>Account email</span>
                  <div className="portal-input-wrap">
                    <span className="portal-input-icon"><FormEmailIcon /></span>
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      placeholder="you@domain.com"
                      className="portal-auth-input"
                    />
                  </div>
                </label>
              )}

              {link?.purpose === "invite" && (
                <label className="portal-auth-label">
                  <span>Your name</span>
                  <div className="portal-input-wrap">
                    <input
                      name="displayName"
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={120}
                      placeholder="Your full name"
                      className="portal-auth-input"
                      style={{ paddingLeft: "16px" }}
                    />
                  </div>
                </label>
              )}

              {link && link.purpose !== "verify" && (
                <label className="portal-auth-label">
                  <span>New password</span>
                  <div className="portal-input-wrap">
                    <span className="portal-input-icon"><FormLockIcon /></span>
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                      placeholder="••••••••••••"
                      className="portal-auth-input"
                    />
                    <button
                      type="button"
                      className="portal-input-toggle"
                      onClick={() => setShowPassword(prev => !prev)}
                      title={showPassword ? "Hide password" : "Show password"}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <FormEyeIcon show={showPassword} />
                    </button>
                  </div>
                </label>
              )}

              <button className="portal-btn-submit" disabled={busy}>
                {busy ? "Please wait…" : !secret ? "Email reset link" : link?.purpose === "verify" ? "Verify email" : "Save account"}
              </button>
            </form>
          )}

          {message && <p className="portal-auth-status" role="status">{message}</p>}
          {error && <p className="portal-auth-error" role="alert">{error}</p>}
        </section>
      </div>

      <footer className="portal-auth-screen-footer">
        <small className="profile-footer">Powered by AriseStudio</small>
      </footer>
    </main>
  );
}

function SvgCheckShieldIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function SvgAlertCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function SvgRefreshIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export function AccountSettings({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [verified, setVerified] = useState<boolean>();
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessageStr, setErrorMessageStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  async function checkVerification() {
    setChecking(true);
    try {
      setVerified((await customerApi<{ emailVerified: boolean }>("/me", "GET", undefined, token)).emailVerified);
    } catch (error) {
      setErrorMessageStr(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void checkVerification();
  }, [token]);

  async function run(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setStatusMessage("");
    setErrorMessageStr("");
    try {
      const result = await customerApi<{ message: string }>(path, "POST", body, token);
      setStatusMessage(result.message);
      if (path.endsWith("/password")) onSignOut();
    } catch (error) {
      setErrorMessageStr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-security-settings">
      {/* Email Verification Status Row */}
      <div className="security-status-block">
        <div className="security-status-info">
          <span className="security-status-label">Email status</span>
          <div className="security-badge-row">
            {checking ? (
              <span className="security-pill is-checking">
                <span className="security-spinner" /> Checking…
              </span>
            ) : verified === true ? (
              <span className="security-pill is-verified">
                <SvgCheckShieldIcon size={13} /> Verified
              </span>
            ) : verified === false ? (
              <span className="security-pill is-unverified">
                <SvgAlertCircleIcon size={13} /> Unverified
              </span>
            ) : (
              <span className="security-pill is-unavailable">Unavailable</span>
            )}
          </div>
        </div>

        <div className="security-status-actions">
          {verified === false && (
            <button
              type="button"
              className="security-btn-verify"
              disabled={busy || checking}
              onClick={() => void run("/me/verify-email")}
            >
              <FormEmailIcon />
              <span>Send verification link</span>
            </button>
          )}
          {verified !== true && !checking && (
            <button
              type="button"
              className="security-btn-refresh"
              disabled={busy || checking}
              onClick={() => {
                setStatusMessage("");
                setErrorMessageStr("");
                void checkVerification();
              }}
              title="Refresh status"
            >
              <SvgRefreshIcon size={13} />
              <span>Refresh status</span>
            </button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {statusMessage && (
        <div className="security-alert is-success" role="status">
          <SvgCheckShieldIcon size={15} />
          <span>{statusMessage}</span>
        </div>
      )}
      {errorMessageStr && (
        <div className="security-alert is-error" role="alert">
          <SvgAlertCircleIcon size={15} />
          <span>{errorMessageStr}</span>
        </div>
      )}

      {/* Password Change Form */}
      <form
        className="security-password-form"
        onSubmit={event => {
          event.preventDefault();
          void run("/me/password", Object.fromEntries(new FormData(event.currentTarget)));
        }}
      >
        <div className="security-form-header">
          <span className="security-section-title">Change password</span>
          <span className="security-section-hint">At least 12 characters</span>
        </div>

        <div className="security-fields-grid">
          <div className="security-field-wrap">
            <label htmlFor="sec-current-password">Current password</label>
            <div className="security-input-with-toggle">
              <input
                id="sec-current-password"
                name="currentPassword"
                type={showCurrentPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter current password"
                required
                maxLength={128}
                disabled={busy}
              />
              <button
                type="button"
                className="security-toggle-eye"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                tabIndex={-1}
                aria-label={showCurrentPassword ? "Hide password" : "Show password"}
              >
                <FormEyeIcon show={showCurrentPassword} />
              </button>
            </div>
          </div>

          <div className="security-field-wrap">
            <label htmlFor="sec-new-password">New password</label>
            <div className="security-input-with-toggle">
              <input
                id="sec-new-password"
                name="password"
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 12 characters"
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
              />
              <button
                type="button"
                className="security-toggle-eye"
                onClick={() => setShowNewPassword(!showNewPassword)}
                tabIndex={-1}
                aria-label={showNewPassword ? "Hide password" : "Show password"}
              >
                <FormEyeIcon show={showNewPassword} />
              </button>
            </div>
          </div>
        </div>

        <div className="security-submit-wrap">
          <button
            type="submit"
            className="security-submit-btn"
            disabled={busy}
          >
            <FormLockIcon />
            <span>{busy ? "Updating password…" : "Change password and sign out"}</span>
          </button>
          <span className="security-submit-note">
            For security, updating your password signs out active sessions on all devices.
          </span>
        </div>
      </form>
    </div>
  );
}
