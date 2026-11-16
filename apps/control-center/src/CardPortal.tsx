import { AccountSettings } from "./AccountAccess.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ActivateCardSchema, CustomerProfileSchema, HttpUrlSchema, PROFILE_BIO_MAX_LENGTH,
  PROFILE_ABOUT_HEADING_MAX_LENGTH, PROFILE_ABOUT_MAX_SECTIONS, type ContactLead,
} from "@oneinfo/contracts";
import { ProfileView, ProfileSkeleton, ShareContact, SocialBrandIcon, WhatsAppIcon, detectSocialBrand, type PublicProfileData } from "./ProfileView.js";
import { customerApi } from "./customer-api.js";
import type { z } from "zod";

import { ProfilePhoto } from "./ProfilePhoto.js";
import { CoverPhotoEditor } from "./CoverPhotoEditor.js";
import oneinfoLogo from "../../../sites/storefront/assets/oneinfo-logo.svg";

type Draft = z.infer<typeof CustomerProfileSchema>;
type CardResponse = { status: "PROFILE"; canShareContact?: boolean | undefined; crmEnabled?: boolean | undefined; profile: PublicProfileData["profile"]; links: PublicProfileData["links"] } |
  { status: "ACTIVATION_REQUIRED"; activationMethod?: "SECRET" | "INVOICE" } | { status: "UNAVAILABLE" };
const emptyProfile: Draft = { displayName: "", headline: "", company: "", bio: "", phone: "", email: "", website: "", avatarUrl: "", theme: "MIDNIGHT", links: [], profileMode: "BUSINESS", modeContent: {} };
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";
const isPreviewableLink = (link: Draft["links"][number]) =>
  Boolean(link.label.trim()) && HttpUrlSchema.safeParse(link.url.trim()).success;

const PRESET_PLATFORMS = [
  { id: "facebook", label: "Facebook", prefix: "https://facebook.com/", placeholder: "https://facebook.com/yourprofile" },
  { id: "instagram", label: "Instagram", prefix: "https://instagram.com/", placeholder: "https://instagram.com/yourusername" },
  { id: "linkedin", label: "LinkedIn", prefix: "https://linkedin.com/in/", placeholder: "https://linkedin.com/in/yourprofile" },
  { id: "youtube", label: "YouTube", prefix: "https://youtube.com/@", placeholder: "https://youtube.com/@yourchannel" },
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

const PROFILE_THEMES = [
  {
    id: "MIDNIGHT",
    name: "Midnight",
    subtitle: "Dark obsidian with gold wireframe accents",
  },
  {
    id: "IVORY",
    name: "Ivory Luxe",
    subtitle: "Warm pearl ivory with crisp dark contrast",
  },
  {
    id: "MINT",
    name: "Mint Emerald",
    subtitle: "Deep emerald green with radiant metallic luster",
  },
  {
    id: "SAPPHIRE",
    name: "Royal Sapphire",
    subtitle: "Deep corporate navy with luminous azure and platinum",
  },
  {
    id: "TITANIUM",
    name: "Titanium Noir",
    subtitle: "Sleek space graphite with brushed silver elegance",
  },
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

function SvgUserIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SvgTextIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function SvgGlobeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function SvgTagIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function SvgLinkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SvgPaletteIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
    </svg>
  );
}

function SvgLayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function SvgLockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SvgRefreshIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function SvgPhoneIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function SvgWhatsAppIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function SvgSearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function SvgBarChartIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}

function SvgEyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SvgSaveContactIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
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
  const [hasSavedWebsite, setHasSavedWebsite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const isMediaBusy = photoBusy || coverBusy;
  const [error, setError] = useState("");
  const aboutSections = profile.modeContent?.aboutSections ?? [];
  const websitePosition = Math.min(profile.modeContent?.websiteSortOrder ?? 0, profile.links.length);
  const linkPositions = profile.links.map((_, index) => index);
  if (profile.website.trim()) linkPositions.splice(websitePosition, 0, -1);
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

    // Check if the current URL matched an old preset prefix
    const oldMatchedPreset = PRESET_PLATFORMS.find(p => p.prefix && currentUrl.startsWith(p.prefix));
    let nextUrl: string = chosen.prefix;
    if (oldMatchedPreset && oldMatchedPreset.prefix && chosen.prefix !== "https://") {
      const suffix = currentUrl.slice(oldMatchedPreset.prefix.length).trim();
      nextUrl = suffix ? `${chosen.prefix}${suffix}` : chosen.prefix;
    } else if (!currentUrl || currentUrl === "https://") {
      nextUrl = chosen.prefix;
    }

    const isLabelDefault =
      !currentLink.label.trim() ||
      PRESET_PLATFORMS.some(p => p.label.toLowerCase() === currentLink.label.trim().toLowerCase() || p.id === currentLink.label.trim().toLowerCase()) ||
      currentLink.label.toLowerCase() === "whatsapp";

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
    setHasSavedWebsite(Boolean(owner.profile.website));
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
    if (isMediaBusy) return;
    void run(async () => {
      // Clean and sanitize links: strip empty/unfilled links so they don't break validation
      const sanitizedLinks = profile.links
        .map((link, i) => ({
          ...link,
          label: link.label.trim(),
          url: link.url.trim(),
          sortOrder: i,
          active: true,
        }))
        .filter(link => Boolean(link.label && link.url && /^https?:\/\//i.test(link.url)));

      const profileToSave = {
        ...profile,
        website: profile.website.trim(),
        modeContent: {
          ...profile.modeContent,
          websiteSortOrder: profile.website.trim() ? sanitizedLinks.filter(link => link.sortOrder < websitePosition).length : undefined,
        },
        links: sanitizedLinks,
      };

      const parsed = CustomerProfileSchema.safeParse(profileToSave);
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
  const updateAboutSections = (sections: typeof aboutSections) =>
    update("modeContent", { ...profile.modeContent, aboutSections: sections });
  const moveLink = (index: number, position: number) => {
    const positions = linkPositions.filter(item => item !== index);
    positions.splice(position, 0, index);
    const links = positions.map(item => profile.links[item]).filter(link => link !== undefined);
    const websiteSortOrder = positions.indexOf(-1);
    setProfile(previous => ({
      ...previous,
      links,
      modeContent: { ...previous.modeContent, websiteSortOrder: websiteSortOrder < 0 ? undefined : websiteSortOrder },
    }));
    setOpenPlatformIndex(null);
  };

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
      website: HttpUrlSchema.safeParse(profile.website.trim()).data ?? "",
      avatarUrl: profile.avatarUrl || "",
      theme: profile.theme,
      profileMode: profile.profileMode,
      modeContent: {
        ...profile.modeContent,
        websiteSortOrder: profile.links.slice(0, websitePosition).filter(isPreviewableLink).length,
      },
    },
    links: profile.links.filter(isPreviewableLink),
  };

  const isWaSameAsPhone =
    profile.modeContent?.whatsappSameAsPhone !== false &&
    (!profile.modeContent?.whatsapp || profile.modeContent?.whatsapp === profile.phone);

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
            disabled={busy || isMediaBusy}
            onClick={executeSave}
          >
            <SvgCheckIcon size={16} />
            <span>{isMediaBusy ? "Uploading…" : busy ? "Saving…" : "Save profile"}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="card-portal card-portal-studio customer-profile-studio">
      <section className="studio-container">
        {/* Professional, Clean & Simple Studio Header Bar */}
        <header className="studio-header">
          <div className="studio-header-bar">
            <div className="studio-header-side studio-header-left">
              <button
                type="button"
                className="quiet studio-btn-back"
                aria-label="Back to card"
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
              window.scrollTo(0, 0);
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
              window.scrollTo(0, 0);
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
                window.scrollTo(0, 0);
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
            className="studio-tab-pill studio-tab-preview-only"
            onClick={() => {
              lastEditorTabRef.current = studioTab;
              setStudioTab("preview");
              window.scrollTo(0, 0);
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
              <form onSubmit={save} className="studio-form studio-profile-form">
                {mode === "signup" && (
                  <fieldset className="studio-card">
                    <legend className="studio-card-legend">
                      <span className="studio-legend-icon"><SvgLockIcon size={14} /></span>
                      <span>Private account</span>
                    </legend>
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
                  <legend className="studio-card-legend">
                    <span className="studio-legend-icon"><SvgUserIcon size={14} /></span>
                    <span>Public profile</span>
                  </legend>
                  <div className="studio-visual-media-section">
                    <div className="studio-media-block">
                      <span className="studio-media-label">Cover photo</span>
                      <CoverPhotoEditor
                        value={profile.modeContent?.coverUrl ?? ""}
                        theme={profile.theme}
                        token={token}
                        claimToken={claimToken}
                        onChange={url => update("modeContent", { ...profile.modeContent, coverUrl: url })}
                        onBusy={setCoverBusy}
                      />
                    </div>

                    <div className="studio-media-block">
                      <span className="studio-media-label">Profile photo</span>
                      <ProfilePhoto value={profile.avatarUrl} name={profile.displayName} token={token} claimToken={claimToken} onChange={url => update("avatarUrl", url)} onBusy={setPhotoBusy} />
                    </div>
                  </div>
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
                  </div>
                </fieldset>

                <fieldset className="studio-card">
                  <legend className="studio-card-legend">
                    <span className="studio-legend-icon"><FormEmailIcon /></span>
                    <span>Contact details</span>
                  </legend>
                  <div className="studio-form-grid">
                    <label>
                      Public email
                      <input type="email" value={profile.email} placeholder="you@domain.com" onChange={event => update("email", event.target.value)} />
                    </label>

                    <label htmlFor="studio-field-phone">
                      Public phone
                      <input
                        id="studio-field-phone"
                        type="tel"
                        maxLength={40}
                        value={profile.phone}
                        placeholder="+880..."
                        onChange={event => update("phone", event.target.value)}
                      />
                    </label>

                    <div className="studio-field-group studio-whatsapp-field studio-col-span-2">
                      <div className="studio-field-label-row">
                        <label htmlFor="studio-whatsapp-field" className="studio-field-label-inline">
                          <WhatsAppIcon size={14} /> WhatsApp number
                        </label>
                        <label className="studio-inline-wa-toggle">
                          <span className="wa-text">Same as phone</span>
                          <span className="studio-switch">
                            <input
                              type="checkbox"
                              aria-label="Use public phone for WhatsApp"
                              checked={isWaSameAsPhone}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                update("modeContent", {
                                  ...profile.modeContent,
                                  whatsappSameAsPhone: checked,
                                  ...(checked ? { whatsapp: "" } : {}),
                                });
                              }}
                            />
                            <span className="studio-slider round" />
                          </span>
                        </label>
                      </div>
                      <input
                        id="studio-whatsapp-field"
                        type="tel"
                        maxLength={40}
                        value={isWaSameAsPhone ? profile.phone : (profile.modeContent?.whatsapp ?? "")}
                        placeholder={isWaSameAsPhone ? (profile.phone || "Same as public phone") : "+880 1..."}
                        disabled={isWaSameAsPhone}
                        className={isWaSameAsPhone ? "is-synced-disabled" : ""}
                        onChange={(e) =>
                          update("modeContent", {
                            ...profile.modeContent,
                            whatsapp: e.target.value,
                            whatsappSameAsPhone: false,
                          })
                        }
                      />
                    </div>

                    {/* Address / Google Maps Location Field */}
                    <label className="studio-col-span-2">
                      Address or map link
                      <input
                        maxLength={300}
                        value={profile.modeContent?.mapUrl ?? ""}
                        placeholder="Street address or Google Maps URL"
                        onChange={event => update("modeContent", { ...profile.modeContent, mapUrl: event.target.value })}
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="studio-card">
                  <legend className="studio-card-legend">
                    <span className="studio-legend-icon"><SvgTextIcon /></span>
                    <span>About</span>
                  </legend>
                  <p className="studio-card-helper">Share your background and add custom titled sections to highlight your career, research, or interests.</p>

                  <div className="studio-about-card-body">
                    <label className="studio-bio-label">
                      <span className="studio-bio-label-header">
                        <span className="studio-bio-title"><SvgUserIcon size={13} /> About you</span>
                        <span className="studio-char-limit">{profile.bio.length} / {PROFILE_BIO_MAX_LENGTH}</span>
                      </span>
                      <textarea maxLength={PROFILE_BIO_MAX_LENGTH} value={profile.bio} placeholder="Share a brief introduction for visitors who scan or tap your card..." onChange={event => update("bio", event.target.value)} />
                    </label>

                    {aboutSections.length > 0 && (
                      <div className="studio-about-sections-list">
                        {aboutSections.map((section, index) => (
                          <div className="studio-about-section" role="group" aria-label={`About section ${index + 1}`} key={index}>
                            <div className="studio-about-section-header">
                              <div className="studio-about-section-title">
                                <span className="studio-section-index-badge">#{index + 1}</span>
                                <span className="title-text">{section.heading.trim() || `Section ${index + 1}`}</span>
                              </div>
                              <button
                                type="button"
                                className="studio-btn-remove"
                                aria-label={`Remove section ${index + 1}`}
                                onClick={() => updateAboutSections(aboutSections.filter((_, position) => position !== index))}
                                title={`Remove section ${index + 1}`}
                              >
                                <SvgTrashIcon size={13} /> <span>Remove section</span>
                              </button>
                            </div>
                            <label className="studio-about-field">
                              <span className="studio-about-field-label">
                                <SvgTagIcon size={12} /> Heading (optional)
                              </span>
                              <input
                                maxLength={PROFILE_ABOUT_HEADING_MAX_LENGTH}
                                placeholder="e.g. Research interests, Experience, Education"
                                value={section.heading}
                                onChange={event => updateAboutSections(aboutSections.map((item, position) =>
                                  position === index ? { ...item, heading: event.target.value } : item))}
                              />
                            </label>
                            <label className="studio-about-field">
                              <span className="studio-about-field-label">
                                <SvgTextIcon /> Section text
                              </span>
                              <textarea
                                maxLength={PROFILE_BIO_MAX_LENGTH}
                                placeholder="Write your section content here..."
                                value={section.body}
                                onChange={event => updateAboutSections(aboutSections.map((item, position) =>
                                  position === index ? { ...item, body: event.target.value } : item))}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      className="studio-add-about-section"
                      disabled={aboutSections.length >= PROFILE_ABOUT_MAX_SECTIONS}
                      onClick={() => updateAboutSections([...aboutSections, { heading: "", body: "" }])}
                    >
                      <SvgPlusIcon size={14} /> Add section
                    </button>
                  </div>
                </fieldset>

                <fieldset className="studio-card studio-social-fieldset">
                  <legend className="studio-card-legend">
                    <span className="studio-legend-icon"><SvgGlobeIcon size={14} /></span>
                    <span>Social &amp; other links</span>
                  </legend>

                  <div className="studio-links-header">
                    <p className="studio-card-helper">Add your social channels, messaging apps, and website links:</p>
                    <span className="studio-links-counter">{profile.links.length} / 12 {hasSavedWebsite ? "additional links" : "links"}</span>
                  </div>

                  {linkPositions.length > 1 && (
                    <details className="studio-link-order">
                      <summary>Display order</summary>
                      <ol>
                        {linkPositions.map((index, position) => {
                          const label = index === -1
                            ? profile.modeContent?.websiteLabel?.trim() || "Official Website"
                            : profile.links[index]?.label.trim() || `Link ${index + 1}`;
                          return (
                            <li key={index}>
                              <span>{label}</span>
                              <select
                                aria-label={`Position of ${label}`}
                                value={position}
                                onChange={event => moveLink(index, Number(event.target.value))}
                              >
                                {linkPositions.map((_, slot) => <option key={slot} value={slot}>{slot + 1}</option>)}
                              </select>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  )}

                  {(hasSavedWebsite || profile.links.length > 0) && (
                    <div className="studio-links-table-header" aria-hidden="true">
                      <span className="col-platform"><SvgGlobeIcon size={11} /> Platform</span>
                      <span className="col-label"><SvgTagIcon size={11} /> Label</span>
                      <span className="col-url"><SvgLinkIcon size={11} /> URL</span>
                      <span className="col-action">Action</span>
                    </div>
                  )}

                  {hasSavedWebsite && (
                    <div className="studio-link-item" role="group" aria-label="Saved website">
                      <span className="studio-website-kind"><SvgGlobeIcon size={14} /> Website</span>
                      <div className="studio-link-field studio-link-label-col">
                        <span className="studio-mobile-field-tag" aria-hidden="true"><SvgTagIcon size={11} /> Label</span>
                        <input
                          aria-label="Website label"
                          placeholder="Official Website"
                          maxLength={40}
                          value={profile.modeContent?.websiteLabel ?? ""}
                          onChange={event => update("modeContent", { ...profile.modeContent, websiteLabel: event.target.value })}
                        />
                      </div>
                      <div className="studio-link-field studio-link-url-col">
                        <span className="studio-mobile-field-tag" aria-hidden="true"><SvgLinkIcon size={11} /> URL</span>
                        <input
                          aria-label="Website URL"
                          type="url"
                          placeholder="https://…"
                          maxLength={500}
                          value={profile.website}
                          onChange={event => update("website", event.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="quiet studio-btn-remove"
                        aria-label="Remove website"
                        title="Remove website"
                        disabled={!profile.website && !profile.modeContent?.websiteLabel}
                        onClick={() => setProfile(previous => ({
                          ...previous,
                          website: "",
                          modeContent: { ...previous.modeContent, websiteLabel: "" },
                        }))}
                      >
                        <SvgTrashIcon size={15} />
                      </button>
                    </div>
                  )}

                  {profile.links.length === 0 ? (
                    <div className="studio-links-empty">
                      <p>No links added yet. Click &quot;Add link&quot; below to add Facebook, Instagram, LinkedIn, YouTube, or your website.</p>
                    </div>
                  ) : (
                    <>
                      {profile.links.map((link, index) => {
                        const brand = detectSocialBrand(link.url, link.label);
                        const matchedPreset = PRESET_PLATFORMS.find(p => p.id === brand.kind) ?? PRESET_PLATFORMS[PRESET_PLATFORMS.length - 1];
                        return (
                          <div className="portal-link studio-link-item studio-link-single-row" key={index}>
                            {/* 1. Platform picker */}
                            <div className="studio-platform-picker">
                              <button
                                type="button"
                                className={`studio-platform-trigger is-${brand.kind}`}
                                onClick={() => setOpenPlatformIndex(openPlatformIndex === index ? null : index)}
                                aria-expanded={openPlatformIndex === index}
                                title="Select platform"
                              >
                                <span className="platform-trigger-badge">
                                  <SocialBrandIcon kind={brand.kind} size={22} />
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
                                            <SocialBrandIcon kind={p.id} size={20} />
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

                            {/* 2. Label input */}
                            <div className="studio-link-field studio-link-label-col">
                              <span className="studio-mobile-field-tag" aria-hidden="true">
                                <SvgTagIcon size={11} /> Label
                              </span>
                              <input
                                required
                                maxLength={40}
                                value={link.label}
                                aria-label={`Link ${index + 1} label`}
                                placeholder={matchedPreset?.label ?? "Label"}
                                onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item))}
                              />
                            </div>

                            {/* 3. URL input */}
                            <div className="studio-link-field studio-link-url-col">
                              <span className="studio-mobile-field-tag" aria-hidden="true">
                                <SvgLinkIcon size={11} /> URL
                              </span>
                              <input
                                required
                                type="url"
                                maxLength={500}
                                value={link.url}
                                aria-label={`Link ${index + 1} URL`}
                                placeholder={matchedPreset?.placeholder ?? "https://..."}
                                onChange={event => update("links", profile.links.map((item, i) => i === index ? { ...item, url: event.target.value } : item))}
                              />
                            </div>

                            {/* 4. Remove button */}
                            <button
                              type="button"
                              className="quiet studio-btn-remove"
                              onClick={() => {
                                setProfile(previous => ({
                                  ...previous,
                                  links: previous.links.filter((_, i) => i !== index),
                                  modeContent: {
                                    ...previous.modeContent,
                                    websiteSortOrder: index < websitePosition ? websitePosition - 1 : previous.modeContent?.websiteSortOrder,
                                  },
                                }));
                                setOpenPlatformIndex(null);
                              }}
                              title="Remove link"
                              aria-label={`Remove link ${index + 1}`}
                            >
                              <SvgTrashIcon size={15} />
                              <span className="sr-only">Remove link</span>
                            </button>
                          </div>
                        );
                      })}
                    </>
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
                  {error && <p className="studio-save-error" role="alert">{error}</p>}
                  <button type="submit" className="studio-save-button" disabled={busy || isMediaBusy}>
                    <SvgCheckIcon size={16} />
                    <span>{isMediaBusy ? "Uploading photo…" : busy ? "Saving…" : mode === "signup" ? "Create account & save profile" : claimToken ? "Save & claim card" : "Save profile"}</span>
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
                    <legend className="studio-card-legend">
                      <span className="studio-legend-icon"><SvgPaletteIcon size={14} /></span>
                      <span>Card theme</span>
                    </legend>
                    <p className="studio-card-helper">Choose the color palette and atmosphere for your digital card:</p>
                    <div className="studio-theme-grid">
                      {PROFILE_THEMES.map(theme => {
                        const isSelected = (profile.theme || "MIDNIGHT") === theme.id;
                        return (
                          <div
                            key={theme.id}
                            className={`studio-theme-card theme-card-${theme.id.toLowerCase()} ${isSelected ? "is-selected" : ""}`}
                            onClick={() => update("theme", theme.id as Draft["theme"])}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") update("theme", theme.id as Draft["theme"]); }}
                          >
                            <div className={`theme-card-preview-banner theme-banner-${theme.id.toLowerCase()}`}>
                              <span className="theme-card-preview-chip">ONEINFO</span>
                            </div>
                            <div className="theme-card-info">
                              <div className="theme-card-header">
                                <strong className="theme-card-title">{theme.name}</strong>
                                {isSelected ? (
                                  <span className="theme-card-check">
                                    <SvgCheckIcon size={13} />
                                  </span>
                                ) : (
                                  <span className="theme-card-check-placeholder" />
                                )}
                              </div>
                              <span className="theme-card-desc">{theme.subtitle}</span>
                            </div>
                          </div>
                        );
                      })}
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
                      <option value="SAPPHIRE">Royal Sapphire</option>
                      <option value="TITANIUM">Titanium Noir</option>
                    </select>
                  </fieldset>

                  <fieldset className="studio-card">
                    <legend className="studio-card-legend">
                      <span className="studio-legend-icon"><SvgLayersIcon size={14} /></span>
                      <span>Card mode</span>
                    </legend>
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
                    <button type="submit" className="studio-save-button" disabled={busy || isMediaBusy}>
                      <SvgCheckIcon size={16} />
                      <span>{busy ? "Saving…" : "Save card settings"}</span>
                    </button>
                    <span className="studio-save-note">Theme and card mode will update instantly.</span>
                  </div>
                </form>

                {token && (
                  <div className="studio-card studio-security-card">
                    <div className="studio-card-head-row">
                      <span className="studio-legend-icon"><SvgLockIcon size={14} /></span>
                      <div>
                        <h3 className="studio-card-title">Account Security</h3>
                        <p className="studio-card-helper">Manage your email verification and update your password.</p>
                      </div>
                    </div>
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
            {error && studioTab !== "edit" && <p className="portal-error" role="alert">{error}</p>}
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
            disabled={busy || isMediaBusy}
            onClick={executeSave}
          >
            <SvgCheckIcon size={16} />
            <span>{isMediaBusy ? "Uploading…" : busy ? "Saving…" : "Save profile"}</span>
          </button>
        </div>
      </section>
    </main>
  );
}

function formatLeadDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ProfileAnalytics({ token, base, companyId }: { token: string; base?: string; companyId?: string }) {
  const [items, setItems] = useState<{ mode: string; campaign: string; source: string; event: string; label: string | null; total: number }[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const visible = items?.filter(item => !source || item.source === source);

  async function load() {
    setBusy(true);
    setError("");
    try {
      setItems(
        (
          await customerApi<{ items: NonNullable<typeof items> }>(
            `/me/activity${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`,
            "GET",
            undefined,
            token
          )
        ).items
      );
    } catch {
      setError("Could not load analytics. Check your session and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lead-inbox profile-analytics-section" aria-labelledby="analytics-heading">
      <div className="lead-inbox-header-row">
        <div className="lead-inbox-title-wrap">
          <div className="studio-card-head-row">
            <span className="studio-legend-icon"><SvgBarChartIcon size={14} /></span>
            <div>
              <h2 id="analytics-heading" className="studio-card-title">Profile analytics</h2>
              <p className="studio-card-helper">Last 30 days. Contact saves count button clicks.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="lead-action-btn lead-btn-refresh"
          disabled={busy}
          onClick={() => void load()}
        >
          <SvgRefreshIcon size={13} />
          <span>{busy ? "Loading…" : items ? "Refresh analytics" : "Load analytics"}</span>
        </button>
      </div>

      {base && (
        <div className="analytics-quick-links-row">
          <a href={`${base}?source=nfc`} target="_blank" rel="noopener noreferrer" className="analytics-link-chip">
            <span className="analytics-chip-dot is-nfc" />
            <span>Tap link</span>
            <SvgExternalLink size={11} />
          </a>
          <a href={`${base}?source=qr`} target="_blank" rel="noopener noreferrer" className="analytics-link-chip">
            <span className="analytics-chip-dot is-qr" />
            <span>QR link</span>
            <SvgExternalLink size={11} />
          </a>
        </div>
      )}

      {error && <p className="portal-error" role="alert">{error}</p>}

      {/* Traffic source filter */}
      {!!items?.length && (
        <div className="analytics-filter-wrap">
          <label htmlFor="analytics-source-select" className="analytics-filter-label">
            Traffic source
          </label>
          <div className="analytics-select-box">
            <select
              id="analytics-source-select"
              value={source}
              onChange={event => setSource(event.target.value)}
            >
              <option value="">All sources</option>
              <option value="NFC">Tap</option>
              <option value="QR">Scan</option>
              <option value="DIRECT">Direct / untagged</option>
            </select>
            <span className="analytics-select-chevron">
              <SvgChevronDown size={14} />
            </span>
          </div>
        </div>
      )}

      {visible?.length === 0 && (
        <div className="lead-empty-state">
          <p className="lead-empty-title" role="status">
            {source ? "No activity from this source." : "No activity recorded yet."}
          </p>
          <p className="lead-empty-desc">
            When visitors tap your card or scan your QR code, engagement statistics will appear here.
          </p>
        </div>
      )}

      {!!visible?.length && (
        <div className="analytics-stat-grid">
          {visible.map(item => {
            const eventLabel =
              item.label ??
              ({ VIEW: "Profile views", SAVE: "Contact-save clicks", LINK: "Website clicks", LEAD: "Leads" }[item.event] ?? item.event);
            const sourceName = item.source === "NFC" ? "Tap" : item.source === "QR" ? "Scan" : "Direct link";
            const modeName = item.campaign || item.mode;

            return (
              <div
                key={JSON.stringify([item.mode, item.campaign, item.source, item.event])}
                className="analytics-stat-tile"
              >
                <div className="analytics-stat-top">
                  <span className="analytics-stat-tag">
                    <span className={`analytics-source-dot is-${item.source.toLowerCase()}`} />
                    {sourceName} · {modeName}
                  </span>
                  <span className="analytics-event-icon">
                    {item.event === "VIEW" ? (
                      <SvgEyeIcon size={14} />
                    ) : item.event === "SAVE" ? (
                      <SvgSaveContactIcon size={14} />
                    ) : item.event === "LEAD" ? (
                      <TabInboxIcon />
                    ) : (
                      <SvgLinkIcon size={13} />
                    )}
                  </span>
                </div>

                <div className="analytics-stat-number">{item.total.toLocaleString()}</div>
                <div className="analytics-stat-title">
                  <strong>{eventLabel} · {item.total}</strong>
                  <span className="sr-only">{modeName} · {sourceName}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
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
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (before) query.set("before", before);
      if (companyId) query.set("companyId", companyId);
      const page = await customerApi<{ items: ContactLead[]; nextCursor: string | null; crmEnabled?: boolean }>(
        `/me/contact-leads${query.size ? `?${query}` : ""}`,
        "GET",
        undefined,
        token
      );
      setItems(previous => (before ? [...(previous ?? []), ...page.items] : page.items));
      setNextCursor(page.nextCursor);
      setCrmEnabled(Boolean(page.crmEnabled));
    } catch (error) {
      setError(
        (error as { status?: number }).status === 401
          ? "Your session expired. Go back to your card and sign in again."
          : "Could not load your inbox. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function forward(lead: ContactLead) {
    if (loading || !confirm("Send this visitor’s shared contact details to the connected CRM?")) return;
    setLoading(true);
    setError("");
    try {
      const { forwardedAt } = await customerApi<{ forwardedAt: string }>(
        `/me/contact-leads/${lead.id}/crm`,
        "POST",
        undefined,
        token
      );
      setItems(previous => previous?.map(item => (item.id === lead.id ? { ...item, forwardedAt } : item)));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send to CRM.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="lead-inbox" aria-labelledby="lead-inbox-heading">
      <div className="lead-inbox-header-row">
        <div className="lead-inbox-title-wrap">
          <div className="studio-card-head-row">
            <span className="studio-legend-icon"><TabInboxIcon /></span>
            <div>
              <h2 id="lead-inbox-heading" className="studio-card-title">Shared contacts</h2>
              <p className="studio-card-helper">Contacts that visitors chose to share with you.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="lead-action-btn lead-btn-refresh"
          disabled={loading}
          onClick={() => void load()}
        >
          <SvgRefreshIcon size={13} />
          <span>{loading ? "Loading…" : items ? "Refresh inbox" : "Open inbox"}</span>
        </button>
      </div>

      {error && <p className="portal-error" role="alert">{error}</p>}

      {/* Search box if contacts exist */}
      {(companyId || (items && items.length > 3)) && (
        <div className="lead-search-bar">
          <span className="lead-search-icon"><SvgSearchIcon size={14} /></span>
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search contacts by name, email, phone or employee"
            aria-label="Search loaded contacts"
          />
        </div>
      )}

      {/* Empty states */}
      {items && items.length === 0 && (
        <div className="lead-empty-state">
          <span className="lead-empty-icon"><TabInboxIcon /></span>
          <p className="lead-empty-title" role="status">No contacts have been shared yet.</p>
          <p className="lead-empty-desc">When visitors tap &ldquo;Exchange Contact Details&rdquo; on your card, their submissions appear here.</p>
        </div>
      )}

      {items && items.length > 0 && !visible?.length && (
        <div className="lead-empty-state">
          <p className="lead-empty-title" role="status">No matching contacts in the loaded results.</p>
          <p className="lead-empty-desc">Try clearing or changing your search terms.</p>
        </div>
      )}

      {/* Contact cards list */}
      {!!visible?.length && (
        <div className="lead-cards-list">
          {visible.map(lead => (
            <div key={lead.id} className="lead-contact-card">
              <div className="lead-card-header">
                <div className="lead-contact-main">
                  <div className="lead-contact-avatar">
                    {(lead.name || "C").trim().charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <strong className="lead-contact-name">{lead.name}</strong>
                    {lead.recipientName && (
                      <small className="lead-recipient-pill">
                        Shared via {lead.recipientName}’s card
                      </small>
                    )}
                  </div>
                </div>
                <time className="lead-time-badge" dateTime={lead.createdAt}>
                  {formatLeadDate(lead.createdAt)}
                </time>
              </div>

              {/* Quick Connect action pills (Email, Phone, WhatsApp) */}
              <div className="lead-channels-row">
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="lead-channel-pill" title="Send email">
                    <FormEmailIcon />
                    <span>{lead.email}</span>
                  </a>
                )}
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="lead-channel-pill" title="Call phone">
                    <SvgPhoneIcon size={13} />
                    <span>{lead.phone}</span>
                  </a>
                )}
                {lead.phone && (
                  <a
                    href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lead-channel-pill lead-channel-whatsapp"
                    title="Chat on WhatsApp"
                  >
                    <SvgWhatsAppIcon size={13} />
                    <span>WhatsApp</span>
                  </a>
                )}
              </div>

              {/* Message / note if provided */}
              {lead.message && (
                <div className="lead-message-box">
                  <span className="lead-message-quote">&ldquo;</span>
                  <p>{lead.message}</p>
                </div>
              )}

              {/* CRM forwarding footer if enabled */}
              {(lead.forwardedAt || (crmEnabled && lead.crmAllowed)) && (
                <div className="lead-crm-footer">
                  {lead.forwardedAt ? (
                    <small className="lead-crm-forwarded">
                      <SvgCheckIcon size={12} /> Sent to CRM
                    </small>
                  ) : (
                    <button
                      className="lead-btn-crm"
                      type="button"
                      disabled={loading}
                      onClick={() => void forward(lead)}
                    >
                      Send to CRM
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          className="lead-btn-load-more"
          disabled={loading}
          onClick={() => void load(nextCursor)}
        >
          {loading ? "Loading…" : "Load older contacts"}
        </button>
      )}
    </section>
  );
}
