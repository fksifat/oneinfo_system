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
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 512 512" fill="currentColor">
      <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 512 512" fill="currentColor">
      <path d="M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48L48 64zM0 176L0 384c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-208L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z" />
    </svg>
  );
}

function WhatsAppIcon({ size = 23 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 448 512" fill="currentColor">
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6z" />
      <g transform="translate(224, 256) scale(1.25) translate(-224, -256)">
        <path d="M325.1 300.5c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z" />
      </g>
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

function AddressIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 384 512" fill="currentColor">
      <path d="M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z" />
    </svg>
  );
}

function MapPinIcon() {
  return <AddressIcon />;
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
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="10" r="3.2" />
      <path d="M7 17.5a5 5 0 0 1 10 0" />
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
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" className="link-fallback-globe">
          <circle cx="12" cy="12" r="11" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.12))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.3))" strokeWidth="1.2" />
          <g stroke="var(--profile-accent, #dfb877)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" transform="translate(4.8, 4.8) scale(0.6)">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </g>
        </svg>
      )}
    </div>
  );
}

export function SocialBrandIcon({ kind, url, label }: { kind: string; url?: string | undefined; label?: string | undefined }) {
  switch (kind) {
    case "whatsapp":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#25D366" />
          <path
            fill="#ffffff"
            d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"
            transform="translate(5.875, 5) scale(0.0273)"
          />
        </svg>
      );
    case "facebook":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#1877F2" />
          <path
            d="M13.65 19.5v-6.9h2.32l.35-2.7h-2.67V8.18c0-.78.22-1.31 1.34-1.31h1.43V4.46c-.25-.03-1.1-.11-2.09-.11-2.07 0-3.48 1.26-3.48 3.58v2.07H8.5v2.7h2.35v6.9h2.8z"
            fill="#ffffff"
          />
        </svg>
      );
    case "instagram":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <defs>
            <radialGradient id="igIconGrad" cx="20%" cy="100%" r="130%">
              <stop offset="0%" stopColor="#fdf497" />
              <stop offset="8%" stopColor="#fdf497" />
              <stop offset="35%" stopColor="#fd5949" />
              <stop offset="60%" stopColor="#d6249f" />
              <stop offset="100%" stopColor="#285AEB" />
            </radialGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#igIconGrad)" />
          <path
            d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"
            fill="#ffffff"
            transform="translate(4.56, 4.56) scale(0.62)"
          />
        </svg>
      );
    case "linkedin":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="5" fill="#0A66C2" />
          <path
            d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564z"
            fill="#ffffff"
          />
        </svg>
      );
    case "github":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#181717" />
          <path
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            fill="#ffffff"
            transform="translate(3.84, 3.84) scale(0.68)"
          />
        </svg>
      );
    case "youtube":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <path
            d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
            fill="#FF0000"
          />
          <polygon points="9.545,8.432 15.818,12 9.545,15.568" fill="#ffffff" />
        </svg>
      );
    case "twitter":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#000000" />
          <path
            d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
            fill="#ffffff"
            transform="translate(4.8, 4.8) scale(0.6)"
          />
        </svg>
      );
    case "telegram":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#2AABEE" />
          <path
            d="M18.8 6.5c.3-.1.6 0 .8.2.2.2.3.5.2.8l-2.4 11.3c-.1.4-.4.6-.7.7-.3.1-.7 0-.9-.2l-3.4-2.5-1.7 1.6c-.2.2-.5.3-.8.2-.3-.1-.5-.3-.5-.6v-2.9l6.6-6-8.2 5.1-3.4-1.1c-.4-.1-.6-.5-.6-.9 0-.4.3-.7.7-.8l14.4-5.8z"
            fill="#ffffff"
          />
        </svg>
      );
    case "tiktok":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#000000" />
          <path
            d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
            fill="#ffffff"
            transform="translate(4.8, 4.8) scale(0.6)"
          />
        </svg>
      );
    case "map":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#EA4335" />
          <path
            d="M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z"
            fill="#ffffff"
            transform="translate(7.125, 5.5) scale(0.0254)"
          />
        </svg>
      );
    case "music":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#1DB954" />
          <path
            d="M17.8 15.3c-.2.3-.6.4-1 .2-2.6-1.6-6-1.9-9.8-1.1-.4.1-.7-.2-.8-.5-.1-.4.2-.7.5-.8 4.2-.9 8-.6 10.9 1.2.3.2.4.6.2 1zm1.2-2.7c-.3.4-.8.5-1.2.3-3-1.9-7.6-2.4-11.2-1.3-.5.1-.9-.1-1.1-.6-.1-.5.1-.9.6-1.1 4.1-1.2 9.2-.6 12.6 1.5.4.2.5.8.3 1.2zm.1-2.8C15.5 7.8 10.1 7.7 7 8.6c-.6.2-1.1-.1-1.3-.7-.2-.5.1-1.1.7-1.3 3.6-1.1 9.6-.9 13.6 1.5.5.3.7.9.3 1.4-.3.5-.9.7-1.3.3z"
            fill="#ffffff"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#006BFF" />
          <path
            d="M16 11c-.3-.3-.7-.3-1 0s-.3.7 0 1c.9 1 .9 2.6 0 3.6-1 1-2.6 1-3.6 0-1-1-1-2.6 0-3.6.3-.3.3-.7 0-1-.3-.3-.7-.3-1 0-1.5 1.5-1.5 4 0 5.5 1.5 1.5 4 1.5 5.5 0 1.6-1.5 1.6-4-.1-5.5z"
            fill="#ffffff"
          />
          <circle cx="12" cy="7.5" r="1" fill="#ffffff" />
          <circle cx="12" cy="17.5" r="1" fill="#ffffff" />
        </svg>
      );
    case "design":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#EA4C89" />
          <circle cx="12" cy="12" r="7" stroke="#ffffff" strokeWidth="1.3" fill="none" />
          <path
            d="M5 12c3-.7 6.5-.7 9.5-2.5M8.5 6c2.4 2.7 4.4 6 5.5 12M17.5 8.5c-2 2-4.7 3.7-9.5 4"
            stroke="#ffffff"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    case "portfolio":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.14))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.35))" strokeWidth="1.2" />
          <rect x="7" y="9.5" width="10" height="8" rx="1.5" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.3" fill="none" />
          <path d="M9.5 9.5V7.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v2" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 12.5h10" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.1" />
        </svg>
      );
    case "shop":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.14))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.35))" strokeWidth="1.2" />
          <path d="M7.5 9l-1.5 3v6a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V12l-1.5-3H7.5z" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
          <line x1="6" y1="12" x2="18" y2="12" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.1" />
          <path d="M9.5 14a2.5 2.5 0 0 0 5 0" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "document":
      return (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="var(--profile-accent-bg-subtle, rgba(223, 184, 119, 0.14))" stroke="var(--profile-accent-border, rgba(223, 184, 119, 0.35))" strokeWidth="1.2" />
          <path d="M8.5 6.5h4.5l3.5 3.5v7.5a1.5 1.5 0 0 1-1.5 1.5H8.5a1.5 1.5 0 0 1-1.5-1.5v-9.5a1.5 1.5 0 0 1 1.5-1.5z" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
          <polyline points="13 6.5 13 10 16.5 10" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
          <line x1="9.5" y1="13" x2="14.5" y2="13" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.1" strokeLinecap="round" />
          <line x1="9.5" y1="15.5" x2="13" y2="15.5" stroke="var(--profile-accent, #dfb877)" strokeWidth="1.1" strokeLinecap="round" />
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
            <a href={mapUrl} target="_blank" rel="noreferrer" className="quick-action-btn" title="View Address on Map">
              <div className="action-icon action-map action-address">
                <AddressIcon />
              </div>
              <span className="action-text">Address</span>
            </a>
          )}
        </section>

        {/* Primary CTA Row: Save Contact (.vcf) + Sleek Share Icon Button on the right */}
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
            <span className="cta-primary">Save Contact</span>
          </a>

          <button
            type="button"
            className={`save-cta-share-btn ${copyFeedback ? "is-copied" : ""}`}
            onClick={handleShare}
            title={copyFeedback ? "Link Copied!" : "Share Profile"}
            aria-label={copyFeedback ? "Link Copied" : "Share Profile"}
          >
            <div className="share-btn-icon">
              {copyFeedback ? <SuccessCheckIcon /> : <ShareIcon />}
            </div>
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
        {((profile.website && detectSocialBrand(profile.website, websiteLabel).kind !== "whatsapp") ||
          links.some((l) => detectSocialBrand(l.url, l.label).kind !== "whatsapp")) && (
          <section className="profile-social-section" aria-label="Social Media & Links">
            <h2 className="section-label">SOCIAL & WEB LINKS</h2>

            <div className="social-links-grid">
              {profile.website && detectSocialBrand(profile.website, websiteLabel).kind !== "whatsapp" && (
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

              {links
                .filter((link) => detectSocialBrand(link.url, link.label).kind !== "whatsapp")
                .map((link) => {
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
      crmAllowed: crmEnabled,
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
          <strong className="summary-title">Exchange Contact Details</strong>
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
