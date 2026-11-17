import { useLayoutEffect, useRef, useState } from "react";
import type { ProductCustomization } from "@oneinfo/contracts";
import { renderCardDesign, observeCardDesigns } from "../../../sites/storefront/card-design.js";
import "../../../sites/storefront/card-design.css";
import oneinfoLogo from "./assets/oneinfo-logo.svg";
import { productMediaUrl } from "./api.js";

export function AdminCardPreview({ custom, className }: {
  custom: ProductCustomization;
  customerName?: string | null;
  className?: string;
}) {
  const [view, setView] = useState<"both" | "front" | "back">("both");
  const [zoomed, setZoomed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) return observeCardDesigns(root.current);
  }, [custom, view, zoomed]);
  return <div className={`admin-card-design ${zoomed ? "is-zoomed" : ""} ${className ?? ""}`} ref={root}>
    <div className="admin-card-design-header">
      <strong>Card design · 86 × 55 mm</strong>
      <div role="group" aria-label="Card faces">
        {(["both", "front", "back"] as const).map(face =>
          <button type="button" className="quiet" key={face} aria-pressed={view === face} onClick={() => setView(face)}>
            {face === "both" ? "Both sides" : face === "front" ? "Front" : "Back"}
          </button>)}
        <button type="button" className="quiet" aria-pressed={zoomed} onClick={() => setZoomed(previous => !previous)}>
          {zoomed ? "Normal size" : "Zoom"}
        </button>
      </div>
    </div>
    <div className="admin-card-design-faces">
      {(["front", "back"] as const).filter(face => view === "both" || view === face).map(face =>
        <figure key={face}>
          <figcaption>{face === "front" ? "Front" : "Back"}</figcaption>
          <div dangerouslySetInnerHTML={{ __html: renderCardDesign(custom, {
            face, logoUrl: productMediaUrl(custom.logoUrl), oneinfoLogoUrl: oneinfoLogo,
          }) }} />
        </figure>)}
    </div>
  </div>;
}
