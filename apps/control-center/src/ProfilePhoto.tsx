import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

function SvgMinusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SvgPlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SvgRotateIcon({ size = 15 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M21.13 15a9 9 0 1 1-2.22-9.67L21 8" />
    </svg>
  );
}

function SvgCenterIcon({ size = 15 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SvgCropIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  );
}

function SvgCheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SvgCloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface PhotoCropperModalProps {
  imageSrc: string;
  onClose: () => void;
  onConfirm: (blob: Blob) => Promise<void>;
  busy: boolean;
}

export function PhotoCropperModal({ imageSrc, onClose, onConfirm, busy }: PhotoCropperModalProps) {
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [imgNatural, setImgNatural] = useState<{ width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  const CROP_SIZE = 260; // diameter of the crop ring in px

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImgNatural({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = imageSrc;
    imgRef.current = img;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageSrc, busy, onClose]);

  const baseScale = imgNatural ? Math.max(CROP_SIZE / imgNatural.width, CROP_SIZE / imgNatural.height) : 1;
  const currentScale = baseScale * zoom;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom(prev => Math.min(3.5, Math.max(1, +(prev - e.deltaY * 0.0015).toFixed(2))));
  };

  const handleApply = async () => {
    if (!imgNatural || !imgRef.current || busy) return;
    const outputSize = Math.min(640, Math.min(imgNatural.width, imgNatural.height));
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Photo editing is unavailable in this browser.");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const ratio = outputSize / CROP_SIZE;

    ctx.translate(outputSize / 2 + pan.x * ratio, outputSize / 2 + pan.y * ratio);
    ctx.rotate((rotation * Math.PI) / 180);

    const drawW = imgNatural.width * currentScale * ratio;
    const drawH = imgNatural.height * currentScale * ratio;

    ctx.drawImage(imgRef.current, -drawW / 2, -drawH / 2, drawW, drawH);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, "image/webp", 0.9);
    }) || await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, "image/png");
    });

    if (!blob) throw new Error("Could not prepare cropped photo.");
    await onConfirm(blob);
  };

  return (
    <div className="photo-crop-backdrop" role="dialog" aria-modal="true" aria-label="Crop and adjust profile photo">
      <div className="photo-crop-modal">
        <div className="photo-crop-header">
          <div>
            <h3 className="photo-crop-title">Adjust profile photo</h3>
            <p className="photo-crop-subtitle">Drag to reposition, zoom or rotate your photo</p>
          </div>
          <button type="button" className="photo-crop-close-btn" onClick={onClose} disabled={busy} aria-label="Close photo editor">
            <SvgCloseIcon size={16} />
          </button>
        </div>

        <div
          className={`photo-crop-viewport ${isDragging ? "is-dragging" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          {imgNatural && (
            <img
              src={imageSrc}
              alt="Crop target"
              className="photo-crop-image"
              style={{
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${currentScale})`,
              }}
            />
          )}

          {/* Circular mask with gold border and rule-of-thirds grid */}
          <div className="photo-crop-mask-circle">
            <div className={`photo-crop-grid ${isDragging ? "is-visible" : ""}`} aria-hidden="true">
              <span className="grid-line grid-h1" />
              <span className="grid-line grid-h2" />
              <span className="grid-line grid-v1" />
              <span className="grid-line grid-v2" />
            </div>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="photo-crop-toolbar">
          <div className="photo-crop-slider-row">
            <button
              type="button"
              className="crop-slider-step-btn"
              onClick={() => setZoom(z => Math.max(1, +(z - 0.1).toFixed(2)))}
              disabled={zoom <= 1 || busy}
              aria-label="Zoom out"
            >
              <SvgMinusIcon size={14} />
            </button>
            <input
              type="range"
              min="1"
              max="3.5"
              step="0.01"
              value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              className="photo-crop-range"
              aria-label="Zoom slider"
              disabled={busy}
            />
            <button
              type="button"
              className="crop-slider-step-btn"
              onClick={() => setZoom(z => Math.min(3.5, +(z + 0.1).toFixed(2)))}
              disabled={zoom >= 3.5 || busy}
              aria-label="Zoom in"
            >
              <SvgPlusIcon size={14} />
            </button>
            <span className="photo-crop-zoom-badge">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="photo-crop-tools-row">
            <button
              type="button"
              className="crop-tool-btn"
              onClick={() => setRotation(r => (r + 90) % 360)}
              disabled={busy}
            >
              <SvgRotateIcon size={15} />
              <span>Rotate</span>
            </button>
            <button
              type="button"
              className="crop-tool-btn"
              onClick={() => {
                setZoom(1.0);
                setPan({ x: 0, y: 0 });
                setRotation(0);
              }}
              disabled={busy}
            >
              <SvgCenterIcon size={15} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="photo-crop-footer">
          <button type="button" className="quiet crop-btn-cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="crop-btn-save" onClick={handleApply} disabled={busy || !imgNatural}>
            <SvgCheckIcon size={16} />
            <span>{busy ? "Uploading photo…" : "Save photo"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfilePhoto({
  value,
  name,
  token,
  claimToken,
  operator = false,
  onChange,
  onBusy,
}: {
  value: string;
  name: string;
  token: string;
  claimToken?: string;
  operator?: boolean;
  onChange: (url: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState("");
  const [editingSrc, setEditingSrc] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const cleanupObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const handleFileSelect = (file: File) => {
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP photo.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a photo smaller than 10 MB.");
      return;
    }

    cleanupObjectUrl();
    const objUrl = URL.createObjectURL(file);
    objectUrlRef.current = objUrl;
    setEditingSrc(objUrl);
  };

  const handleAdjustExisting = () => {
    if (!value) return;
    setError("");
    setEditingSrc(value);
  };

  const handleConfirmCrop = async (blob: Blob) => {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      if (blob.size > 2 * 1024 * 1024) {
        throw new Error("Could not prepare this photo (size exceeded). Try a slightly smaller zoom.");
      }
      const route = operator ? "upload" : claimToken ? "profile-claim" : "profile";
      const extension = blob.type === "image/webp" ? "webp" : "png";
      const response = await fetch(`${API_URL}/api/v1/product-media/${route}/${extension}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${operator ? token : claimToken || token}`,
          "content-type": "application/octet-stream",
        },
        body: blob,
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.message ?? "Photo upload failed. Please try again.");
      }
      onChange(new URL(data.url, API_URL || window.location.origin).href);
      setEditingSrc(null);
      cleanupObjectUrl();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo. Try another image.");
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => word[0])
      .join("")
      .toUpperCase() || "YOU";

  return (
    <>
      <div className="profile-photo-editor">
        <div
          className="photo-editor-avatar"
          role="button"
          tabIndex={0}
          title={value ? "Click to adjust crop" : "Click to upload photo"}
          onClick={() => {
            if (value) handleAdjustExisting();
          }}
          onKeyDown={e => {
            if ((e.key === "Enter" || e.key === " ") && value) handleAdjustExisting();
          }}
        >
          {value && failed !== value ? (
            <img src={value} alt="Profile photo preview" onError={() => setFailed(value)} />
          ) : (
            initials
          )}
        </div>
        <div className="photo-editor-controls">
          <strong>Profile photo</strong>
          <p>Drag, zoom, and crop your photo like on social media. We frame a circle for your card.</p>
          <div className="photo-editor-actions">
            <label className="media-upload">
              {busy ? "Uploading photo…" : value ? "Replace photo" : "Upload photo"}
              <input
                type="file"
                aria-label="Upload profile photo"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) handleFileSelect(file);
                }}
              />
            </label>
            {value && !busy && (
              <button
                type="button"
                className="photo-btn-adjust"
                onClick={handleAdjustExisting}
                title="Adjust framing, zoom, or rotation"
              >
                <SvgCropIcon size={14} />
                <span>Adjust crop</span>
              </button>
            )}
            {value && (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  onChange("");
                  setError("");
                }}
              >
                Remove photo
              </button>
            )}
          </div>
          <small>{busy ? "Preparing your photo…" : "JPG, PNG or WebP · up to 10 MB. Interactive zoom & crop enabled."}</small>
          {error && <p className="photo-editor-error" role="alert">{error}</p>}
        </div>
      </div>

      {editingSrc && (
        <PhotoCropperModal
          imageSrc={editingSrc}
          onClose={() => {
            setEditingSrc(null);
            cleanupObjectUrl();
          }}
          onConfirm={handleConfirmCrop}
          busy={busy}
        />
      )}
    </>
  );
}
