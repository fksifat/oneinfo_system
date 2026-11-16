import { useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

function SvgCameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function SvgTrashIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function CoverPhotoEditor({
  value,
  theme = "MIDNIGHT",
  token,
  claimToken,
  operator,
  onChange,
  onBusy,
}: {
  value?: string | undefined;
  theme?: string | undefined;
  token?: string | undefined;
  claimToken?: string | undefined;
  operator?: boolean | undefined;
  onChange: (url: string) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Please select a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Cover image must be under 10 MB.");
      return;
    }

    setBusy(true);
    onBusy?.(true);
    setError("");

    try {
      const route = operator ? "upload" : claimToken ? "profile-claim" : "profile";
      const extension = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
      const response = await fetch(`${API_URL}/api/v1/product-media/${route}/${extension}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${operator ? token : claimToken || token}`,
          "content-type": "application/octet-stream",
        },
        body: file,
      });

      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.message ?? "Cover photo upload failed. Please try again.");
      }

      const fullUrl = new URL(data.url, API_URL || window.location.origin).href;
      onChange(fullUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload cover photo. Try another image.");
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = () => {
    setError("");
    onChange("");
  };

  return (
    <div className="cover-photo-editor">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <div className={`cover-editor-banner theme-${(theme || "midnight").toLowerCase()}`}>
        {value ? (
          <img src={value} alt="Current cover preview" className="cover-editor-img" />
        ) : (
          <div className="cover-editor-default-graphic">
            <span className="cover-editor-default-badge">DEFAULT GEOMETRIC MOTIF</span>
          </div>
        )}

        <div className="cover-editor-overlay" aria-hidden="true" />

        <div className="cover-editor-controls">
          <button
            type="button"
            className="cover-editor-btn is-upload"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            title={value ? "Change cover image" : "Upload cover image"}
          >
            <SvgCameraIcon size={14} />
            <span>{busy ? "Uploading…" : value ? "Change cover" : "Upload cover"}</span>
          </button>

          {value && !busy && (
            <button
              type="button"
              className="cover-editor-btn is-remove"
              onClick={handleRemove}
              title="Remove custom cover and revert to geometric pattern"
            >
              <SvgTrashIcon size={13} />
              <span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {error && <p className="cover-editor-error" role="alert">{error}</p>}
      <p className="cover-editor-hint">
        Recommended: Landscape image (PNG, JPEG, WebP up to 10 MB).
      </p>
    </div>
  );
}
