import { contactVcard } from "./contact.js";
import { useState } from "react";

export interface PublicProfileData {
  profile: { publicSlug: string; displayName: string; headline: string; company: string; bio: string; phone: string; email: string;
    website: string; avatarUrl: string; theme: string };
  links: { id?: string; label: string; url: string }[];
}

export function ProfileView({ data }: { data: PublicProfileData }) {
  const [copyMessage, setCopyMessage] = useState("Copy link");
  const [photoFailed, setPhotoFailed] = useState(false);
  const { profile, links } = data;
  const initials = profile.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return <div className={`profile-page theme-${profile.theme.toLowerCase()}`}><main className="public-profile">
    <div className="profile-brand"><i></i> ONEINFO</div>
    <div className="public-avatar">{profile.avatarUrl && !photoFailed ? <img src={profile.avatarUrl} alt="" onError={() => setPhotoFailed(true)} /> : initials}</div>
    <p className="profile-kicker">DIGITAL BUSINESS PROFILE</p><h1>{profile.displayName}</h1>
    <p className="public-headline">{profile.headline}{profile.company ? ` · ${profile.company}` : ""}</p>
    {profile.bio && <p className="public-bio">{profile.bio}</p>}
    <div className="contact-actions">
      {profile.phone && <a href={`tel:${profile.phone}`}>Call</a>}{profile.email && <a href={`mailto:${profile.email}`}>Email</a>}
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopyMessage("Copied"); } catch { setCopyMessage("Copy unavailable"); } }}>{copyMessage}</button>
    </div>
    <div className="public-links">
      {profile.website && <a href={profile.website} target="_blank" rel="noreferrer"><span>Website</span><b>↗</b></a>}
      {links.map(link => <a key={link.id ?? link.url} href={link.url} target="_blank" rel="noreferrer"><span>{link.label}</span><b>↗</b></a>)}
    </div>
    <button className="save-contact" type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([contactVcard(profile)], { type: "text/vcard;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `${profile.publicSlug}.vcf`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Save contact details</button>
    <small className="profile-footer">Powered by Oneinfo · NFC + QR</small>
  </main></div>;
}
