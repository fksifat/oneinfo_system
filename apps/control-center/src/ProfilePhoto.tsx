import { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

export function ProfilePhoto({ value, name, token, claimToken, operator = false, onChange, onBusy }: {
  value: string; name: string; token: string; claimToken?: string; operator?: boolean;
  onChange: (url: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState("");
  async function upload(file: File) {
    if (busy) return;
    setError(""); setBusy(true); onBusy(true);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose a photo smaller than 10 MB.");
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      try {
        if (bitmap.width * bitmap.height > 40_000_000) throw new Error("Choose a photo smaller than 40 megapixels.");
        const size = Math.min(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = Math.min(640, size);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Photo editing is unavailable in this browser.");
        context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .88));
        if (!blob || blob.size > 2 * 1024 * 1024) throw new Error("Could not prepare this photo. Try another image.");
        const route = operator ? "upload" : claimToken ? "profile-claim" : "profile";
        const extension = blob.type === "image/webp" ? "webp" : "png";
        const response = await fetch(`${API_URL}/api/v1/product-media/${route}/${extension}`, {
          method: "POST", headers: { authorization: `Bearer ${operator ? token : claimToken || token}`, "content-type": "application/octet-stream" }, body: blob,
        });
        const data = await response.json();
        if (!response.ok || !data.url) throw new Error(data.message ?? "Photo upload failed. Please try again.");
        onChange(new URL(data.url, API_URL || window.location.origin).href);
      } finally { bitmap.close(); }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open this photo. Try another image."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div className="profile-photo-editor">
    <div className="photo-editor-avatar">{value && failed !== value ? <img src={value} alt="Profile photo preview" onError={() => setFailed(value)} /> : name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "You"}</div>
    <div className="photo-editor-controls"><strong>Profile photo</strong><p>Keep your face in the centre. We crop a square for your card.</p>
      <div className="photo-editor-actions"><label className="media-upload">{busy ? "Uploading photo…" : value ? "Replace photo" : "Upload photo"}<input type="file" aria-label="Upload profile photo" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} /></label>
        {value && <button type="button" className="quiet" disabled={busy} onClick={() => { onChange(""); setError(""); }}>Remove photo</button>}</div>
      <small>{busy ? "Preparing your photo…" : "JPG, PNG or WebP · up to 10 MB. Save your profile to publish."}</small>
      {error && <p className="photo-editor-error" role="alert">{error}</p>}
    </div>
  </div>;
}
