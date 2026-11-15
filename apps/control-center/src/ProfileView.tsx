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
      websiteLabel?: string | undefined;
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
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" className="link-fallback-globe">
          <circle cx="20" cy="20" r="19" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.8" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.12))" />
          <ellipse cx="20" cy="20" rx="8" ry="19" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.4" />
          <line x1="1" y1="20" x2="39" y2="20" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.4" />
          <path d="M4.5 12h31M4.5 28h31" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.2" strokeOpacity="0.75" />
        </svg>
      )}
    </div>
  );
}

export function SocialBrandIcon({ kind, url, label }: { kind: string; url?: string | undefined; label?: string | undefined }) {
  switch (kind) {
    case "whatsapp":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#25D366" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M20 7.5c-6.9 0-12.5 5.6-12.5 12.5 0 2.2.6 4.4 1.7 6.3L7.5 32.5l6.4-1.7c1.8 1 3.9 1.6 6.1 1.6 6.9 0 12.5-5.6 12.5-12.5S26.9 7.5 20 7.5zm7.3 17.7c-.3.9-1.5 1.6-2.4 1.7-.6.1-1.4.1-2.3-.2-.5-.2-1.3-.5-2.2-.9-3.9-1.7-6.4-5.6-6.6-5.9-.2-.3-1.6-2.1-1.6-4s1.1-2.9 1.4-3.3c.4-.4.8-.5 1.1-.5.3 0 .5 0 .7.01.2.01.5-.08.8.6.3.7 1.1 2.7 1.2 2.9.1.2.1.4 0 .6-.1.2-.2.4-.4.6-.2.2-.4.4-.5.6-.2.2-.4.4-.2.8.2.4 1.1 1.8 2.3 2.9 1.6 1.4 3 1.9 3.4 2.1.4.2.7.2.9-.1.3-.3 1.1-1.3 1.4-1.7.3-.4.6-.3 1.1-.2.4.2 2.8 1.3 3.3 1.5.5.2.8.4 1 .6.1.2.1 1.4-.2 2.2z"
            fill="#ffffff"
          />
        </svg>
      );
    case "facebook":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#1877F2" />
          <path
            d="M22.5 35V20.8h4.7l.7-5.5h-5.4v-3.5c0-1.6.4-2.7 2.7-2.7h2.9V4.2c-.5-.1-2.2-.2-4.2-.2-4.2 0-7 2.6-7 7.2v4.1H12v5.5h4.7V35h5.8z"
            fill="#ffffff"
          />
        </svg>
      );
    case "instagram":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <defs>
            <radialGradient id="igIconGrad" cx="30%" cy="105%" r="120%">
              <stop offset="0%" stopColor="#fdf497" />
              <stop offset="10%" stopColor="#fdf497" />
              <stop offset="35%" stopColor="#fd5949" />
              <stop offset="60%" stopColor="#d6249f" />
              <stop offset="100%" stopColor="#285AEB" />
            </radialGradient>
          </defs>
          <rect width="40" height="40" rx="10" fill="url(#igIconGrad)" />
          <rect x="9.5" y="9.5" width="21" height="21" rx="6" stroke="#ffffff" strokeWidth="2.3" fill="none" />
          <circle cx="20" cy="20" r="5" stroke="#ffffff" strokeWidth="2.3" fill="none" />
          <circle cx="25.5" cy="14.5" r="1.3" fill="#ffffff" />
        </svg>
      );
    case "linkedin":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect width="40" height="40" rx="9" fill="#0A66C2" />
          <path
            d="M12.5 16.5h4.2V30h-4.2V16.5zm2.1-6.8c1.3 0 2.4 1.1 2.4 2.4s-1.1 2.4-2.4 2.4-2.4-1.1-2.4-2.4 1.1-2.4 2.4-2.4zm7 6.8h4v1.8h.1c.6-1.1 2-2.2 4.1-2.2 4.4 0 5.2 2.9 5.2 6.6V30h-4.2v-6.8c0-1.6 0-3.7-2.3-3.7s-2.6 1.8-2.6 3.6V30h-4.3V16.5z"
            fill="#ffffff"
          />
        </svg>
      );
    case "github":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#24292e" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M20 9c-6.1 0-11 4.9-11 11 0 4.9 3.2 9 7.6 10.4.6.1.8-.2.8-.5v-2c-3.1.7-3.7-1.3-3.7-1.3-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1.7 2.3 2.7 2.3.9 0 1.7-.2 2.2-.5.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.2-5.1-5.5 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.4.1-3 0 0 .9-.3 3.1 1.1.9-.2 1.9-.4 2.8-.4s1.9.1 2.8.4c2.1-1.4 3.1-1.1 3.1-1.1.6 1.5.2 2.7.1 3 .7.8 1.2 1.8 1.2 3 0 4.3-2.6 5.2-5.1 5.5.4.3.7 1 .7 2v3c0 .3.2.6.8.5 4.4-1.5 7.6-5.6 7.6-10.4 0-6.1-4.9-11-11-11z"
            fill="#ffffff"
          />
        </svg>
      );
    case "youtube":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect x="3" y="7" width="34" height="26" rx="8" fill="#FF0000" />
          <polygon points="16,14 27,20 16,26" fill="#ffffff" />
        </svg>
      );
    case "twitter":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#000000" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <path
            d="M25.7 12h2.5l-5.5 6.3 6.5 8.6h-5.1l-4-5.2-4.6 5.2h-2.5l5.9-6.8L17 12h5.2l3.6 4.8L25.7 12zm-.9 13.4h1.4L15.3 13.4h-1.5l11 12z"
            fill="#ffffff"
          />
        </svg>
      );
    case "telegram":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#2AABEE" />
          <path
            d="M28.3 11.7c.3-.1.6 0 .8.2.2.2.3.5.2.8l-3.2 15.1c-.1.5-.4.8-.8.9-.4.1-.9 0-1.2-.3l-4.5-3.3-2.2 2.1c-.3.3-.7.4-1.1.3-.4-.1-.7-.4-.7-.8v-3.8l8.8-8-10.9 6.8-4.5-1.4c-.5-.2-.8-.6-.8-1.1 0-.5.4-.9.9-1.1l19.1-7.3z"
            fill="#ffffff"
          />
        </svg>
      );
    case "tiktok":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#000000" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <path
            d="M25.5 15.2c-1.4-.4-2.5-1.5-2.8-2.9v-.3h-3.4v13.5c0 1.8-1.4 3.2-3.2 3.2s-3.2-1.4-3.2-3.2 1.4-3.2 3.2-3.2c.4 0 .7.1 1.1.2v-3.6c-.4 0-.7-.1-1.1-.1-3.7 0-6.7 3-6.7 6.7s3 6.7 6.7 6.7 6.7-3 6.7-6.7v-7.1c1.4 1 3.1 1.6 4.9 1.6v-3.5c-.8 0-1.5-.2-2.2-.6z"
            fill="#ffffff"
          />
        </svg>
      );
    case "map":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#EA4335" />
          <path
            d="M20 10c-3.9 0-7 3.1-7 7 0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"
            fill="#ffffff"
          />
        </svg>
      );
    case "music":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#1DB954" />
          <path
            d="M27.8 24.3c-.3.5-.9.7-1.4.4-3.9-2.4-8.8-2.9-14.6-1.6-.6.1-1.1-.2-1.2-.8-.1-.6.2-1.1.8-1.2 6.3-1.4 11.7-.8 16 1.8.5.3.7.9.4 1.4zm1.8-4c-.4.6-1.2.8-1.8.4-4.5-2.8-11.3-3.6-16.6-2-.7.2-1.4-.2-1.6-.9-.2-.7.2-1.4.9-1.6 6.1-1.8 13.6-.9 18.7 2.2.6.4.8 1.2.4 1.9zm.2-4.2C24.4 13.2 16.3 13 11.6 14.4c-.8.2-1.7-.2-1.9-1.1-.2-.8.2-1.7 1.1-1.9 5.4-1.6 14.3-1.4 20.3 2.2.7.4 1 1.4.5 2.1-.4.7-1.3.9-2 .4z"
            fill="#ffffff"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#006BFF" />
          <path
            d="M26.2 18.4c-.4-.4-1.1-.5-1.5-.1-.4.4-.5 1.1-.1 1.5 1.4 1.5 1.4 3.9 0 5.4-1.5 1.5-3.9 1.5-5.4 0-1.5-1.5-1.5-3.9 0-5.4.4-.4.4-1.1 0-1.5-.4-.4-1.1-.4-1.5 0-2.3 2.3-2.3 6 0 8.3 2.3 2.3 6 2.3 8.3 0 2.4-2.3 2.4-6 .2-8.2z"
            fill="#ffffff"
          />
          <circle cx="20" cy="12" r="1.5" fill="#ffffff" />
          <circle cx="20" cy="28" r="1.5" fill="#ffffff" />
        </svg>
      );
    case "design":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="#EA4C89" />
          <circle cx="20" cy="20" r="10.5" stroke="#ffffff" strokeWidth="1.8" fill="none" />
          <path
            d="M10 20c4.5-1 9.5-1 14-3.5M15 11c3.5 4 6.5 9 8 18M28 15c-3 3-7 5.5-14 6"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    case "portfolio":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.14))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.35))" strokeWidth="1.5" />
          <rect x="11.5" y="15.5" width="17" height="13" rx="2" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.8" fill="none" />
          <path d="M15.5 15.5V12.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M11.5 20.5h17" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.4" />
        </svg>
      );
    case "shop":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.14))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.35))" strokeWidth="1.5" />
          <path d="M13 14l-2 4v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V18l-2-4H13z" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
          <line x1="11" y1="18" x2="29" y2="18" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.5" />
          <path d="M16 21a4 4 0 0 0 8 0" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "document":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.14))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.35))" strokeWidth="1.5" />
          <path d="M14 11h8l6 6v12a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2z" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
          <polyline points="22 11 22 17 28 17" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
          <line x1="16" y1="22" x2="24" y2="22" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="16" y1="25" x2="21" y2="25" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.5" strokeLinecap="round" />
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
  const themeUpper = (profile.theme || "MIDNIGHT").toUpperCase();
  const wireColor = themeUpper === "MINT" ? "#10b981" : themeUpper === "IVORY" ? "#b48c48" : "#dfb877";
  const wireMidColor = themeUpper === "MINT" ? "#059669" : themeUpper === "IVORY" ? "#8c6a2e" : "#c99c4d";
  const wireId = `coverWire-${(profile.theme || "MIDNIGHT").toLowerCase()}`;
  const shineId = `coverShine-${(profile.theme || "MIDNIGHT").toLowerCase()}`;
  const websiteLabel = profile.modeContent?.websiteLabel?.trim() || "Official Website";

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
              <linearGradient id={wireId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={wireColor} stopOpacity="0.45" />
                <stop offset="50%" stopColor={wireMidColor} stopOpacity="0.25" />
                <stop offset="100%" stopColor={wireColor} stopOpacity="0.08" />
              </linearGradient>
              <radialGradient id={shineId} cx="80%" cy="15%" r="65%">
                <stop offset="0%" stopColor={wireColor} stopOpacity="0.22" />
                <stop offset="100%" stopColor="transparent" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${shineId})`} />
            {/* Elegant Signature Geometric Polygon Lines */}
            <polygon points="440,0 340,0 395,55" stroke={`url(#${wireId})`} strokeWidth="1.2" />
            <polygon points="340,0 265,32 395,55" stroke={`url(#${wireId})`} strokeWidth="1.1" />
            <polygon points="395,55 440,110 440,0" stroke={`url(#${wireId})`} strokeWidth="1.2" />
            <polygon points="265,32 300,95 395,55" stroke={`url(#${wireId})`} strokeWidth="1" />
            <polygon points="395,55 350,150 440,110" stroke={`url(#${wireId})`} strokeWidth="1" />
            <polygon points="300,95 350,150 395,55" stroke={`url(#${wireId})`} strokeWidth="0.9" />
            <polygon points="210,0 265,32 170,58" stroke={`url(#${wireId})`} strokeWidth="0.8" />
            <polygon points="0,150 85,150 38,92" stroke={`url(#${wireId})`} strokeWidth="0.9" />
            <polygon points="0,96 38,92 0,150" stroke={`url(#${wireId})`} strokeWidth="0.9" />
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
                  title={websiteLabel}
                  onClick={() => onActivity?.("LINK")}
                >
                  <div className="social-card-icon is-globe">
                    <SocialBrandIcon kind="globe" url={profile.website} label={websiteLabel} />
                  </div>
                  <div className="social-card-details">
                    <span className="social-card-name">{websiteLabel}</span>
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
      consent: fields.get("consent") === "on",
      crmAllowed: crmEnabled && fields.get("crmAllowed") === "on",
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

            <label className="share-contact-choice"><input type="checkbox" name="consent" required /><span>Share these details with the cardholder so they can follow up.</span></label>
            {crmEnabled && <label className="share-contact-choice"><input type="checkbox" name="crmAllowed" /><span>Also allow the cardholder to forward my details to their CRM.</span></label>}
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

export function ProfileSkeleton({
  error,
  onRetry,
}: {
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  if (error) {
    return (
      <div className="profile-page profile-loading-canvas">
        <main className="public-profile profile-skeleton-card is-error">
          <div className="profile-skeleton-brand">
            <img src={oneinfoLogo} alt="Oneinfo" className="profile-skeleton-logo" />
          </div>
          <div className="profile-error-content">
            <span className="profile-error-badge">PROFILE UNAVAILABLE</span>
            <h1 className="profile-error-heading">{error}</h1>
            <p className="profile-error-sub">This profile could not be loaded. Please check your link or try again.</p>
            <div className="profile-error-actions">
              {onRetry && (
                <button type="button" onClick={onRetry} className="profile-error-btn retry">
                  Try Again
                </button>
              )}
              <a href="/" className="profile-error-btn home">
                Oneinfo Home
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="profile-page profile-loading-canvas" aria-busy="true" aria-label="Loading Oneinfo Profile">
      <main className="public-profile profile-skeleton-card">
        {/* Cover Banner Skeleton */}
        <div className="profile-cover-banner profile-skeleton-cover">
          <div className="banner-top-bar">
            <div className="banner-logo-pill">
              <img src={oneinfoLogo} alt="Oneinfo" height={16} />
            </div>
          </div>
        </div>

        {/* Avatar Skeleton */}
        <div className="profile-avatar-container">
          <div className="profile-avatar-frame profile-skeleton-avatar profile-shimmer" />
        </div>

        {/* Identity Skeleton */}
        <div className="profile-identity-section profile-skeleton-identity">
          <div className="profile-skeleton-line name profile-shimmer" />
          <div className="profile-skeleton-line designation profile-shimmer" />
          <div className="profile-skeleton-line company profile-shimmer" />
        </div>

        {/* Quick Connect Row Skeleton (4 buttons) */}
        <div className="profile-quick-actions profile-skeleton-quick-actions">
          <div className="profile-skeleton-action-col">
            <div className="profile-skeleton-circle profile-shimmer" />
            <div className="profile-skeleton-text-line profile-shimmer" />
          </div>
          <div className="profile-skeleton-action-col">
            <div className="profile-skeleton-circle profile-shimmer" />
            <div className="profile-skeleton-text-line profile-shimmer" />
          </div>
          <div className="profile-skeleton-action-col">
            <div className="profile-skeleton-circle profile-shimmer" />
            <div className="profile-skeleton-text-line profile-shimmer" />
          </div>
          <div className="profile-skeleton-action-col">
            <div className="profile-skeleton-circle profile-shimmer" />
            <div className="profile-skeleton-text-line profile-shimmer" />
          </div>
        </div>

        {/* Primary CTA Row Skeleton */}
        <div className="profile-save-cta-wrapper profile-skeleton-cta-wrap">
          <div className="profile-skeleton-pill cta-main profile-shimmer" />
          <div className="profile-skeleton-pill cta-share profile-shimmer" />
        </div>

        {/* Body Cards Skeleton */}
        <div className="profile-skeleton-cards">
          <div className="profile-skeleton-block profile-shimmer" />
          <div className="profile-skeleton-block profile-shimmer" />
        </div>

        {/* Footer */}
        <footer className="profile-minimal-footer">
          <span className="footer-line profile-powered-by">
            <span>Powered by</span>
            <AriseStudioLogo height={12} />
          </span>
        </footer>
      </main>
    </div>
  );
}
