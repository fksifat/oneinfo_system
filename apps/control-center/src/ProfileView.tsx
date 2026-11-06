import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ShareContactSchema } from "@oneinfo/contracts";
import type { z } from "zod";
import oneinfoLogo from "../../../sites/storefront/assets/oneinfo-logo.svg";

export interface PublicProfileData {
  profile: { publicSlug: string; displayName: string; headline: string; company: string; bio: string; phone: string; email: string;
    website: string; avatarUrl: string; theme: string; profileMode?: "BUSINESS" | "EVENT" | "PORTFOLIO";
    modeContent?: Partial<Record<"EVENT" | "PORTFOLIO", { title: string; description: string }>> };
  links: { id?: string; label: string; url: string }[];
}

function ContactIcon({ kind }: { kind: "call" | "email" | "link" | "save" }) {
  const paths = { call: "M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L9.05 10.9a16 16 0 0 0 4.05 4.05l1.28-1.27a2 2 0 0 1 2.11-.45c.89.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92Z", email: "m3 5 9 7 9-7M3 5h18v14H3Z", link: "M10 13a5 5 0 0 0 7 .3l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.3l-3 3a5 5 0 0 0 7 7l2-2", save: "M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

export function ProfileView({ data, contactAction, onActivity }: { data: PublicProfileData; contactAction?: ReactNode;
  onActivity?: ((event: "SAVE" | "LINK", linkId?: string) => void) | undefined }) {
  const [copyMessage, setCopyMessage] = useState("Copy link");
  const [photoFailed, setPhotoFailed] = useState(false);
  const { profile, links } = data;
  useEffect(() => { setPhotoFailed(false); }, [profile.avatarUrl]);
  const android = /Android/i.test(globalThis.navigator?.userAgent ?? "");
  const contactPath = `${import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001"}/api/v1/profiles/public/${encodeURIComponent(profile.publicSlug)}/contact.vcf`;
  const contactFields = new URLSearchParams({ name: profile.displayName, phone: profile.phone, email: profile.email, company: profile.company, title: profile.headline, website: profile.website });
  const saveContactInApp = android ? `intent://save?${contactFields}#Intent;scheme=oneinfo-contact;package=com.oneinfo.nfcbridge;S.browser_fallback_url=${encodeURIComponent(new URL("#contacts-app-required", window.location.href).href)};end` : null;
  const mode = profile.profileMode ?? "BUSINESS";
  const content = mode === "BUSINESS" ? undefined : profile.modeContent?.[mode];
  const initials = profile.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return <div className={`profile-page theme-${profile.theme.toLowerCase()}`}><main className="public-profile">
    <div className="profile-brand"><img src={oneinfoLogo} alt="Oneinfo" width="94" height="28" /><small>Digital contact card</small></div>
    <div className="public-avatar">{profile.avatarUrl && !photoFailed ? <img src={profile.avatarUrl} alt={`${profile.displayName} profile photo`} onError={() => setPhotoFailed(true)} /> : initials}</div>
    <p className="profile-kicker">{mode === "EVENT" ? "EVENT PROFILE" : mode === "PORTFOLIO" ? "PORTFOLIO" : "DIGITAL BUSINESS PROFILE"}</p><h1>{profile.displayName}</h1>
    <p className="public-headline">{profile.headline}{profile.company ? ` · ${profile.company}` : ""}</p>
    {profile.bio && <p className="public-bio">{profile.bio}</p>}
    {content?.title && <h2>{content.title}</h2>}
    {content?.description && <p className="public-bio">{content.description}</p>}
    <div className="contact-actions">
      {profile.phone && <a href={`tel:${profile.phone}`}><ContactIcon kind="call" />Call</a>}{profile.email && <a href={`mailto:${profile.email}`}><ContactIcon kind="email" />Email</a>}
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopyMessage("Copied"); } catch { setCopyMessage("Copy unavailable"); } }}><ContactIcon kind="link" />{copyMessage}</button>
    </div>
    <div className="public-links">
      {profile.website && <a href={profile.website} target="_blank" rel="noreferrer" onClick={() => onActivity?.("LINK")}><span>Website</span><b>↗</b></a>}
      {links.map(link => <a key={link.id ?? link.url} href={link.url} target="_blank" rel="noreferrer" onClick={() => onActivity?.("LINK", link.id)}><span>{link.label}</span><b>↗</b></a>)}
    </div>
    <a className="save-contact" href={contactPath} onClick={() => onActivity?.("SAVE")}><ContactIcon kind="save" />Save to Contacts</a>
    {saveContactInApp && <details className="share-contact">
      <summary>Already have the Oneinfo app?</summary>
      <a href={saveContactInApp} onClick={() => onActivity?.("SAVE")}>Open Contacts using Oneinfo</a>
    </details>}
    {saveContactInApp && <p id="contacts-app-required" className="contacts-app-required" role="status">The Oneinfo app could not open. Use Save to Contacts above.</p>}
    {contactAction}
    <small className="profile-footer">Powered by Arise Studio</small>
  </main></div>;
}

export function ShareContact({ send, crmEnabled }: { send: (input: z.infer<typeof ShareContactSchema>) => Promise<unknown>; crmEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ id: string; details: string }>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const result = ShareContactSchema.safeParse({ ...Object.fromEntries(fields), consent: fields.has("consent"), crmAllowed: fields.has("crmAllowed"),
      requestId: crypto.randomUUID() });
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check your contact details."); return; }
    const { requestId, ...contact } = result.data;
    const details = JSON.stringify(contact);
    if (request.current?.details !== details) request.current = { id: requestId, details };
    setBusy(true); setError("");
    try { await send({ ...contact, requestId: request.current.id }); setSent(true); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not share your contact. Please try again."); }
    finally { setBusy(false); }
  }

  return <details className="share-contact">
    <summary>Share my contact</summary>
    {sent ? <p role="status">Contact shared. Your details are saved in the card owner’s private inbox.</p> : <form onSubmit={submit}>
      <p>Your details will appear in the card owner’s private inbox.</p>
      <label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={120} /></label>
      <p>Add your email or phone so the card owner can reply.</p>
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
      <label>Message (optional)<textarea name="message" rows={3} maxLength={600} /></label>
      <label className="share-consent"><input name="consent" type="checkbox" required /><span>Share these details with the card owner so they can follow up.</span></label>
      {crmEnabled && <label className="share-consent"><input name="crmAllowed" type="checkbox" /><span>Also allow the card owner to save these details in their CRM.</span></label>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send my contact"}</button>
    </form>}
  </details>;
}
