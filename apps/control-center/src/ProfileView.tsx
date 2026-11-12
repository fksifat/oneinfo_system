import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ShareContactSchema } from "@oneinfo/contracts";
import type { z } from "zod";
import oneinfoLogo from "../../../sites/storefront/assets/oneinfo-logo.svg";

export interface PublicProfileData {
  profile: {
    handle?: string | null;
    publicSlug: string;
    displayName: string;
    headline: string;
    company: string;
    bio: string;
    phone: string;
    email: string;
    website: string;
    avatarUrl: string;
    theme: string;
    profileMode?: "BUSINESS" | "EVENT" | "PORTFOLIO";
    modeContent?: {
      EVENT?: { title: string; description: string } | undefined;
      PORTFOLIO?: { title: string; description: string } | undefined;
    };
  };
  links: { id?: string; label: string; url: string }[];
}

// Minimal Luxury Icons
function CallIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24-1.45 0-2.87-.38-4.12-1.11l-.3-.17-3.12.82.83-3.04-.19-.31a8.2 8.2 0 0 1-1.26-4.42c0-4.54 3.7-8.25 8.24-8.25zm4.52 11.66c-.25.7-.72 1.28-1.37 1.63-.59.32-1.36.49-2.22.49-1.26 0-2.58-.45-3.88-1.33-1.63-1.11-2.94-2.67-3.79-4.5-.47-1.02-.71-2.06-.71-3.08 0-1.12.38-2.11 1.11-2.84.28-.28.61-.43.98-.43.23 0 .44.07.63.2.39.27.87 1.47.96 1.67.09.2.14.39.05.58-.09.19-.24.38-.41.56-.17.18-.31.32-.47.49-.16.17-.34.36-.15.69.44.76 1.09 1.54 1.87 2.22.8.7 1.72 1.24 2.56 1.57.34.13.54-.03.71-.23.2-.24.47-.63.66-.9.2-.28.4-.23.64-.14.24.09 1.54.73 1.8.86.26.13.43.2.49.31.06.11.06.65-.19 1.35z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function SaveContactIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <path d="M12 11v6m-3-3 3 3 3-3" />
    </svg>
  );
}

function SettingsGearIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function UserLoginIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function AriseStudioLogo({ height = 12 }: { height?: number }) {
  return (
    <svg
      aria-label="AriseStudio"
      height={height}
      viewBox="99 0 325 50"
      style={{ width: "auto", height, display: "inline-block", verticalAlign: "middle" }}
      fill="currentColor"
    >
      <path fillRule="evenodd" d="M126.84 0L140.22 0L108.29 48.95C107.77 49.72 107.27 49.65 106.76 48.76L100.64 39.2C99.49 37.48 99.49 35.38 100.64 33.85L122.05 3.63C123.46 1.21 125.05 0 126.84 0" />
      <path fillRule="evenodd" d="M143.09 2.87L162.97 33.08C163.86 34.61 163.93 36.2 163.16 37.86L156.28 48.38C155.26 49.91 154.24 49.91 153.22 48.38L133.34 17.4C132.95 16.77 132.95 16.13 133.34 15.49L141.56 3.06C142.07 2.3 142.58 2.23 143.09 2.87" />
      <path fillRule="evenodd" d="M127.41 31.74L141.56 31.74L132.19 46.09C130.66 48.38 128.55 49.52 125.88 49.52L110.96 49.52L120.52 35.19C122.05 32.89 124.35 31.74 127.41 31.74" />
      <path fillRule="evenodd" d="M175.87 42.54L189.08 10.03C189.59 8.85 190.43 8.25 191.62 8.25L196.19 8.25C197.38 8.25 198.22 8.85 198.73 10.03L211.43 42.54L204.32 42.54L201.02 33.65L186.29 33.65L182.73 42.54ZM188.82 27.81L198.73 27.81L193.9 15.37" />
      <path fillRule="evenodd" d="M212.95 42.54L212.95 27.56C212.95 20.78 216.34 17.4 223.11 17.4L227.68 17.4L227.68 22.73L223.36 22.73C220.48 22.73 219.05 24.43 219.05 27.81L219.05 42.54" />
      <path fillRule="evenodd" d="M230.22 8.25L235.3 8.25C235.64 8.25 235.81 8.43 235.81 8.76L235.81 13.84C235.81 14.18 235.64 14.35 235.3 14.35L230.22 14.35C229.88 14.35 229.71 14.18 229.71 13.84L229.71 8.76C229.71 8.43 229.88 8.25 230.22 8.25ZM229.71 17.4L234.79 17.4C235.47 17.4 235.81 17.74 235.81 18.41L235.81 42.54L229.71 42.54" />
      <path fillRule="evenodd" d="M245.46 17.4L259.93 17.4L259.93 22.48L245.97 22.48C244.44 22.48 243.68 23.16 243.68 24.51C243.68 25.69 244.61 26.54 246.48 27.05L253.84 29.08C257.9 30.1 259.93 32.38 259.93 35.94C259.93 40.34 257.65 42.54 253.08 42.54L237.84 42.54L237.84 37.46L252.32 37.46C253.5 37.46 254.09 36.87 254.09 35.68C254.09 34.67 253.33 33.99 251.81 33.65L244.7 31.62C240.13 30.43 237.84 28.15 237.84 24.76C237.84 19.85 240.38 17.4 245.46 17.4" />
      <path fillRule="evenodd" d="M270.6 17.4L276.44 17.4C281.86 17.4 284.57 20.19 284.57 25.78L284.57 30.35C284.57 31.71 283.89 32.38 282.54 32.38L269.08 32.38L269.08 28.57L271.87 28.57L272.89 27.56L278.48 27.56L278.48 25.78C278.48 23.58 277.38 22.48 275.17 22.48L271.62 22.48C269.25 22.48 268.06 23.75 268.06 26.29L268.06 33.91C268.06 36.28 269.33 37.46 271.87 37.46L284.57 37.46L284.57 42.54L270.6 42.54C264.84 42.54 261.97 39.75 261.97 34.16L261.97 26.03C261.97 20.28 264.84 17.4 270.6 17.4" />
      <path fillRule="evenodd" d="M314.29 8.25L297.02 8.25C290.07 8.25 286.6 11.56 286.6 18.16L286.6 19.43C286.6 23.66 289.06 26.46 293.97 27.81L304.13 30.61C307 31.28 308.44 32.64 308.44 34.67C308.44 36.7 307.17 37.72 304.63 37.72L293.97 37.72L292.7 38.73L286.6 38.73L286.6 42.54L304.38 42.54C311.32 42.54 314.79 39.66 314.79 33.91L314.79 32.89C314.79 28.66 312.51 25.95 307.93 24.76L297.27 21.97C294.22 21.12 292.7 19.77 292.7 17.91C292.7 15.53 294.14 14.35 297.02 14.35L308.19 14.35L309.46 13.08L314.29 13.08" />
      <path fillRule="evenodd" d="M321.9 10.03L328 10.03L328 17.4L333.33 17.4L333.33 22.48L328 22.48L328 33.4C328 36.11 329.27 37.46 331.81 37.46L333.33 37.46L333.33 42.54L329.52 42.54C324.44 42.54 321.9 39.92 321.9 34.67L321.9 22.48L316.82 22.48L316.82 17.4L321.9 17.4" />
      <path fillRule="evenodd" d="M335.36 17.4L341.46 17.4L341.46 33.4C341.46 36.11 342.73 37.46 345.27 37.46L349.08 37.46C351.62 37.46 352.89 36.11 352.89 33.4L352.89 17.4L358.98 17.4L358.98 34.16C358.98 39.75 356.11 42.54 350.35 42.54L344 42.54C338.24 42.54 335.36 39.75 335.36 34.16" />
      <path fillRule="evenodd" d="M380.82 8.25L386.92 8.25L386.92 34.16C386.92 39.75 384.04 42.54 378.29 42.54L369.65 42.54C363.89 42.54 361.02 39.75 361.02 34.16L361.02 26.03C361.02 20.28 363.89 17.4 369.65 17.4L380.82 17.4ZM370.66 22.48C368.29 22.48 367.11 23.83 367.11 26.54L367.11 33.4C367.11 36.11 368.46 37.46 371.17 37.46L377.02 37.46C379.55 37.46 380.82 36.11 380.82 33.4L380.82 23.75C380.82 22.9 380.4 22.48 379.55 22.48" />
      <path fillRule="evenodd" d="M389.96 8.25L395.05 8.25C395.38 8.25 395.55 8.43 395.55 8.76L395.55 13.84C395.55 14.18 395.38 14.35 395.05 14.35L389.96 14.35C389.63 14.35 389.46 14.18 389.46 13.84L389.46 8.76C389.46 8.43 389.63 8.25 389.96 8.25ZM389.46 17.4L394.54 17.4C395.21 17.4 395.55 17.74 395.55 18.41L395.55 42.54L389.46 42.54" />
      <path fillRule="evenodd" d="M406.73 17.4L414.6 17.4C420.36 17.4 423.23 20.28 423.23 26.03L423.23 33.91C423.23 39.66 420.36 42.54 414.6 42.54L406.73 42.54C400.97 42.54 398.09 39.66 398.09 33.91L398.09 26.03C398.09 20.28 400.97 17.4 406.73 17.4ZM408 22.48C405.46 22.48 404.19 23.83 404.19 26.54L404.19 33.4C404.19 36.11 405.46 37.46 408 37.46L413.33 37.46C415.87 37.46 417.14 36.11 417.14 33.4L417.14 26.54C417.14 23.83 415.87 22.48 413.33 22.48" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <line x1="9" y1="6" x2="9.01" y2="6" strokeWidth="2" />
      <line x1="15" y1="6" x2="15.01" y2="6" strokeWidth="2" />
      <line x1="9" y1="10" x2="9.01" y2="10" strokeWidth="2" />
      <line x1="15" y1="10" x2="15.01" y2="10" strokeWidth="2" />
      <line x1="9" y1="14" x2="9.01" y2="14" strokeWidth="2" />
      <line x1="15" y1="14" x2="15.01" y2="14" strokeWidth="2" />
      <path d="M10 22v-4h4v4" />
    </svg>
  );
}

function ContactExchangeIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  );
}

function SuccessCheckIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PortfolioBriefcaseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function DesignPaletteIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
    </svg>
  );
}

function ShoppingBagIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function CalendarScheduleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function WebsiteFavicon({ url, label }: { url?: string | undefined; label?: string | undefined }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  let domain = "";
  if (url) {
    try {
      domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    } catch {
      const parts = url.replace(/^[a-z]+:\/\//i, "").split("/");
      domain = (parts[0] ?? "").split("?")[0] ?? "";
    }
  }

  const isLocal = !domain || domain.includes("localhost") || domain.includes("127.0.0.1");
  const faviconUrl = !isLocal && domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : "";

  return (
    <div className="link-favicon-container">
      {faviconUrl && !failed && (
        <img
          src={faviconUrl}
          alt={label || domain || "Website"}
          className={`link-favicon-img ${loaded ? "is-loaded" : "is-loading"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      )}
      {(!loaded || failed || !faviconUrl) && (
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="link-fallback-globe">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      )}
    </div>
  );
}

export function SocialBrandIcon({ kind, url, label }: { kind: string; url?: string | undefined; label?: string | undefined }) {
  switch (kind) {
    case "linkedin":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.68 1.68 0 1 0 0-3.36 1.68 1.68 0 0 0 0 3.36m1.39 9.74v-8.37H5.07v8.37h2.78z" />
        </svg>
      );
    case "instagram":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" strokeWidth="2.5" />
        </svg>
      );
    case "twitter":
      return (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "github":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
      );
    case "facebook":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    case "youtube":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    case "telegram":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
    case "whatsapp":
      return <WhatsAppIcon />;
    case "map":
      return <MapPinIcon />;
    case "portfolio":
      return <PortfolioBriefcaseIcon />;
    case "design":
      return <DesignPaletteIcon />;
    case "shop":
      return <ShoppingBagIcon />;
    case "calendar":
      return <CalendarScheduleIcon />;
    case "document":
      return <DocumentIcon />;
    case "music":
      return <MusicNoteIcon />;
    case "tiktok":
      return (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
        </svg>
      );
    case "globe":
    default:
      return <WebsiteFavicon url={url} label={label} />;
  }
}

export function detectSocialBrand(url: string, label: string): { name: string; kind: string } {
  const target = `${url} ${label}`.toLowerCase();
  if (target.includes("whatsapp") || target.includes("wa.me")) return { name: label || "WhatsApp", kind: "whatsapp" };
  if (target.includes("maps.google") || target.includes("goo.gl/maps") || target.includes("maps.app.goo.gl") || target.includes("map") || target.includes("location") || target.includes("directions")) return { name: label || "Google Maps", kind: "map" };
  if (target.includes("facebook") || target.includes("fb.me") || target.includes("fb.com")) return { name: label || "Facebook", kind: "facebook" };
  if (target.includes("instagram") || target.includes("instagr.am")) return { name: label || "Instagram", kind: "instagram" };
  if (target.includes("youtube") || target.includes("youtu.be")) return { name: label || "YouTube", kind: "youtube" };
  if (target.includes("linkedin")) return { name: label || "LinkedIn", kind: "linkedin" };
  if (target.includes("tiktok") || target.includes("tiktok.com")) return { name: label || "TikTok", kind: "tiktok" };
  if (target.includes("twitter") || target.includes("x.com") || target.includes("t.co")) return { name: label || "X (Twitter)", kind: "twitter" };
  if (target.includes("github")) return { name: label || "GitHub", kind: "github" };
  if (target.includes("telegram") || target.includes("t.me")) return { name: label || "Telegram", kind: "telegram" };
  if (target.includes("portfolio") || target.includes("work") || target.includes("project") || target.includes("showcase")) return { name: label || "Portfolio", kind: "portfolio" };
  if (target.includes("behance") || target.includes("dribbble") || target.includes("figma") || target.includes("design") || target.includes("art")) return { name: label || "Design", kind: "design" };
  if (target.includes("shop") || target.includes("store") || target.includes("product") || target.includes("ecommerce") || target.includes("e-commerce") || target.includes("daraz") || target.includes("amazon") || target.includes("etsy")) return { name: label || "Store", kind: "shop" };
  if (target.includes("cal.com") || target.includes("calendly") || target.includes("calendar") || target.includes("meeting") || target.includes("schedule") || target.includes("book")) return { name: label || "Calendar", kind: "calendar" };
  if (target.includes("medium") || target.includes("substack") || target.includes("blog") || target.includes("article") || target.includes("news") || target.includes("resume") || target.includes("cv")) return { name: label || "Blog / Articles", kind: "document" };
  if (target.includes("spotify") || target.includes("soundcloud") || target.includes("music") || target.includes("podcast")) return { name: label || "Music", kind: "music" };
  return { name: label || "Website", kind: "globe" };
}

export function ProfileView({
  data,
  contactAction,
  onActivity,
  onManage,
  isOwnerLoggedIn,
}: {
  data: PublicProfileData;
  contactAction?: ReactNode;
  onActivity?: ((event: "SAVE" | "LINK", linkId?: string) => void) | undefined;
  onManage?: () => void;
  isOwnerLoggedIn?: boolean;
}) {
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const { profile, links } = data;

  useEffect(() => {
    setPhotoFailed(false);
  }, [profile.avatarUrl]);

  const apiBase = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";
  const contactPath = `${apiBase}/api/v1/profiles/public/${encodeURIComponent(profile.publicSlug)}/contact.vcf`;

  const profileUrl = profile.handle
    ? new URL(`/${profile.handle}`, window.location.origin).href
    : new URL(`?profile=${encodeURIComponent(profile.publicSlug)}`, window.location.origin).href;

  const mode = profile.profileMode ?? "BUSINESS";
  const content = mode === "BUSINESS" ? undefined : profile.modeContent?.[mode];
  const initials = profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "OI";

  // Clean phone for direct WhatsApp messaging
  const cleanPhone = profile.phone ? profile.phone.replace(/[^0-9]/g, "") : "";
  const waUrl = cleanPhone.length >= 8 ? `https://wa.me/${cleanPhone}` : null;

  // Resolve Map location link (custom map link, company location, or fallback)
  const mapLink = links.find(
    (l) =>
      detectSocialBrand(l.url, l.label).kind === "map" ||
      /maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|\/maps\//i.test(l.url)
  );
  const mapUrl = mapLink
    ? mapLink.url
    : profile.company
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.company)}`
    : (profile.displayName ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.displayName)}` : null);

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${profile.displayName} - Digital Contact Card`,
          text: `Connect with ${profile.displayName} on Oneinfo`,
          url: profileUrl,
        });
        return;
      } catch {
        // Fall back to clipboard if user cancels
      }
    }
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2400);
    } catch {
      setCopyFeedback(false);
    }
  }

  const themeClass = `theme-${(profile.theme || "MIDNIGHT").toLowerCase()}`;

  return (
    <div className={`profile-page ${themeClass}`}>
      <main className="public-profile">
        {/* Luxury Back Image / Cover Header with Geometric Card Motifs */}
        <div className="profile-cover-banner">
          <svg
            className="cover-geometric-pattern"
            viewBox="0 0 440 150"
            fill="none"
            preserveAspectRatio="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="coverGoldWire" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#dfb877" stopOpacity="0.45" />
                <stop offset="50%" stopColor="#c99c4d" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#dfb877" stopOpacity="0.08" />
              </linearGradient>
              <radialGradient id="coverShine" cx="80%" cy="15%" r="65%">
                <stop offset="0%" stopColor="#dfb877" stopOpacity="0.22" />
                <stop offset="100%" stopColor="transparent" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#coverShine)" />
            {/* Elegant Signature Geometric Polygon Lines */}
            <polygon points="440,0 340,0 395,55" stroke="url(#coverGoldWire)" strokeWidth="1.2" />
            <polygon points="340,0 265,32 395,55" stroke="url(#coverGoldWire)" strokeWidth="1.1" />
            <polygon points="395,55 440,110 440,0" stroke="url(#coverGoldWire)" strokeWidth="1.2" />
            <polygon points="265,32 300,95 395,55" stroke="url(#coverGoldWire)" strokeWidth="1" />
            <polygon points="395,55 350,150 440,110" stroke="url(#coverGoldWire)" strokeWidth="1" />
            <polygon points="300,95 350,150 395,55" stroke="url(#coverGoldWire)" strokeWidth="0.9" />
            <polygon points="210,0 265,32 170,58" stroke="url(#coverGoldWire)" strokeWidth="0.8" />
            <polygon points="0,150 85,150 38,92" stroke="url(#coverGoldWire)" strokeWidth="0.9" />
            <polygon points="0,96 38,92 0,150" stroke="url(#coverGoldWire)" strokeWidth="0.9" />
          </svg>

          {/* Discreet Top Bar on Banner: Brand watermark on left, minimal actions (QR & Settings/Login) on right */}
          <div className="banner-top-bar">
            <div className="banner-brand-watermark">
              <img src={oneinfoLogo} alt="Oneinfo" width="96" height="28" className="banner-logo" />
            </div>

            <div className="banner-top-actions">
              {onManage && (
                <button
                  type="button"
                  className={`banner-action-btn banner-settings-btn ${isOwnerLoggedIn ? "is-logged-in" : ""}`}
                  onClick={onManage}
                  title={isOwnerLoggedIn ? "Card Settings & Customization" : "Sign in / Customize card"}
                  aria-label="Manage this card"
                >
                  {isOwnerLoggedIn ? <SettingsGearIcon /> : <UserLoginIcon />}
                  <span className="sr-only">Manage this card</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Profile Avatar (Overlaps the Cover Banner seamlessly) */}
        <div className="profile-avatar-container">
          <div className="profile-avatar-box public-avatar">
            {profile.avatarUrl && !photoFailed ? (
              <img
                src={profile.avatarUrl}
                alt={`${profile.displayName} profile photo`}
                className="profile-photo-img"
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <span className="profile-monogram">{initials}</span>
            )}
          </div>
        </div>

        {/* Name, Designation & Organization */}
        <section className="profile-identity-section">
          <h1 className="profile-display-name">{profile.displayName}</h1>

          {profile.headline && <p className="profile-designation">{profile.headline}</p>}

          {profile.company && (
            <div className="profile-company-pill">
              <span className="company-icon" aria-hidden="true">
                <BuildingIcon />
              </span>
              <span>{profile.company}</span>
            </div>
          )}
        </section>

        {/* Quick Connect Row (Call, Email, WhatsApp, Map) */}
        <section className="profile-quick-actions" aria-label="Quick Connect Actions">
          {profile.phone && (
            <a href={`tel:${profile.phone}`} className="quick-action-btn" title="Call">
              <div className="action-icon action-call">
                <CallIcon />
              </div>
              <span className="action-text">Call</span>
            </a>
          )}

          {profile.email && (
            <a href={`mailto:${profile.email}`} className="quick-action-btn" title="Send Email">
              <div className="action-icon action-email">
                <EmailIcon />
              </div>
              <span className="action-text">Email</span>
            </a>
          )}

          {waUrl && (
            <a href={waUrl} target="_blank" rel="noreferrer" className="quick-action-btn" title="WhatsApp Message">
              <div className="action-icon action-wa">
                <WhatsAppIcon />
              </div>
              <span className="action-text">WhatsApp</span>
            </a>
          )}

          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="quick-action-btn" title="View Location on Map">
              <div className="action-icon action-map">
                <MapPinIcon />
              </div>
              <span className="action-text">Map</span>
            </a>
          )}
        </section>

        {/* Primary CTA Row: Save to Contacts (.vcf) + Share Button on the right */}
        <div className="profile-save-cta-wrapper">
          <a
            className="save-contact-cta"
            href={contactPath}
            onClick={() => onActivity?.("SAVE")}
            download="contact.vcf"
          >
            <div className="cta-icon">
              <SaveContactIcon />
            </div>
            <div className="cta-text">
              <span className="cta-primary">Save to Contacts</span>
              <span className="cta-secondary">Direct download to phone address book</span>
            </div>
          </a>

          <button
            type="button"
            className={`save-cta-share-btn ${copyFeedback ? "is-copied" : ""}`}
            onClick={handleShare}
            title={copyFeedback ? "Link Copied!" : "Share Profile"}
            aria-label={copyFeedback ? "Link Copied" : "Share Profile"}
          >
            <div className="share-btn-icon">
              <ShareIcon />
            </div>
            <span className="share-btn-text">{copyFeedback ? "Copied!" : "Share"}</span>
          </button>
        </div>

        {/* Detailed Professional Description / About Section */}
        {profile.bio && (
          <section className="profile-about-card">
            <h2 className="about-heading">ABOUT</h2>
            <p className="about-description">{profile.bio}</p>
          </section>
        )}

        {/* Mode Specific Content (Portfolio or Event) */}
        {content?.title && (
          <section className="profile-showcase-card">
            <h2 className="showcase-title">{content.title}</h2>
            {content.description && <p className="showcase-description">{content.description}</p>}
          </section>
        )}

        {/* Social Media & Links Section */}
        {(profile.website || links.length > 0) && (
          <section className="profile-social-section" aria-label="Social Media & Links">
            <h2 className="section-label">SOCIAL & WEB LINKS</h2>

            <div className="social-links-grid">
              {profile.website && (
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noreferrer"
                  className="social-card"
                  title="Official Website"
                  onClick={() => onActivity?.("LINK")}
                >
                  <div className="social-card-icon is-globe">
                    <SocialBrandIcon kind="globe" url={profile.website} label="Official Website" />
                  </div>
                  <div className="social-card-details">
                    <span className="social-card-name">Official Website</span>
                    <span className="social-card-url">{profile.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                  </div>
                  <div className="social-card-arrow" aria-hidden="true">
                    <ArrowUpRightIcon />
                  </div>
                </a>
              )}

              {links.map((link) => {
                const brand = detectSocialBrand(link.url, link.label);
                return (
                  <a
                    key={link.id ?? link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="social-card"
                    title={link.label || brand.name}
                    onClick={() => onActivity?.("LINK", link.id)}
                  >
                    <div className={`social-card-icon is-${brand.kind}`}>
                      <SocialBrandIcon kind={brand.kind} url={link.url} label={link.label} />
                    </div>
                    <div className="social-card-details">
                      <span className="social-card-name">{link.label}</span>
                      <span className="social-card-url">{link.url.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                    </div>
                    <div className="social-card-arrow" aria-hidden="true">
                      <ArrowUpRightIcon />
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* Lead Exchange (Send Contact Info) */}
        {contactAction && <div className="profile-contact-action-slot">{contactAction}</div>}

        {/* Clean, Understated Footer: Powered by AriseStudio */}
        <footer className="profile-minimal-footer">
          <a
            href="https://arisestudio.co"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-line profile-powered-by"
            aria-label="Powered by AriseStudio"
          >
            <span>Powered by</span>
            <AriseStudioLogo height={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}

export function ShareContact({
  send,
  crmEnabled,
}: {
  send: (input: z.infer<typeof ShareContactSchema>) => Promise<unknown>;
  crmEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ id: string; details: string }>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const result = ShareContactSchema.safeParse({
      ...Object.fromEntries(fields),
      consent: true,
      crmAllowed: Boolean(crmEnabled),
      requestId: crypto.randomUUID(),
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check your contact details.");
      return;
    }
    const { requestId, ...contact } = result.data;
    const details = JSON.stringify(contact);
    if (request.current?.details !== details) request.current = { id: requestId, details };
    setBusy(true);
    setError("");
    try {
      await send({ ...contact, requestId: request.current.id });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share your contact. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="share-contact share-contact-accordion" open>
      <summary className="share-contact-summary">
        <div className="summary-content">
          <span className="summary-icon">
            <ContactExchangeIcon />
          </span>
          <div>
            <strong>Exchange Contact Details</strong>
            <small>Send your contact information to this cardholder</small>
          </div>
        </div>
      </summary>

      <div className="share-contact-body">
        {sent ? (
          <div className="share-contact-success" role="status">
            <div className="success-icon">
              <SuccessCheckIcon />
            </div>
            <h4>Contact Details Shared!</h4>
            <p>Your details have been delivered to the cardholder&apos;s private inbox.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="share-contact-form">
            <div className="field-group">
              <label htmlFor="lead-name">Your Full Name *</label>
              <input
                id="lead-name"
                name="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Avery Morgan"
              />
            </div>

            <div className="field-group">
              <label htmlFor="lead-email">Email Address</label>
              <input
                id="lead-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                placeholder="name@example.com"
              />
            </div>

            <div className="field-group">
              <label htmlFor="lead-phone">Phone Number (Optional)</label>
              <input
                id="lead-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                maxLength={40}
                placeholder="+880 1..."
              />
            </div>

            <div className="field-group">
              <label htmlFor="lead-message">Short Note (Optional)</label>
              <textarea
                id="lead-message"
                name="message"
                rows={2}
                maxLength={600}
                placeholder="Where we met, project idea, etc."
              />
            </div>

            {error && <p className="form-error-alert share-contact-error" role="alert">{error}</p>}

            <button type="submit" className="submit-lead-btn share-contact-submit" disabled={busy}>
              {busy ? "Sending..." : "Send My Contact"}
            </button>
          </form>
        )}
      </div>
    </details>
  );
}
