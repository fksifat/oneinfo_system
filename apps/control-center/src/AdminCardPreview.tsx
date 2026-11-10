import React, { useState } from "react";
import type { ProductCustomization } from "@oneinfo/contracts";
import oneinfoLogo from "./assets/oneinfo-logo.svg";

interface AdminCardPreviewProps {
  custom: ProductCustomization;
  customerName?: string | null;
  className?: string;
}

function isColorLight(hex?: string): boolean {
  if (!hex || !hex.startsWith("#")) return false;
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.65;
}

// Front Surface Motifs
function renderFrontMotif(motif: string, stroke: string) {
  if (motif === "facets") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="0.85" fill="none">
          <polygon points="400,0 330,0 360,50 400,35" strokeOpacity="0.35" />
          <polygon points="330,0 260,0 290,45 360,50" strokeOpacity="0.22" />
          <polygon points="360,50 400,35 400,95 345,90" strokeOpacity="0.28" />
          <polygon points="290,45 360,50 345,90 280,80" strokeOpacity="0.18" />
          <polygon points="345,90 400,95 400,150 355,135" strokeOpacity="0.22" />
          <polyline points="400,0 290,45 280,80 355,135 400,150" strokeOpacity="0.45" strokeWidth="1.1" />
          <polygon points="0,252 65,252 40,210 0,220" strokeOpacity="0.28" />
          <polygon points="65,252 130,252 105,215 40,210" strokeOpacity="0.18" />
          <polygon points="0,220 40,210 50,170 0,165" strokeOpacity="0.22" />
          <polyline points="0,252 40,210 50,170 0,165" strokeOpacity="0.4" strokeWidth="1" />
        </g>
      </svg>
    );
  }
  if (motif === "contour") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="0.9" fill="none">
          <path d="M-20,180 C80,160 140,210 220,190 C300,170 340,220 420,200" strokeOpacity="0.2" />
          <path d="M-20,150 C70,130 150,180 230,160 C310,140 350,190 420,170" strokeOpacity="0.26" />
          <path d="M-20,120 C60,100 160,150 240,130 C320,110 360,160 420,140" strokeOpacity="0.32" />
          <path d="M-20,90 C50,70 170,120 250,100 C330,80 370,130 420,110" strokeOpacity="0.26" />
          <path d="M-20,60 C40,40 180,90 260,70 C340,50 380,100 420,80" strokeOpacity="0.2" />
          <path d="M-20,30 C30,10 190,60 270,40 C350,20 390,70 420,50" strokeOpacity="0.14" />
          <ellipse cx="360" cy="45" rx="55" ry="30" strokeOpacity="0.22" transform="rotate(-15 360 45)" />
          <ellipse cx="360" cy="45" rx="35" ry="18" strokeOpacity="0.3" transform="rotate(-15 360 45)" />
          <ellipse cx="360" cy="45" rx="15" ry="8" strokeOpacity="0.38" transform="rotate(-15 360 45)" />
        </g>
      </svg>
    );
  }
  if (motif === "architectural") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="1.2" fill="none">
          <path d="M22,38 L22,22 L38,22" strokeOpacity="0.75" />
          <path d="M378,38 L378,22 L362,22" strokeOpacity="0.75" />
          <path d="M22,214 L22,230 L38,230" strokeOpacity="0.75" />
          <path d="M378,214 L378,230 L362,230" strokeOpacity="0.75" />
          <line x1="200" y1="16" x2="200" y2="26" strokeOpacity="0.35" />
          <line x1="200" y1="226" x2="200" y2="236" strokeOpacity="0.35" />
          <line x1="14" y1="126" x2="24" y2="126" strokeOpacity="0.35" />
          <line x1="376" y1="126" x2="386" y2="126" strokeOpacity="0.35" />
          <rect x="34" y="34" width="332" height="184" rx="4" strokeWidth="0.65" strokeOpacity="0.2" strokeDasharray="3 4" />
        </g>
      </svg>
    );
  }
  if (motif === "inlay") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="1.2" fill="none">
          <line x1="260" y1="0" x2="400" y2="140" strokeOpacity="0.45" strokeWidth="1.5" />
          <line x1="285" y1="0" x2="400" y2="115" strokeOpacity="0.28" strokeWidth="0.8" />
          <line x1="310" y1="0" x2="400" y2="90" strokeOpacity="0.28" strokeWidth="0.8" />
          <line x1="225" y1="0" x2="400" y2="175" strokeOpacity="0.22" strokeWidth="0.8" />
          <line x1="0" y1="112" x2="140" y2="252" strokeOpacity="0.45" strokeWidth="1.5" />
          <line x1="0" y1="137" x2="115" y2="252" strokeOpacity="0.28" strokeWidth="0.8" />
          <line x1="0" y1="162" x2="90" y2="252" strokeOpacity="0.28" strokeWidth="0.8" />
        </g>
      </svg>
    );
  }
  return null;
}

// Back Surface Motifs
function renderBackMotif(motif: string, stroke: string) {
  if (motif === "facets") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="0.85" fill="none">
          <polygon points="0,0 70,0 40,50 0,35" strokeOpacity="0.35" />
          <polygon points="70,0 140,0 110,45 40,50" strokeOpacity="0.22" />
          <polygon points="40,50 0,35 0,95 55,90" strokeOpacity="0.28" />
          <polygon points="400,252 335,252 360,210 400,220" strokeOpacity="0.28" />
          <polyline points="400,252 360,210 350,170 400,165" strokeOpacity="0.4" strokeWidth="1" />
        </g>
      </svg>
    );
  }
  if (motif === "contour") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="0.9" fill="none">
          <path d="M-20,200 C80,210 140,160 220,170 C300,180 340,140 420,150" strokeOpacity="0.2" />
          <path d="M-20,170 C70,180 150,130 230,140 C310,150 350,110 420,120" strokeOpacity="0.26" />
          <path d="M-20,140 C60,150 160,100 240,110 C320,120 360,80 420,90" strokeOpacity="0.32" />
          <ellipse cx="40" cy="45" rx="45" ry="25" strokeOpacity="0.22" transform="rotate(15 40 45)" />
        </g>
      </svg>
    );
  }
  if (motif === "architectural") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="1.2" fill="none">
          <path d="M22,38 L22,22 L38,22" strokeOpacity="0.75" />
          <path d="M378,38 L378,22 L362,22" strokeOpacity="0.75" />
          <path d="M22,214 L22,230 L38,230" strokeOpacity="0.75" />
          <path d="M378,214 L378,230 L362,230" strokeOpacity="0.75" />
          <line x1="200" y1="16" x2="200" y2="26" strokeOpacity="0.35" />
          <line x1="200" y1="226" x2="200" y2="236" strokeOpacity="0.35" />
        </g>
      </svg>
    );
  }
  if (motif === "inlay") {
    return (
      <svg viewBox="0 0 400 252" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
        <g stroke={stroke} strokeWidth="1.2" fill="none">
          <line x1="140" y1="0" x2="0" y2="140" strokeOpacity="0.45" strokeWidth="1.5" />
          <line x1="115" y1="0" x2="0" y2="115" strokeOpacity="0.28" strokeWidth="0.8" />
          <line x1="260" y1="252" x2="400" y2="112" strokeOpacity="0.45" strokeWidth="1.5" />
          <line x1="285" y1="252" x2="400" y2="137" strokeOpacity="0.28" strokeWidth="0.8" />
        </g>
      </svg>
    );
  }
  return null;
}

// Vector QR Code representation
function RenderQrPattern({ accentColor, style }: { accentColor: string; style?: string | undefined }) {
  const frameBorder =
    style === "framed"
      ? `1.5px solid ${accentColor}`
      : style === "badge"
      ? `1.5px dashed ${accentColor}`
      : "none";

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px",
        background: "#ffffff",
        borderRadius: "8px",
        border: frameBorder,
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
      }}
    >
      <svg viewBox="0 0 100 100" width="58" height="58" style={{ display: "block" }}>
        {/* Finder patterns */}
        {/* Top-Left */}
        <rect x="6" y="6" width="24" height="24" rx="4" fill="#121316" />
        <rect x="11" y="11" width="14" height="14" rx="2" fill="#ffffff" />
        <rect x="15" y="15" width="6" height="6" rx="1" fill="#121316" />

        {/* Top-Right */}
        <rect x="70" y="6" width="24" height="24" rx="4" fill="#121316" />
        <rect x="75" y="11" width="14" height="14" rx="2" fill="#ffffff" />
        <rect x="79" y="15" width="6" height="6" rx="1" fill="#121316" />

        {/* Bottom-Left */}
        <rect x="6" y="70" width="24" height="24" rx="4" fill="#121316" />
        <rect x="11" y="75" width="14" height="14" rx="2" fill="#ffffff" />
        <rect x="15" y="79" width="6" height="6" rx="1" fill="#121316" />

        {/* Random decorative QR data grid */}
        <circle cx="42" cy="18" r="2.5" fill="#121316" />
        <circle cx="54" cy="18" r="2.5" fill="#121316" />
        <circle cx="48" cy="28" r="2.5" fill="#121316" />
        <circle cx="40" cy="40" r="2.5" fill="#121316" />
        <circle cx="60" cy="40" r="2.5" fill="#121316" />
        <circle cx="20" cy="46" r="2.5" fill="#121316" />
        <circle cx="80" cy="46" r="2.5" fill="#121316" />
        <circle cx="42" cy="58" r="2.5" fill="#121316" />
        <circle cx="58" cy="58" r="2.5" fill="#121316" />
        <circle cx="48" cy="70" r="2.5" fill="#121316" />
        <circle cx="60" cy="78" r="2.5" fill="#121316" />
        <circle cx="76" cy="74" r="2.5" fill="#121316" />
        <circle cx="86" cy="84" r="2.5" fill="#121316" />

        {/* Center Oneinfo Mini Badge */}
        <circle cx="50" cy="50" r="9" fill="#ffffff" stroke="#121316" strokeWidth="1" />
        <circle cx="50" cy="50" r="7" fill="#121316" />
        <path d="M47 48 L53 48 L50 45 Z" fill="#ffffff" />
      </svg>
    </div>
  );
}

export function AdminCardPreview({ custom, customerName, className }: AdminCardPreviewProps) {
  const [viewMode, setViewMode] = useState<"both" | "front" | "back">("both");
  const [isZoomed, setIsZoomed] = useState(false);

  const isLight = isColorLight(custom.surfaceColor);
  const surfaceBg = custom.surfaceColor || "#0a0b0d";
  const accentColor = custom.accentColor || "#d8b26e";
  const motif = custom.surfaceMotif || "facets";
  const layout = custom.layout || "left";
  const textScale = (custom.textSize || 14) / 14;

  const fontStyle =
    custom.font === "serif"
      ? "'Playfair Display', Georgia, serif"
      : custom.font === "mono"
      ? "'SF Mono', Menlo, Consolas, monospace"
      : "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

  const ep = custom.elementPositions || {};
  const activeExtras = (custom.extraLines || []).filter((l) => l && l.trim());
  const numExtras = activeExtras.length;
  const logoScale = ((custom.logoSize || 100) / 100).toFixed(2);
  const iconScale = ((custom.iconSize || 100) / 100).toFixed(2);
  const qrScale = ((custom.qrSize || 100) / 100).toFixed(2);

  // Front Drag Positions
  const epLogo = ep.logo;
  const epSign = ep.sign;
  const epName = ep.name || custom.customPos;
  const epTitle = ep.title;

  const logoStyle: React.CSSProperties = epLogo
    ? { position: "absolute", left: `${epLogo.x}%`, top: `${epLogo.y}%`, transform: `translate(-50%, -50%) scale(${logoScale})`, transformOrigin: "center center", zIndex: 3 }
    : layout === "center" || layout === "header"
    ? { position: "absolute", left: "50%", top: "18px", transform: `translateX(-50%) scale(${logoScale})`, transformOrigin: "top center", zIndex: 3 }
    : layout === "right"
    ? { position: "absolute", right: "20px", top: "18px", transform: `scale(${logoScale})`, transformOrigin: "top right", zIndex: 3 }
    : layout === "reverse"
    ? { position: "absolute", left: "20px", bottom: "18px", transform: `scale(${logoScale})`, transformOrigin: "bottom left", zIndex: 3 }
    : { position: "absolute", left: "20px", top: "18px", transform: `scale(${logoScale})`, transformOrigin: "top left", zIndex: 3 };

  const signStyle: React.CSSProperties = epSign
    ? { position: "absolute", left: `${epSign.x}%`, top: `${epSign.y}%`, transform: `translate(-50%, -50%) scale(${iconScale})`, transformOrigin: "center center", zIndex: 3 }
    : { position: "absolute", right: "20px", top: "18px", transform: `scale(${iconScale})`, transformOrigin: "top right", zIndex: 3 };

  const nameStyle: React.CSSProperties = epName
    ? { position: "absolute", left: `${epName.x}%`, top: `${epName.y}%`, transform: "translate(-50%, -50%)", zIndex: 3 }
    : layout === "center" || layout === "header"
    ? { position: "absolute", left: "50%", bottom: "46px", transform: "translateX(-50%)", textAlign: "center", zIndex: 3 }
    : layout === "right"
    ? { position: "absolute", right: "22px", bottom: `${40 + numExtras * 16}px`, textAlign: "right", zIndex: 3 }
    : layout === "reverse"
    ? { position: "absolute", left: "22px", top: "20px", zIndex: 3 }
    : { position: "absolute", left: "22px", bottom: `${40 + numExtras * 16}px`, zIndex: 3 };

  const titleStyle: React.CSSProperties = epTitle
    ? { position: "absolute", left: `${epTitle.x}%`, top: `${epTitle.y}%`, transform: "translate(-50%, -50%)", zIndex: 3 }
    : layout === "center" || layout === "header"
    ? { position: "absolute", left: "50%", bottom: "26px", transform: "translateX(-50%)", textAlign: "center", zIndex: 3 }
    : layout === "right"
    ? { position: "absolute", right: "22px", bottom: `${22 + numExtras * 16}px`, textAlign: "right", zIndex: 3 }
    : layout === "reverse"
    ? { position: "absolute", left: "22px", top: "44px", zIndex: 3 }
    : { position: "absolute", left: "22px", bottom: `${22 + numExtras * 16}px`, zIndex: 3 };

  // Back Drag Positions
  const epQr = ep["back-qr"];
  const qrStyle: React.CSSProperties = epQr
    ? { position: "absolute", left: `${epQr.x}%`, top: `${epQr.y}%`, transform: `translate(-50%, -50%) scale(${qrScale})`, transformOrigin: "center center", zIndex: 3 }
    : { position: "absolute", left: "50%", top: "48%", transform: `translate(-50%, -50%) scale(${qrScale})`, transformOrigin: "center center", zIndex: 3 };

  const cardMaxWidth = isZoomed ? "500px" : "340px";

  return (
    <div
      className={className}
      style={{
        marginTop: "12px",
        marginBottom: "12px",
        padding: "16px",
        background: "#080c14",
        border: "1px solid rgba(216, 178, 110, 0.35)",
        borderRadius: "12px",
        color: "#ffffff",
      }}
    >
      {/* Top Action Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          marginBottom: "14px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          paddingBottom: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, letterSpacing: "0.08em", color: "#fbbf24" }}>
            EXACT CARD DESIGN (86 × 55 mm)
          </span>
          <span
            style={{
              fontSize: "0.72rem",
              padding: "2px 8px",
              borderRadius: "4px",
              background: "rgba(216, 178, 110, 0.15)",
              color: "#fbbf24",
              border: "1px solid rgba(216, 178, 110, 0.3)",
            }}
          >
            Motif: {motif} · Foil: {accentColor}
          </span>
          {custom.hasOneinfoLogo === false ? (
            <span
              style={{
                fontSize: "0.72rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background: "#7c2d12",
                color: "#fed7aa",
                fontWeight: 700,
                border: "1px solid #ea580c",
              }}
            >
              WITHOUT ONEINFO LOGO
            </span>
          ) : (
            <span
              style={{
                fontSize: "0.72rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background: "#1e293b",
                color: "#93c5fd",
                fontWeight: 600,
                border: "1px solid #3b82f6",
              }}
            >
              WITH ONEINFO LOGO
            </span>
          )}
        </div>

        {/* View Toggle Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("both");
            }}
            style={{
              padding: "4px 10px",
              fontSize: "0.74rem",
              fontWeight: 600,
              background: viewMode === "both" ? "#d97706" : "rgba(255,255,255,0.06)",
              color: viewMode === "both" ? "#000000" : "#d4d4d8",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Side-by-Side (Both)
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("front");
            }}
            style={{
              padding: "4px 10px",
              fontSize: "0.74rem",
              fontWeight: 600,
              background: viewMode === "front" ? "#d97706" : "rgba(255,255,255,0.06)",
              color: viewMode === "front" ? "#000000" : "#d4d4d8",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Front Face
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("back");
            }}
            style={{
              padding: "4px 10px",
              fontSize: "0.74rem",
              fontWeight: 600,
              background: viewMode === "back" ? "#d97706" : "rgba(255,255,255,0.06)",
              color: viewMode === "back" ? "#000000" : "#d4d4d8",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Back Face
          </button>
          <button
            type="button"
            title={isZoomed ? "Standard size" : "Enlarge card"}
            onClick={(e) => {
              e.stopPropagation();
              setIsZoomed(!isZoomed);
            }}
            style={{
              padding: "4px 8px",
              fontSize: "0.74rem",
              background: "rgba(255,255,255,0.06)",
              color: "#d4d4d8",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            {isZoomed ? "⊟ Normal" : "⊞ Zoom"}
          </button>
        </div>
      </div>

      {/* Cards View Container */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-start",
          alignItems: "flex-start",
          gap: "20px",
        }}
      >
        {/* ======================================================== */}
        {/* FRONT FACE CARD                                          */}
        {/* ======================================================== */}
        {(viewMode === "both" || viewMode === "front") && (
          <div style={{ flex: `0 1 ${cardMaxWidth}`, minWidth: "280px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", color: "#a1a1aa" }}>
                FRONT FACE · 86 × 55 MM
              </span>
              {custom.elementPositions && Object.keys(custom.elementPositions).length > 0 && (
                <span style={{ fontSize: "0.68rem", color: "#10b981", fontWeight: 600 }}>✦ Custom Drag Positioned</span>
              )}
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "86 / 55",
                borderRadius: "12px",
                background: surfaceBg,
                border: "1px solid rgba(255, 255, 255, 0.16)",
                boxShadow: "0 14px 34px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)",
                overflow: "hidden",
                color: isLight ? "#121316" : "#ffffff",
                fontFamily: fontStyle,
                transition: "all 0.2s ease",
              }}
            >
              {/* Front Vector Surface Motif */}
              {renderFrontMotif(motif, accentColor)}

              {/* Column Layout Bar */}
              {layout === "column" && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: "44px",
                    background: "rgba(255,255,255,0.06)",
                    borderRight: `1px solid ${accentColor}`,
                    zIndex: 1,
                  }}
                />
              )}

              {/* Header Banner */}
              {layout === "header" && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "44px",
                    background: "rgba(0,0,0,0.32)",
                    borderBottom: `1px solid ${accentColor}`,
                    zIndex: 1,
                  }}
                />
              )}

              {/* Logo Element (Customer Logo or "YOUR LOGO" placeholder text) */}
              <div style={logoStyle}>
                {custom.logoUrl ? (
                  <img
                    src={custom.logoUrl}
                    alt="Custom logo"
                    style={{
                      maxHeight: "30px",
                      maxWidth: "100px",
                      objectFit: "contain",
                      display: "block",
                      filter: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: `calc(0.88rem * ${logoScale})`,
                      fontWeight: 800,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: accentColor,
                      whiteSpace: "nowrap",
                      userSelect: "none",
                      display: "inline-block",
                      lineHeight: 1.2,
                    }}
                  >
                    YOUR LOGO
                  </span>
                )}
              </div>

              {/* NFC Waves Glyph */}
              <div style={signStyle}>
                <span style={{ display: "inline-flex", color: accentColor, width: "18px", height: "18px" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: "100%", height: "100%" }}>
                    <path d="M6 9a5 5 0 0 1 0 6" />
                    <path d="M10 6a9 9 0 0 1 0 12" />
                    <path d="M14 3a13 13 0 0 1 0 18" />
                  </svg>
                </span>
              </div>

              {/* Cardholder Name */}
              <div style={nameStyle}>
                <strong
                  style={{
                    display: "block",
                    fontSize: `calc(1.08rem * ${textScale})`,
                    fontWeight: 700,
                    letterSpacing: "-0.015em",
                    lineHeight: 1.2,
                    color: isLight ? "#121316" : "#f7eed8",
                    textShadow: isLight ? "none" : "0 1px 4px rgba(0,0,0,0.6)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {custom.name || customerName || "Cardholder Name"}
                </strong>
              </div>

              {/* Designation / Title */}
              <div style={titleStyle}>
                <span
                  style={{
                    display: "block",
                    fontSize: `calc(0.62rem * ${textScale})`,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: accentColor,
                    lineHeight: 1.25,
                    whiteSpace: "nowrap",
                  }}
                >
                  {custom.title || "Custom Edition"}
                </span>
              </div>

              {/* Extra Lines */}
              {activeExtras.map((line, idx) => {
                const epExtra = ep[`extra-${idx}`];
                const extraStyle: React.CSSProperties = epExtra
                  ? { position: "absolute", left: `${epExtra.x}%`, top: `${epExtra.y}%`, transform: "translate(-50%, -50%)", zIndex: 3 }
                  : { position: "absolute", left: "22px", bottom: `${22 + (numExtras - 1 - idx) * 15}px`, zIndex: 3 };

                return (
                  <div key={idx} style={extraStyle}>
                    <span
                      style={{
                        display: "block",
                        fontSize: `calc(0.62rem * ${textScale})`,
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: accentColor,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {line}
                    </span>
                  </div>
                );
              })}

              {/* Divider Lines (HR & Vertical) */}
              {(custom.dividerLines || []).map((line, idx) => {
                const dividerKey = `divider-${idx}`;
                const dividerPos = ep[dividerKey];
                const isVert = line.orientation === "vertical";
                const len = line.length || (isVert ? 60 : 100);
                const isDashed = line.style === "dashed";
                const divStyle: React.CSSProperties = dividerPos
                  ? {
                      position: "absolute",
                      left: `${dividerPos.x}%`,
                      top: `${dividerPos.y}%`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 3,
                    }
                  : {
                      position: "absolute",
                      left: "50%",
                      top: `${50 + idx * 12}%`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 3,
                    };
                return (
                  <div key={idx} style={divStyle}>
                    <div
                      style={{
                        width: isVert ? "0px" : `${len}px`,
                        height: isVert ? `${len}px` : "0px",
                        borderTop: isVert ? "none" : `1.5px ${isDashed ? "dashed" : "solid"} ${accentColor}`,
                        borderLeft: isVert ? `1.5px ${isDashed ? "dashed" : "solid"} ${accentColor}` : "none",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* BACK FACE CARD                                           */}
        {/* ======================================================== */}
        {(viewMode === "both" || viewMode === "back") && (
          <div style={{ flex: `0 1 ${cardMaxWidth}`, minWidth: "280px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", color: "#a1a1aa" }}>
                BACK FACE · 86 × 55 MM
              </span>
              <span style={{ fontSize: "0.68rem", color: "#d4d4d8" }}>
                QR Style: {custom.backQrStyle || "minimal"}
              </span>
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "86 / 55",
                borderRadius: "12px",
                background: surfaceBg,
                border: "1px solid rgba(255, 255, 255, 0.16)",
                boxShadow: "0 14px 34px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)",
                overflow: "hidden",
                color: isLight ? "#121316" : "#ffffff",
                transition: "all 0.2s ease",
              }}
            >
              {/* Back Vector Surface Motif */}
              {renderBackMotif(motif, accentColor)}

              {/* Center QR Pattern & Subline */}
              <div style={{ ...qrStyle, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <RenderQrPattern accentColor={accentColor} style={custom.backQrStyle} />
                {custom.backSubtitle && custom.backSubtitle.trim() && (
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.65rem",
                      letterSpacing: "0.05em",
                      color: accentColor,
                      textAlign: "center",
                      marginTop: "5px",
                      fontWeight: 500,
                      maxWidth: "140px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {custom.backSubtitle.trim()}
                  </span>
                )}
              </div>

              {/* Back Footer: Oneinfo Logo & AriseStudio Branding (Omitted in Without Logo edition) */}
              {custom.hasOneinfoLogo !== false && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "14px",
                    left: "18px",
                    right: "18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    zIndex: 2,
                  }}
                >
                  <img
                    src={oneinfoLogo}
                    alt="Oneinfo logo"
                    style={{
                      height: "14px",
                      width: "auto",
                      display: "block",
                      filter: isLight ? "invert(1) brightness(0.2)" : "none",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "0.58rem",
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      color: isLight ? "rgba(18,19,22,0.7)" : "rgba(255,255,255,0.7)",
                      textTransform: "uppercase",
                    }}
                  >
                    By AriseStudio
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
