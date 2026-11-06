import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ShareContactSchema } from "@oneinfo/contracts";
import type { z } from "zod";

export interface PublicProfileData {
  profile: { publicSlug: string; displayName: string; headline: string; company: string; bio: string; phone: string; email: string;
    website: string; avatarUrl: string; theme: string; profileMode?: "BUSINESS" | "EVENT" | "PORTFOLIO";
    modeContent?: Partial<Record<"EVENT" | "PORTFOLIO", { title: string; description: string }>> };
  links: { id?: string; label: string; url: string }[];
}

export function ProfileView({ data, contactAction, onActivity }: { data: PublicProfileData; contactAction?: ReactNode;
  onActivity?: ((event: "SAVE" | "LINK", linkId?: string) => void) | undefined }) {
  const [copyMessage, setCopyMessage] = useState("Copy link");
  const [photoFailed, setPhotoFailed] = useState(false);
  const { profile, links } = data;
  const mode = profile.profileMode ?? "BUSINESS";
  const content = mode === "BUSINESS" ? undefined : profile.modeContent?.[mode];
  const initials = profile.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return <div className={`profile-page theme-${profile.theme.toLowerCase()}`}><main className="public-profile">
    <div className="profile-brand"><i></i> ONEINFO</div>
    <div className="public-avatar">{profile.avatarUrl && !photoFailed ? <img src={profile.avatarUrl} alt="" onError={() => setPhotoFailed(true)} /> : initials}</div>
    <p className="profile-kicker">{mode === "EVENT" ? "EVENT PROFILE" : mode === "PORTFOLIO" ? "PORTFOLIO" : "DIGITAL BUSINESS PROFILE"}</p><h1>{profile.displayName}</h1>
    <p className="public-headline">{profile.headline}{profile.company ? ` · ${profile.company}` : ""}</p>
    {profile.bio && <p className="public-bio">{profile.bio}</p>}
    {content?.title && <h2>{content.title}</h2>}
    {content?.description && <p className="public-bio">{content.description}</p>}
    <div className="contact-actions">
      {profile.phone && <a href={`tel:${profile.phone}`}>Call</a>}{profile.email && <a href={`mailto:${profile.email}`}>Email</a>}
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopyMessage("Copied"); } catch { setCopyMessage("Copy unavailable"); } }}>{copyMessage}</button>
    </div>
    <div className="public-links">
      {profile.website && <a href={profile.website} target="_blank" rel="noreferrer" onClick={() => onActivity?.("LINK")}><span>Website</span><b>↗</b></a>}
      {links.map(link => <a key={link.id ?? link.url} href={link.url} target="_blank" rel="noreferrer" onClick={() => onActivity?.("LINK", link.id)}><span>{link.label}</span><b>↗</b></a>)}
    </div>
    <a className="save-contact" href={`${import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001"}/api/v1/profiles/public/${encodeURIComponent(profile.publicSlug)}/contact.vcf`}
      onClick={() => onActivity?.("SAVE")}>Save to Contacts</a>
    {contactAction}
    <small className="profile-footer">Powered by Oneinfo · NFC + QR</small>
  </main></div>;
}

export function ShareContact({ send, crmEnabled }: { send: (input: z.infer<typeof ShareContactSchema>) => Promise<unknown>; crmEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const result = ShareContactSchema.safeParse({ ...Object.fromEntries(fields), consent: fields.has("consent"), crmAllowed: fields.has("crmAllowed"),
      requestId: requestId.current ??= crypto.randomUUID() });
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check your contact details."); return; }
    setBusy(true); setError("");
    try { await send(result.data); setSent(true); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not share your contact. Please try again."); }
    finally { setBusy(false); }
  }

  return <details className="share-contact">
    <summary>Share my contact</summary>
    {sent ? <p role="status">Your contact details were sent to the card owner.</p> : <form onSubmit={submit}>
      <label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={120} /></label>
      <p>Add your email or phone so the card owner can reply.</p>
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
      <label>Message (optional)<textarea name="message" rows={3} maxLength={600} /></label>
      <label className="share-consent"><input name="consent" type="checkbox" required /> Share these details with the card owner so they can follow up.</label>
      {crmEnabled && <label className="share-consent"><input name="crmAllowed" type="checkbox" /> Also allow the card owner to save these details in their CRM.</label>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send my contact"}</button>
    </form>}
  </details>;
}
