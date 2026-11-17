import type { ProductCustomization } from "@oneinfo/contracts";
export function getElementStyle(custom: ProductCustomization, key: string): {
  font: string; size: number; rotate: number; bold: boolean; italic: boolean; x?: number; y?: number;
};
export function renderCardDesign(custom: ProductCustomization, options: {
  face: "front" | "back";
  interactiveProductId?: string;
  selectedElementId?: string | null;
  logoUrl?: string;
  oneinfoLogoUrl?: string;
}): string;
export function observeCardDesigns(root: ParentNode): () => void;
