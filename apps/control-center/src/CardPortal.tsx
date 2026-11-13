import { AccountSettings } from "./AccountAccess.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActivateCardSchema, CustomerProfileSchema, type ContactLead } from "@oneinfo/contracts";
import { ProfileView, ProfileSkeleton, ShareContact, SocialBrandIcon, detectSocialBrand, type PublicProfileData } from "./ProfileView.js";
import { customerApi } from "./customer-api.js";
import type { z } from "zod";

import { ProfilePhoto } from "./ProfilePhoto.js";
import oneinfoLogo from "../../../sites/storefront/assets/oneinfo-logo.svg";

type Draft = z.infer<typeof CustomerProfileSchema>;
type CardResponse = { status: "PROFILE"; canShareContact?: boolean | undefined; crmEnabled?: boolean | undefined; profile: PublicProfileData["profile"]; links: PublicProfileData["links"] } |
  { status: "ACTIVATION_REQUIRED"; activationMethod?: "SECRET" | "INVOICE" } | { status: "UNAVAILABLE" };
const emptyProfile: Draft = { displayName: "", headline: "", company: "", bio: "", phone: "", email: "", website: "", avatarUrl: "", theme: "MIDNIGHT", links: [], profileMode: "BUSINESS", modeContent: {} };
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

const PRESET_PLATFORMS = [
  { id: "whatsapp", label: "WhatsApp", prefix: "https://wa.me/", placeholder: "https://wa.me/8801XXXXXXXXX" },
  { id: "facebook", label: "Facebook", prefix: "https://facebook.com/", placeholder: "https://facebook.com/yourprofile" },
  { id: "youtube", label: "YouTube", prefix: "https://youtube.com/@", placeholder: "https://youtube.com/@yourchannel" },
  { id: "instagram", label: "Instagram", prefix: "https://instagram.com/", placeholder: "https://instagram.com/yourusername" },
  { id: "linkedin", label: "LinkedIn", prefix: "https://linkedin.com/in/", placeholder: "https://linkedin.com/in/yourprofile" },
  { id: "twitter", label: "X (Twitter)", prefix: "https://x.com/", placeholder: "https://x.com/yourhandle" },
  { id: "tiktok", label: "TikTok", prefix: "https://tiktok.com/@", placeholder: "https://tiktok.com/@yourusername" },
  { id: "telegram", label: "Telegram", prefix: "https://t.me/", placeholder: "https://t.me/yourusername" },
  { id: "github", label: "GitHub", prefix: "https://github.com/", placeholder: "https://github.com/yourusername" },
  { id: "portfolio", label: "Portfolio / Work", prefix: "https://", placeholder: "https://yourportfolio.com" },
  { id: "design", label: "Design (Behance / Dribbble)", prefix: "https://behance.net/", placeholder: "https://behance.net/yourprofile" },
  { id: "shop", label: "Store / Shop", prefix: "https://", placeholder: "https://yourstore.com" },
  { id: "calendar", label: "Calendar / Meeting", prefix: "https://calendly.com/", placeholder: "https://calendly.com/yourlink" },
  { id: "map", label: "Google Maps", prefix: "https://maps.google.com/?q=", placeholder: "https://maps.app.goo.gl/..." },
  { id: "globe", label: "Website / Other", prefix: "https://", placeholder: "https://yourwebsite.com" },
] as const;

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

function TabEditIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TabPreviewIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function TabSettingsIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function TabInboxIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function SvgCheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SvgPlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SvgArrowLeft({ size = 15 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function SvgExternalLink({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function SvgChevronDown({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SvgTrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function SvgCloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function CardPortal({
  slug,
  initialCard,
}: {
  slug: string;
  initialCard?: CardResponse | undefined;
}) {
  const claimKey = `oneinfo.card-claim.${slug}`;
  const [claimToken, setClaimToken] = useState(() => sessionStorage.getItem(claimKey) ?? "");
  const [token, setToken] = useState(() => sessionStorage.getItem("oneinfo.customer.token") ?? "");
  const initialMode = () => window.location.pathname.endsWith("/edit") && sessionStorage.getItem("oneinfo.customer.token") ? "loading-owner" : window.location.pathname.endsWith("/signup") && sessionStorage.getItem(claimKey) ? "signup" :
    window.location.pathname.endsWith("/login") || window.location.pathname.endsWith("/edit") ? "login" : "public";
  const [mode, setMode] = useState(initialMode);
  const [card, setCard] = useState<CardResponse | undefined>(initialCard);
  const [secretCode, setSecretCode] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [activationMessage, setActivationMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [studioTab, setStudioTab] = useState<"edit" | "settings" | "contacts" | "preview">("edit");
  const lastEditorTabRef = useRef<"edit" | "settings" | "contacts">("edit");
  const [openPlatformIndex, setOpenPlatformIndex] = useState<number | null>(null);
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
  useEffect(() => {
    if (mode === "public" && card?.status === "PROFILE" && card.profile.handle) {
      window.history.replaceState(null, "", `/${card.profile.handle}${location.search}`);
    }
  }, [mode, card]);
  const navigate = (next: string) => {
    setMode(next);
    window.history.pushState(null, "", `${base}${next === "public" ? "" : next === "details" ? "/edit" : `/${next}`}`);
  };

  useEffect(() => {
    if (openPlatformIndex === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".studio-platform-picker")) {
        setOpenPlatformIndex(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openPlatformIndex]);

  const handlePlatformChange = (index: number, targetKind: string) => {
    const chosen = PRESET_PLATFORMS.find(p => p.id === targetKind);
    if (!chosen) return;
    const currentLink = profile.links[index];
    if (!currentLink) return;
    const currentUrl = currentLink.url.trim();
    const isUrlEmptyOrOldPrefix = !currentUrl || PRESET_PLATFORMS.some(p => p.prefix === currentUrl);
    const nextUrl = isUrlEmptyOrOldPrefix ? chosen.prefix : currentUrl;
    const isLabelDefault = !currentLink.label.trim() || PRESET_PLATFORMS.some(p => p.label.toLowerCase() === currentLink.label.trim().toLowerCase() || p.id === currentLink.label.trim().toLowerCase());
    const nextLabel = isLabelDefault ? (chosen.id === "globe" ? "Website" : chosen.label) : currentLink.label;
    update("links", profile.links.map((item, i) => (i === index ? { ...item, label: nextLabel, url: nextUrl } : item)));
  };
  const clearClaim = () => { sessionStorage.removeItem(claimKey); setClaimToken(""); };
  const refresh = async () => {
    const result = await customerApi<CardResponse>(`/cards/${encodeURIComponent(slug)}`);
    setCard(result);
    if (result.status === "PROFILE") clearClaim();
  };
  useEffect(() => {
    let disposed = false;
    if (!initialCard) {
      customerApi<CardResponse>(`/cards/${encodeURIComponent(slug)}`).then(result => { if (!disposed) setCard(result); })
        .catch(error => { if (!disposed) setError(error.message); });
    }
    const pop = () => setMode(initialMode());
    window.addEventListener("popstate", pop);
    return () => { disposed = true; window.removeEventListener("popstate", pop); };
  }, [slug, initialCard]);

  useEffect(() => {
    function openInvoiceLink() {
      const match = /^#invoice-claim\/([a-zA-Z0-9_.-]{1,2048})$/.exec(location.hash);
      if (!match?.[1]) return;
      const claimToken = match[1];
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
      setBusy(true); setError("");
      void customerApi<{ email: string }>(`/cards/${encodeURIComponent(slug)}/invoice-claim`, "POST", { claimToken })
        .then(result => {
          sessionStorage.setItem(claimKey, claimToken);
          setClaimToken(claimToken); setEmail(result.email); navigate("signup");
        })
        .catch(e => setError(e.message)).finally(() => setBusy(false));
    }
    openInvoiceLink();
    window.addEventListener("hashchange", openInvoiceLink);
    return () => window.removeEventListener("hashchange", openInvoiceLink);
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
    const owner = await customerApi<{ email: string; profile: Draft; cards: { publicSlug: string }[] }>(claimToken ? "/me" : `/me?cardSlug=${encodeURIComponent(slug)}`, "GET", undefined, accessToken);
    if (!claimToken && !owner.cards.some(card => card.publicSlug === slug)) throw new Error("Your account does not own this card. Start activation to claim an unactivated card.");
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
  const activateInvoice = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await customerApi<{ message: string }>(`/cards/${encodeURIComponent(slug)}/invoice-activation`, "POST", { invoiceNumber });
    setActivationMessage(result.message);
  }); };
  useEffect(() => {
    if (!email) {
      if (card?.status === "PROFILE" && card.profile?.email) {
        setEmail(card.profile.email);
      } else {
        const last = localStorage.getItem("oneinfo.last_customer_email");
        if (last) setEmail(last);
      }
    }
  }, [card, email]);

  const login = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await customerApi<{ accessToken: string }>("/login", "POST", { email, password });
    localStorage.setItem("oneinfo.last_customer_email", email);
    remember(result.accessToken); await loadOwner(result.accessToken);
  }); };
  const executeSave = () => {
    if (photoBusy) return;
    void run(async () => {
      const parsed = CustomerProfileSchema.safeParse(profile);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your profile details.");
      if (mode === "signup") {
        const result = await customerApi<{ accessToken: string }>("/signup", "POST", { email, password, claimToken, profile: parsed.data });
        remember(result.accessToken);
      } else if (claimToken) await customerApi("/claim", "POST", { claimToken, profile: parsed.data }, token);
      else await customerApi(`/me/profile?cardSlug=${encodeURIComponent(slug)}`, "PATCH", parsed.data, token);
      clearClaim(); navigate("public"); await refresh();
    });
  };
  const save = (event: FormEvent) => { event.preventDefault(); executeSave(); };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setProfile(previous => ({ ...previous, [key]: value }));

  if (!card) {
    if (mode === "public") return <ProfileSkeleton error={error} onRetry={() => void run(refresh)} />;
    return <div className="card-portal"><section><h1>Oneinfo</h1><p role={error ? "alert" : "status"}>{error || "Opening your card…"}</p><button onClick={() => void run(refresh)} disabled={busy}>Try again</button></section></div>;
  }
  if (mode === "loading-owner") return <ProfileSkeleton />;
  if (card.status === "UNAVAILABLE") return <ProfileSkeleton error="This card is not ready yet, or its profile is unavailable. Please contact Oneinfo." />;
  if (mode === "public" && card.status === "PROFILE") {
    return (
      <ProfileView
        data={card}
        onActivity={card.canShareContact ? track : undefined}
        contactAction={card.canShareContact && <ShareContact key={slug} crmEnabled={Boolean(card.crmEnabled)}
          send={input => customerApi(`/cards/${encodeURIComponent(slug)}/contact-leads`, "POST", { ...input, source })} />}
        onManage={() => void run(async () => {
          if (!email && card?.status === "PROFILE" && card.profile?.email) {
            setEmail(card.profile.email);
          }
          if (token) {
            try {
              await loadOwner(token);
            } catch (error) {
              if ((error as { status?: number }).status !== 401) throw error;
              sessionStorage.removeItem("oneinfo.customer.token");
              setToken("");
              navigate("login");
            }
          } else {
            navigate("login");
          }
        })}
        isOwnerLoggedIn={Boolean(token)}
      />
    );
  }

  const isEditor = mode === "details" || (mode === "signup" && Boolean(claimToken));
  const invoiceActivation = card.status === "ACTIVATION_REQUIRED" && card.activationMethod === "INVOICE";

  if (!isEditor) {
    return (
      <main className="card-portal card-portal-auth">
        <div className="portal-auth-outer">
          {mode !== "public" && (
            <div className="portal-auth-nav-above">
              <button
                type="button"
                className="portal-btn-back quiet"
                disabled={busy}
                onClick={() => navigate("public")}
              >
                <SvgArrowLeft />
                <span>Back to card</span>
              </button>
            </div>
          )}

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

            {mode === "public" || (mode === "signup" && !claimToken) ? (
              <>
                <h1 className="portal-auth-title">Activate your card</h1>
                <p className="portal-auth-subtitle">
                  {invoiceActivation
                    ? "Enter the invoice number from your order. After delivery we’ll send a verification link to your order email."
                    : "Enter the private secret code supplied with your card. Then create your account and save your public profile."}
                </p>
                {claimToken && (
                  <button type="button" className="quiet portal-btn-continue" onClick={() => navigate("signup")}>
                    Continue account setup
                  </button>
                )}
                {invoiceActivation ? (
                  <form onSubmit={activateInvoice} className="portal-auth-form">
                    <label className="portal-auth-label">
                      <span>Invoice number</span>
                      <input
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="characters"
                        required
                        maxLength={15}
                        pattern="[0-9]{8}-[A-Za-z0-9]{6}"
                        placeholder="20261108-K7T9MX"
                        value={invoiceNumber}
                        onChange={event => { setInvoiceNumber(event.target.value.toUpperCase()); setActivationMessage(""); }}
                        className="portal-auth-input"
                      />
                    </label>
                    <button className="portal-btn-submit" disabled={busy}>
                      {busy ? "Checking…" : "Send verification link"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={activate} className="portal-auth-form">
                    <label className="portal-auth-label">
                      <span>Secret code</span>
                      <input
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="characters"
                        required
                        maxLength={64}
                        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                        value={secretCode}
                        onChange={event => setSecretCode(event.target.value)}
                        className="portal-auth-input"
                      />
                    </label>
                    <button className="portal-btn-submit" disabled={busy}>
                      {busy ? "Checking…" : "Activate & continue"}
                    </button>
                  </form>
                )}
                {activationMessage && <p role="status" className="portal-auth-status">{activationMessage}</p>}
              </>
            ) : (
              <>
                <form onSubmit={login} className="portal-auth-form">
                  <label className="portal-auth-label">
                    <span>Account email</span>
                    <div className="portal-input-wrap">
                      <span className="portal-input-icon"><FormEmailIcon /></span>
                      <input
                        type="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        placeholder="you@domain.com"
                        className="portal-auth-input"
                      />
                    </div>
                  </label>

                  <label className="portal-auth-label">
                    <span>Password</span>
                    <div className="portal-input-wrap">
                      <span className="portal-input-icon"><FormLockIcon /></span>
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        value={password}
                        onChange={event => setPassword(event.target.value)}
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

                  <button className="portal-btn-submit" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                </form>

                <div className="portal-auth-links">
                  <a href="/team#recover" className="portal-forgot-link">Forgot password?</a>
                  {claimToken && (
                    <button className="quiet portal-switch-link" disabled={busy} onClick={() => navigate("signup")}>
                      Create a new account
                    </button>
                  )}
                </div>
              </>
            )}

            {error && <p className="portal-error portal-auth-error" role="alert">{error}</p>}
          </section>
        </div>

        <footer className="portal-auth-screen-footer">
          <small className="profile-footer">Powered by AriseStudio</small>
        </footer>
      </main>
    );
  }

  const livePreviewData: PublicProfileData = {
    profile: {
      publicSlug: slug,
      displayName: profile.displayName || "Your Name",
      headline: profile.headline || "Your headline or profession",
      company: profile.company || "",
      bio: profile.bio || "",
      phone: profile.phone || "",
      email: profile.email || "",
      website: profile.website || "",
      avatarUrl: profile.avatarUrl || "",
      theme: profile.theme,
      profileMode: profile.profileMode,
      modeContent: profile.modeContent,
    },
    links: profile.links.filter(l => l.url || l.label),
  };

  if (studioTab === "preview") {
    return (
      <div className="studio-fullscreen-preview">
        <ProfileView
          data={livePreviewData}
          onManage={() => setStudioTab(lastEditorTabRef.current)}
          isOwnerLoggedIn={Boolean(token)}
          contactAction={
            <ShareContact
              key={`${slug}-preview-live`}
              crmEnabled={true}
              send={async () => {
                await new Promise((r) => setTimeout(r, 600));
              }}
            />
          }
        />
        {/* Floating Dock: Exit preview / Save profile */}
        <div className="studio-mobile-dock studio-preview-dock">
          <button
            type="button"
            className="studio-dock-btn studio-dock-exit"
            onClick={() => setStudioTab(lastEditorTabRef.current)}
          >
            <SvgArrowLeft size={16} />
            <span>Exit preview</span>
          </button>
          <button
            type="button"
            className="studio-dock-btn studio-dock-save"
            disabled={busy || photoBusy}
            onClick={executeSave}
          >
            <SvgCheckIcon size={16} />
            <span>{photoBusy ? "Uploading…" : busy ? "Saving…" : "Save profile"}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="card-portal card-portal-studio">
      <section className="studio-container">
        {/* Professional, Clean & Simple Studio Header Bar */}
        <header className="studio-header">
          <div className="studio-header-bar">
            <div className="studio-header-side studio-header-left">
              <button
                type="button"
                className="quiet studio-btn-back"
                disabled={busy}
                onClick={() => navigate("public")}
              >
                <SvgArrowLeft />
                <span>Back to card</span>
              </button>
            </div>

            <h1 className="studio-header-title">
              {mode === "signup" ? "Create your account" : claimToken ? "Set up your card" : "Edit profile"}
            </h1>

            <div className="studio-header-side studio-header-right">
              {token ? (
                <button
                  type="button"
                  className="quiet studio-btn-signout"
                  disabled={busy}
                  onClick={() => {
                    sessionStorage.removeItem("oneinfo.customer.token");
                    setToken("");
                    navigate("public");
                  }}
                >
                  Sign out
                </button>
              ) : (
                <span className="studio-header-spacer" aria-hidden="true" />
              )}
            </div>
          </div>
        </header>

        {/* Modern Segmented Navigation Tabs */}
        <div className="studio-mobile-tabs" role="tablist" aria-label="Editor Views">
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === "edit"}
            className={`studio-tab-pill ${studioTab === "edit" ? "is-active" : ""}`}
            onClick={() => {
              lastEditorTabRef.current = "edit";
              setStudioTab("edit");
            }}
          >
            <TabEditIcon />
            <span>Edit</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === "settings"}
            className={`studio-tab-pill ${studioTab === "settings" ? "is-active" : ""}`}
            onClick={() => {
              lastEditorTabRef.current = "settings";
              setStudioTab("settings");
            }}
          >
            <TabSettingsIcon />
            <span>Settings</span>
          </button>
          {mode === "details" && !claimToken && (
            <button
              type="button"
              role="tab"
              aria-selected={studioTab === "contacts"}
              className={`studio-tab-pill ${studioTab === "contacts" ? "is-active" : ""}`}
              onClick={() => {
                lastEditorTabRef.current = "contacts";
                setStudioTab("contacts");
              }}
            >
              <TabInboxIcon />
              <span>Contacts</span>
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="studio-tab-pill"
            onClick={() => {
              lastEditorTabRef.current = studioTab;
              setStudioTab("preview");
            }}
          >
            <TabPreviewIcon />
            <span>Preview</span>
          </button>
        </div>

        <div className={`studio-workspace-grid view-${studioTab}`}>
          <div className="studio-editor-column">
            {/* Tab: Edit Profile */}
            {studioTab === "edit" && (
              <form onSubmit={save} className="studio-form">
                {mode === "signup" && (
                  <fieldset className="studio-card">
                    <legend>Private account</legend>
                    <label>
                      Account email
                      <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
                    </label>
                    <label>
                      Password (at least 12 characters)
                      <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} />
                    </label>
                  </fieldset>
                )}

                <fieldset className="studio-card">
                  <legend>Public profile</legend>
                  <ProfilePhoto value={profile.avatarUrl} name={profile.displayName} token={token} claimToken={claimToken} onChange={url => update("avatarUrl", url)} onBusy={setPhotoBusy} />
                  <div className="studio-form-grid">
                    <label>
                      Full name
                      <input autoComplete="name" minLength={2} maxLength={120} required value={profile.displayName} onChange={event => update("displayName", event.target.value)} />
                    </label>
                    <label>
                      Headline / profession
                      <input maxLength={160} value={profile.headline} placeholder="e.g. Founder &amp; CEO" onChange={event => update("headline", event.target.value)} />
                    </label>
                    <label className="studio-col-span-2">
                      Company
                      <input maxLength={120} value={profile.company} placeholder="e.g. Arise Studio" onChange={event => update("company", event.target.value)} />
                    </label>
                    <label>
                      Public phone
                      <input type="tel" maxLength={40} value={profile.phone} placeholder="+880..." onChange={event => update("phone", event.target.value)} />
                    </label>
                    <label>
                      Public email
                      <input type="email" value={profile.email} placeholder="you@domain.com" onChange={event => update("email", event.target.value)} />
                    </label>
                    <label className="studio-col-span-2">
                      Website
                      <input type="url" maxLength={500} value={profile.website} placeholder="https://..." onChange={event => update("website", event.target.value)} />
                    </label>
                  </div>
                  <label className="studio-bio-label">
                    About you
                    <textarea maxLength={600} value={profile.bio} placeholder="Share a brief introduction for visitors who scan or tap your card..." onChange={event => update("bio", event.target.value)} />
                  </label>
                </fieldset>

                <fieldset className="studio-card studio-social-fieldset">
                  <legend>Social &amp; other links</legend>

                  <div className="studio-links-header">
                    <p className="studio-card-helper">Add your social channels, messaging apps, and website links:</p>
                    <span className="studio-links-counter">{profile.links.length} / 12 links</span>
                  </div>

                  {profile.links.length === 0 ? (
                    <div className="studio-links-empty">
                      <p>No links added yet. Click &quot;Add link&quot; below to add WhatsApp, Facebook, LinkedIn, YouTube, or your website.</p>
                    </div>
                  ) : (
                    profile.links.map((link, index) => {
                      const brand = detectSocialBrand(link.url, link.label);
                      const matchedPreset = PRESET_PLATFORMS.find(p => p.id === brand.kind) ?? PRESET_PLATFORMS[PRESET_PLATFORMS.length - 1];
                      return (
                        <div className="portal-link studio-link-item" key={index}>
                          <div className="studio-link-item-top">
                            <div className="studio-platform-picker">
                              <button
                                type="button"
                                className={`studio-platform-trigger is-${brand.kind}`}
                                onClick={() => setOpenPlatformIndex(openPlatformIndex === index ? null : index)}
                                aria-expanded={openPlatformIndex === index}
                              >
                                <span className="platform-trigger-badge">
                                  <SocialBrandIcon kind={brand.kind} />
                                </span>
                                <span className="platform-trigger-name">{matchedPreset?.label ?? "Select platform"}</span>
                                <span className={`platform-trigger-arrow ${openPlatformIndex === index ? "is-open" : ""}`}>
                                  <SvgChevronDown size={14} />
                                </span>
                              </button>

                              {openPlatformIndex === index && (
                                <div className="studio-platform-popover" role="listbox">
                                  <div className="platform-popover-header">
                                    <span>Select platform</span>
                                    <button
                                      type="button"
                                      className="platform-popover-close"
                                      onClick={() => setOpenPlatformIndex(null)}
                                      aria-label="Close"
                                    >
                                      <SvgCloseIcon size={12} />
                                    </button>
                                  </div>
                                  <div className="platform-popover-grid">
                                    {PRESET_PLATFORMS.map(p => {
                                      const isSelected = brand.kind === p.id;
                                      return (
                                        <button
                                          key={p.id}
                                          type="button"
                                          role="option"
                                          aria-selected={isSelected}
                                          className={`platform-popover-item is-${p.id} ${isSelected ? "is-selected" : ""}`}
                                          onClick={() => {
                                            handlePlatformChange(index, p.id);
                                            setOpenPlatformIndex(null);
                                          }}
                                        >
                                          <span className="popover-item-icon">
                                            <SocialBrandIcon kind={p.id} />
                                          </span>
                                          <span className="popover-item-label">{p.label}</span>
                                          {isSelected && (
                                            <span className="popover-item-check">
                                              <SvgCheckIcon size={12} />
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Native select preserved for accessibility and automated testing */}
                              <select
                                aria-label={`Link ${index + 1} platform`}
                                className="studio-platform-native-hidden"
                                value={brand.kind}
                                onChange={event => handlePlatformChange(index, event.target.value)}
                              >
                                {PRESET_PLATFORMS.map(p => (
                                  <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                              </select>
                            </div>

                            <button
                              type="button"
                              className="quiet studio-btn-remove"
                              onClick={() => {
                                update("links", profile.links.filter((_, i) => i !== index));
                                if (openPlatformIndex === index) setOpenPlatformIndex(null);
                              }}
                              title="Remove link"
                            >
                              <SvgTrashIcon size={14} />
                              <span>Remove link</span>
                            </button>
                          </div>

                          <div className="studio-link-inputs-grid">
                            <label>
                              Label
                              <input
                                required
                                maxLength={40}
                                value={link.label}
                                placeholder={matchedPreset?.label ?? "Label"}
                                onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item))}
                              />
                            </label>
                            <label>
                              URL
                              <input
                                required
                                type="url"
                                maxLength={500}
                                value={link.url}
                                placeholder={matchedPreset?.placeholder ?? "https://..."}
                                onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, url: event.target.value } : item))}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <button
                    type="button"
                    className="quiet studio-btn-add"
                    disabled={profile.links.length >= 12}
                    onClick={() => {
                      if (profile.links.length >= 12) return;
                      const nextIdx = profile.links.length;
                      update("links", [...profile.links, { label: "", url: "", sortOrder: nextIdx, active: true }]);
                      setOpenPlatformIndex(nextIdx);
                    }}
                  >
                    <SvgPlusIcon size={14} />
                    <span>Add link</span>
                  </button>
                </fieldset>

                <div className="studio-save-action">
                  <button className="studio-save-button" disabled={busy || photoBusy}>
                    {photoBusy ? "Uploading photo…" : busy ? "Saving…" : mode === "signup" ? "Create account & save profile" : claimToken ? "Save & claim card" : "Save profile"}
                  </button>
                  <span className="studio-save-note">Save your changes to update the profile linked to your card.</span>
                </div>
              </form>
            )}

            {/* Tab: Card Settings */}
            {studioTab === "settings" && (
              <div className="studio-settings-tab-view">
                <form onSubmit={save} className="studio-form">
                  <fieldset className="studio-card">
                    <legend>Card theme</legend>
                    <p className="studio-card-helper">Choose the color palette and atmosphere for your digital card:</p>
                    <div className="studio-theme-grid">
                      {(["MIDNIGHT", "IVORY", "MINT"] as const).map(themeName => (
                        <div
                          key={themeName}
                          className={`studio-theme-card theme-${themeName.toLowerCase()} ${profile.theme === themeName ? "is-selected" : ""}`}
                          onClick={() => update("theme", themeName)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") update("theme", themeName); }}
                        >
                          <div className="theme-card-preview-banner">
                            <span className="theme-card-preview-chip">ONEINFO</span>
                          </div>
                          <div className="theme-card-info">
                            <div className="theme-card-header">
                              <strong>{themeName === "MIDNIGHT" ? "Midnight" : themeName === "IVORY" ? "Ivory Luxe" : "Mint Emerald"}</strong>
                              {profile.theme === themeName && (
                                <span className="theme-card-check">
                                  <SvgCheckIcon size={14} />
                                </span>
                              )}
                            </div>
                            <span className="theme-card-desc">
                              {themeName === "MIDNIGHT"
                                ? "Dark obsidian with gold wireframe accents"
                                : themeName === "IVORY"
                                ? "Warm ivory background with crisp dark contrast"
                                : "Deep emerald green with refined metallic luster"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <select
                      className="studio-theme-select-accessible"
                      value={profile.theme}
                      aria-label="Theme"
                      onChange={event => update("theme", event.target.value as Draft["theme"])}
                    >
                      <option value="MIDNIGHT">Midnight</option>
                      <option value="IVORY">Ivory</option>
                      <option value="MINT">Mint</option>
                    </select>
                  </fieldset>

                  <fieldset className="studio-card">
                    <legend>Card mode</legend>
                    <p className="studio-card-helper">Switch between business card, event badge, or portfolio presentation:</p>
                    <div className="studio-mode-pills">
                      {(["BUSINESS", "EVENT", "PORTFOLIO"] as const).map(m => (
                        <button
                          key={m}
                          type="button"
                          className={`studio-mode-pill ${profile.profileMode === m ? "is-active" : ""}`}
                          onClick={() => update("profileMode", m)}
                        >
                          <span>{m === "BUSINESS" ? "Business Profile" : m === "EVENT" ? "Event Badge" : "Portfolio Mode"}</span>
                          {profile.profileMode === m && <SvgCheckIcon size={12} />}
                        </button>
                      ))}
                    </div>
                    {(["EVENT", "PORTFOLIO"] as const).map(m => (
                      <div key={m} className="portal-link studio-mode-content-box" hidden={profile.profileMode !== m}>
                        <label>
                          {m === "EVENT" ? "Event name" : "Portfolio title"}
                          <input
                            maxLength={120}
                            value={profile.modeContent[m]?.title ?? ""}
                            placeholder={m === "EVENT" ? "e.g. Design Summit 2026" : "e.g. Featured Creative Projects"}
                            onChange={event => update("modeContent", { ...profile.modeContent, [m]: { description: profile.modeContent[m]?.description ?? "", title: event.target.value } })}
                          />
                        </label>
                        <label>
                          Description
                          <textarea
                            maxLength={600}
                            value={profile.modeContent[m]?.description ?? ""}
                            placeholder={m === "EVENT" ? "Event details or badge notes..." : "Summary of services or showcase..."}
                            onChange={event => update("modeContent", { ...profile.modeContent, [m]: { title: profile.modeContent[m]?.title ?? "", description: event.target.value } })}
                          />
                        </label>
                      </div>
                    ))}
                  </fieldset>

                  <div className="studio-save-action">
                    <button className="studio-save-button" disabled={busy || photoBusy}>
                      {busy ? "Saving…" : "Save card settings"}
                    </button>
                    <span className="studio-save-note">Theme and card mode will update instantly.</span>
                  </div>
                </form>

                {token && (
                  <div className="studio-card studio-security-card">
                    <h3 className="studio-card-title">Account Security</h3>
                    <p className="studio-card-helper">Manage your email verification and password:</p>
                    <AccountSettings token={token} onSignOut={() => { sessionStorage.removeItem("oneinfo.customer.token"); setToken(""); navigate("login"); }} />
                  </div>
                )}

                <div className="studio-card studio-company-card">
                  <h3 className="studio-card-title">Company Workspace</h3>
                  <p className="studio-card-helper">Manage team cards and employee directory in the organization console:</p>
                  <p className="studio-company-link">
                    <a href="/team?manage=1">
                      <span>Open Company Workspace</span> <SvgExternalLink size={12} />
                    </a>
                  </p>
                </div>
              </div>
            )}

            {/* Tab: Shared Contacts */}
            {studioTab === "contacts" && (
              <div className="studio-contacts-tab-view">
                <div className="studio-side-panel">
                  <LeadInbox key={token} token={token} />
                </div>
                <div className="studio-side-panel">
                  <ProfileAnalytics token={token} base={base} />
                </div>
              </div>
            )}

            {mode === "signup" && (
              <button className="quiet studio-switch-btn" disabled={busy} onClick={() => navigate("login")}>
                Already have an account? Sign in
              </button>
            )}
            {error && <p className="portal-error" role="alert">{error}</p>}
          </div>

          <aside className="studio-sidebar-column">
            {/* Authentic Live Card Preview */}
            <div className="studio-sticky-preview">
              <div className="studio-preview-header">
                <span className="studio-card-tag">LIVE CARD PREVIEW</span>
                <span className="studio-theme-indicator">{profile.theme}</span>
              </div>

              <div className="studio-card-preview-wrap">
                <ProfileView
                  data={livePreviewData}
                  contactAction={
                    <ShareContact
                      key={`${slug}-preview-sidebar`}
                      crmEnabled={true}
                      send={async () => {
                        await new Promise((r) => setTimeout(r, 600));
                      }}
                    />
                  }
                />
              </div>

              <p className="studio-preview-caption">Updates in real-time as you type. Save your changes to share them with visitors.</p>
            </div>

            <small className="profile-footer">Powered by AriseStudio</small>
          </aside>
        </div>

        {/* Floating Mobile Dock */}
        <div className="studio-mobile-dock">
          <button
            type="button"
            className="studio-dock-btn studio-dock-toggle"
            onClick={() => {
              lastEditorTabRef.current = studioTab as "edit" | "settings" | "contacts";
              setStudioTab("preview");
            }}
          >
            <TabPreviewIcon />
            <span>Preview Card</span>
          </button>
          <button
            type="button"
            className="studio-dock-btn studio-dock-save"
            disabled={busy || photoBusy}
            onClick={executeSave}
          >
            <SvgCheckIcon size={16} />
            <span>{photoBusy ? "Uploading…" : busy ? "Saving…" : "Save profile"}</span>
          </button>
        </div>
      </section>
    </main>
  );
}

export function ProfileAnalytics({ token, base, companyId }: { token: string; base?: string; companyId?: string }) {
  const [items, setItems] = useState<{ mode: string; campaign: string; source: string; event: string; label: string | null; total: number }[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const visible = items?.filter(item => !source || item.source === source);
  async function load() {
    setBusy(true); setError("");
    try { setItems((await customerApi<{ items: NonNullable<typeof items> }>(`/me/activity${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`, "GET", undefined, token)).items); }
    catch { setError("Could not load analytics. Check your session and try again."); }
    finally { setBusy(false); }
  }
  return <section className="lead-inbox"><h2>Profile analytics</h2><p>Last 30 days. Contact saves count button clicks.</p>
    {base && <p><a href={`${base}?source=nfc`}>Tap link</a> · <a href={`${base}?source=qr`}>QR link</a></p>}
    <button type="button" className="quiet" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : items ? "Refresh analytics" : "Load analytics"}</button>
    {error && <p role="alert">{error}</p>}
    {!!items?.length && <label>Traffic source<select value={source} onChange={event => setSource(event.target.value)}>
      <option value="">All sources</option><option value="NFC">Tap</option><option value="QR">Scan</option><option value="DIRECT">Direct / untagged</option>
    </select></label>}
    {visible?.length === 0 && <p role="status">{source ? "No activity from this source." : "No activity recorded yet."}</p>}
    {!!visible?.length && <ul>{visible.map(item => <li key={JSON.stringify([item.mode, item.campaign, item.source, item.event])}>
      <strong>{item.label ?? ({ VIEW: "Profile views", SAVE: "Contact-save clicks", LINK: "Website clicks", LEAD: "Leads" }[item.event] ?? item.event)} · {item.total}</strong>
      <span>{item.campaign || item.mode} · {item.source === "NFC" ? "Tap" : item.source === "QR" ? "Scan" : "Direct link"}</span>
    </li>)}</ul>}
  </section>;
}

export function LeadInbox({ token, companyId }: { token: string; companyId?: string }) {
  const [items, setItems] = useState<ContactLead[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const visible = items?.filter(lead => [lead.name, lead.email, lead.phone, lead.recipientName].some(value => value?.toLowerCase().includes(term)));

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
    {companyId && !!items?.length && <label>Search loaded contacts<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, phone or employee" /></label>}
    {!!items?.length && !visible?.length && <p role="status">No matching contacts in the loaded results.</p>}
    {!!visible?.length && <ul>{visible.map(lead => <li key={lead.id}>
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
