import { printTemplateUrl } from "./print-artwork.js";
import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { printFinish, ProductImageSchema, ProductInputSchema, productMedia, discountPercent, variantPrice, type Product, type ProductInput, type ProductVariant } from "@oneinfo/contracts";
import { api, productMediaUrl } from "./api.js";
import { ProductMediaEditor } from "./ProductMediaEditor.js";
import oneinfoLogo from "./assets/oneinfo-logo.svg";

function isColorLight(hex?: string): boolean {
  if (!hex || !hex.startsWith("#")) return false;
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65;
}

type VariantDraft = Omit<ProductVariant, "priceMinor" | "salePriceMinor" | "withoutLogoPriceMinor" | "withoutLogoSalePriceMinor"> & {
  regular: string;
  sale: string;
  withoutLogoRegular: string;
  withoutLogoSale: string;
};
type ProductDraft = Omit<ProductInput, "variants"> & { id?: string; version?: number; variants: VariantDraft[] };
const editorSections = [
  ["details", "Details"],
  ["colours", "Colours & prices"],
  ["media", "Media"],
  ["warranty", "Warranty"],
  ["publishing", "Publishing"],
] as const;
type EditorSection = typeof editorSections[number][0];

const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", minimumFractionDigits: 0, maximumFractionDigits: 2 });
function SvgTrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
const newVariant = (): VariantDraft => ({ id: crypto.randomUUID(), name: "", colorHex: "#143534", regular: "", sale: "", withoutLogoRegular: "", withoutLogoSale: "", available: true, finish: "", appearance: "dark", imageUrl: "", backImageUrl: "", showAllColourMedia:true, defaultMediaIndex:0, media:[] });
const toVariant = ({ regular, sale, withoutLogoRegular, withoutLogoSale, ...v }: VariantDraft): ProductVariant => ({
  ...v,
  media:v.media?.map(m=>m.type === "spin" ? {...m,frames:m.frames.map(f=>f.trim()).filter(Boolean)} : m),
  priceMinor: Math.round(Number(regular) * 100),
  salePriceMinor: sale === "" ? null : Math.round(Number(sale) * 100),
  withoutLogoPriceMinor: withoutLogoRegular && withoutLogoRegular.trim() !== "" ? Math.round(Number(withoutLogoRegular) * 100) : null,
  withoutLogoSalePriceMinor: withoutLogoSale && withoutLogoSale.trim() !== "" ? Math.round(Number(withoutLogoSale) * 100) : null,
});
const priceRange = (product: Product) => {
  const prices = product.variants.filter(v => v.available).map(variantPrice);
  const values = prices.length ? prices : product.variants.map(variantPrice);
  return `${money.format(Math.min(...values) / 100)}${Math.min(...values) !== Math.max(...values) ? ` – ${money.format(Math.max(...values) / 100)}` : ""}`;
};

export function Products({ token }: { token: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editorScroll = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [editing, setEditing] = useState<ProductDraft | null>(null);
  const [section, setSection] = useState<EditorSection>("details");
  const [activeVariant, setActiveVariant] = useState("");
  const [features, setFeatures] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { const data = await api<{items: Product[]}>("/api/v1/products", token); setItems(data.items); setLoaded(true); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load products"); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (editing && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [editing]);
  useLayoutEffect(() => { editorScroll.current?.scrollTo({ top: 0, behavior: "instant" }); }, [section]);
  function edit(product?: Product) {
    setSection("details");
    const variants = product ? product.variants.map(({priceMinor, salePriceMinor, withoutLogoPriceMinor, withoutLogoSalePriceMinor, ...v}) => ({
      ...v,
      regular: String(priceMinor / 100),
      sale: salePriceMinor === null ? "" : String(salePriceMinor / 100),
      withoutLogoRegular: withoutLogoPriceMinor ? String(withoutLogoPriceMinor / 100) : "",
      withoutLogoSale: withoutLogoSalePriceMinor ? String(withoutLogoSalePriceMinor / 100) : "",
      backImageUrl: v.backImageUrl ?? "",
      showAllColourMedia: true,
      defaultMediaIndex: v.defaultMediaIndex ?? 0,
      media: productMedia(v).map(m=>({...m, id: m.id.startsWith("legacy-") ? crypto.randomUUID() : m.id}))
    })) : [newVariant()];
    setEditing(product ? {
      ...product,
      category: product.category ?? "",
      customizable: product.customizable ?? false,
      warranty: product.warrantyIsDemo ? "" : product.warranty ?? "",
      warrantyIsDemo: false,
      variants,
    } : {
      name: "",
      slug: "",
      category: "",
      subtitle: "",
      description: "",
      customizable: false,
      warranty: "",
      warrantyIsDemo: false,
      features: [],
      status: "DRAFT",
      featured: false,
      badge: "",
      sortOrder: 0,
      variants,
    });
    setActiveVariant(variants[0]!.id); setFeatures(product?.features.join("\n") ?? ""); setError(""); setNotice("");
  }
  function changeVariant(id: string, changes: Partial<VariantDraft>) {
    setEditing(p => p && ({...p, variants: p.variants.map(v => v.id === id ? {...v, ...changes} : v)}));
  }
  function removeVariant(id: string, name: string) {
    if (!editing || editing.variants.length <= 1) return;
    const target = editing.variants.find(x => x.id === id);
    const hasDetails = target && (Boolean(target.name.trim()) || Boolean(target.regular.trim()) || (target.media && target.media.length > 0));
    if (hasDetails) {
      if (!window.confirm(`Are you sure you want to remove "${name}"?`)) return;
    }
    const nextVariants = editing.variants.filter(x => x.id !== id);
    setEditing(prev => prev ? { ...prev, variants: nextVariants } : null);
    if (activeVariant === id) {
      const removedIndex = editing.variants.findIndex(x => x.id === id);
      const nextActive = nextVariants[Math.min(removedIndex, nextVariants.length - 1)];
      setActiveVariant(nextActive ? nextActive.id : "");
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editing) return;
    const invalid = editing.variants.find(v =>
      !/^\d+(\.\d{1,2})?$/.test(v.regular) ||
      (v.sale !== "" && !/^\d+(\.\d{1,2})?$/.test(v.sale)) ||
      (v.withoutLogoRegular !== "" && !/^\d+(\.\d{1,2})?$/.test(v.withoutLogoRegular)) ||
      (v.withoutLogoSale !== "" && !/^\d+(\.\d{1,2})?$/.test(v.withoutLogoSale))
    );
    if (invalid) { setSection("colours"); setActiveVariant(invalid.id); setError("Enter regular and sale prices with up to two decimal places."); return; }
    const parsed = ProductInputSchema.safeParse({...editing, variants: editing.variants.map(toVariant), features: features.split("\n").map(s => s.trim()).filter(Boolean)});
    if (!parsed.success) {
      const [field, index, variantField] = parsed.error.issues[0]!.path;
      if (field === "variants") setSection(variantField === "media" ? "media" : "colours");
      else if (field === "warranty" || field === "warrantyIsDemo") setSection("warranty");
      else if (field === "sortOrder" || field === "badge" || field === "status") setSection("publishing");
      else setSection("details");
      if (typeof index === "number") setActiveVariant(editing.variants[index]!.id);
      setError(parsed.error.issues.map(i => `${i.path[0] === "variants" && typeof i.path[1] === "number" ? editing.variants[i.path[1]]?.name || `Colour ${i.path[1] + 1}` : "Product"}: ${i.message}`).join(" · ")); return;
    }
    setBusy(true); setError("");
    try {
      await api<Product>(editing.id ? `/api/v1/products/${editing.id}` : "/api/v1/products", token, {
        method: editing.id ? "PUT" : "POST", body: JSON.stringify({...parsed.data, ...(editing.id ? {version:editing.version} : {})}),
      });
      setEditing(null); setNotice("Product saved. Published changes appear on the storefront automatically."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save product"); }
    finally { setBusy(false); }
  }
  const filtered = items.filter(p => `${p.name} ${p.category ?? ""} ${p.slug} ${p.status}`.toLowerCase().includes(search.toLowerCase()));
  const preview = editing?.variants.find(v => v.id === activeVariant) ?? editing?.variants[0];
  const cover = preview ? productMedia(preview).find(m=>m.type === "image" || (m.type === "video" && m.poster)) : undefined;
  const previewImage = cover?.type === "image" ? cover.url : cover?.type === "video" ? cover.poster : "";
  const previewPrice = preview ? toVariant(preview) : null;
  return <section className="products-admin">
    <div className="catalog-toolbar">
      <div>
        <span className="eyebrow">HARDWARE CATALOG</span>
        <h2>Your card collection</h2>
        <p>{items.length} products · Manage physical cards, finishes, pricing and digital storefront visibility.</p>
      </div>
      <button className="catalog-primary" onClick={() => edit()}>+ New product</button>
    </div>

    <div className="catalog-filters">
      <div className="catalog-search-wrap">
        <span className="search-glyph" aria-hidden="true">🔍</span>
        <input aria-label="Search products" placeholder="Search products or status…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <button className="catalog-secondary" onClick={() => void load()}>Refresh collection</button>
      <a href={`${import.meta.env.VITE_STOREFRONT_URL ?? "http://127.0.0.1:5175"}/#products`} target="_blank" rel="noreferrer" className="catalog-storefront-link">
        View storefront ↗
      </a>
    </div>

    {error && !editing && <p role="alert" className="product-error">{error}</p>}
    {notice && <p role="status" className="catalog-notice">{notice}</p>}
    {!loaded && !error && <p className="empty">Loading products…</p>}

    <div className="product-admin-grid">
      {filtered.map(p => {
        const readyCount = p.variants.filter(variant => printFinish(p.slug, variant.appearance)).length;
        const totalCount = p.variants.length;
        const isReady = readyCount === totalCount && totalCount > 0;
        const primary = p.variants[0];
        const isLight = primary?.appearance === "light" || (primary?.colorHex ? isColorLight(primary.colorHex) : false);
        const cardBg = primary?.colorHex || (isLight ? "#e8e5e0" : "#121316");

        return (
          <article className="product-admin-card" key={p.id}>
            <div className="catalog-card-visual">
              <div
                className={`card-preview-mini ${isLight ? "is-light-card" : "is-dark-card"}`}
                style={{
                  background: isLight
                    ? `radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.15) 50%, rgba(0, 0, 0, 0.05) 100%), ${cardBg}`
                    : `radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.05) 45%, rgba(0, 0, 0, 0.2) 100%), ${cardBg}`
                }}
              >
                <img
                  src={oneinfoLogo}
                  alt="Oneinfo"
                  className="card-mini-center-logo"
                  style={{ filter: isLight ? "none" : "brightness(0) invert(1)" }}
                />
              </div>
            </div>

            <div className="product-admin-card-body">
              <div className="catalog-card-top">
                <span className={`pill ${p.status === "PUBLISHED" ? "success" : ""}`}>{p.status.toLowerCase()}</span>
                {p.variants.every(v => !v.available || v.stockQuantity === 0) ? (
                  <span className="pill is-out-of-stock">Out of stock</span>
                ) : p.variants.some(v => v.stockQuantity !== undefined && v.stockQuantity === 0) ? (
                  <span className="pill is-partial-out-of-stock">Partial out of stock</span>
                ) : null}
                {p.category && <span className="pill catalog-category-pill">{p.category}</span>}
                {p.customizable && <span className="pill info">✦ Customizable</span>}
                {p.featured && <span className="catalog-highlight">★ Homepage highlight</span>}
              </div>

              <h3>{p.name}</h3>
              <p>{p.subtitle || "Smart business card"}</p>

              <div className="catalog-colours">
                <div className="catalog-swatches-stack">
                  {p.variants.map(v => (
                    <span
                      key={v.id}
                      title={`${v.name}${v.available && v.stockQuantity !== 0 ? (v.stockQuantity !== undefined ? ` · ${v.stockQuantity} in stock` : "") : " · out of stock"}`}
                      style={{ background: v.colorHex, opacity: v.available && v.stockQuantity !== 0 ? 1 : 0.35 }}
                    />
                  ))}
                </div>
                <div className="catalog-colours-meta">
                  <small>{p.variants.length} {p.variants.length === 1 ? "colour" : "colours"}</small>
                  {p.variants.some(v => v.stockQuantity !== undefined) && (
                    <small className={`catalog-stock-summary ${p.variants.every(v => !v.available || v.stockQuantity === 0) ? "is-out" : ""}`}>
                      · {p.variants.reduce((sum, v) => sum + (v.stockQuantity ?? 0), 0)} in stock
                    </small>
                  )}
                </div>
              </div>

              <div className={`catalog-print-readiness ${isReady ? "is-ready" : "is-incomplete"}`}>
                <span className="print-status-dot" aria-hidden="true"></span>
                <small>{readyCount}/{totalCount} colours ready for card-back printing</small>
              </div>

              <div className="catalog-card-bottom">
                <div className="product-price-cell">
                  <small className="price-kicker">Pricing</small>
                  <strong>{priceRange(p)}</strong>
                </div>
                <button className="catalog-secondary" onClick={() => edit(p)}>Edit {p.name}</button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
    {loaded && filtered.length === 0 && <p className="empty">No products found.</p>}

    {editing && <dialog ref={dialog} className="product-editor" onCancel={e => { if (busy) e.preventDefault(); else setEditing(null); }} aria-labelledby="product-editor-title">
      <div className="catalog-editor-top">
      <header className="catalog-editor-header"><div><h2 id="product-editor-title">{editing.id ? "Edit product" : "New product"}</h2><p>{editing.name || "Set up your card for the storefront"}</p></div><button type="button" aria-label="Close product editor" disabled={busy} onClick={() => setEditing(null)}>×</button></header>
        <nav className="catalog-editor-nav" aria-label="Product editor sections">
          {editorSections.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={section === id} disabled={busy} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>
      </div>
      <form noValidate onSubmit={e => void save(e)}>
        <div ref={editorScroll} className="catalog-editor-scroll"><fieldset disabled={busy} className="catalog-editor-body"><div className="catalog-editor-fields">
          <section className="catalog-section" hidden={section !== "details"}><h3>Product details</h3><div className="catalog-form-grid">
            <label>Product name<input autoFocus required maxLength={120} value={editing.name} onChange={e => setEditing({...editing,name:e.target.value})} /></label>
            <label>Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={editing.slug} onChange={e => setEditing({...editing,slug:e.target.value})} /><small>Used in the product link, e.g. oneinfo-essential.</small></label>
            <label className="full">Category<input maxLength={80} placeholder="e.g. Essential, Signature, Metal Card" value={editing.category ?? ""} onChange={e => setEditing({...editing, category: e.target.value})} /><small>Used for category filter pills on the customer storefront. Leave blank to default to product name.</small></label>
            <label className="full">Subtitle<input maxLength={100} value={editing.subtitle} onChange={e => setEditing({...editing,subtitle:e.target.value})} /></label>
            <label className="full">Description<textarea rows={2} maxLength={1000} value={editing.description} onChange={e => setEditing({...editing,description:e.target.value})} /></label>
            <label className="full">Features<textarea rows={3} placeholder="One feature per line" value={features} onChange={e => setFeatures(e.target.value)} /><small>One per line, up to 12.</small></label>
            <label className="catalog-check full"><input type="checkbox" checked={editing.customizable} onChange={e => setEditing({...editing,customizable:e.target.checked})} />Allow cardholder name & text customization on storefront</label>
          </div></section>
          <section className="catalog-section" hidden={section !== "warranty"}><h3>Warranty</h3><div className="catalog-form-grid">
            <label className="full">Warranty terms<textarea rows={5} maxLength={2000} placeholder="Duration, what is covered, exclusions, and how to claim…" value={editing.warranty} onChange={e=>setEditing({...editing,warranty:e.target.value})} /><small>Shown in the product’s Warranty section. Leave empty to hide it.</small></label>
          </div></section>
          <section className="catalog-section" hidden={section !== "colours" && section !== "media"}><div className="catalog-section-heading"><div><h3>{section === "media" ? "Media by colour" : "Colours & prices"}</h3><p>{section === "media" ? "Select a colour to manage its images, videos and 360° views." : "Set the price and availability for each colour."}</p></div><button hidden={section === "media"} className="catalog-secondary" type="button" disabled={editing.variants.length >= 40} onClick={() => { const v=newVariant(); setEditing({...editing,variants:[...editing.variants,v]}); setActiveVariant(v.id); }}>+ Add colour</button></div>
            <div className="variant-list">{editing.variants.map((v, index) => {
              const isOnlyOne = editing.variants.length <= 1;
              const colorLabel = v.name || `Colour ${index + 1}`;
              const isOutOfStock = !v.available || v.stockQuantity === 0;
              return (
                <div className={`variant-editor ${activeVariant === v.id ? "is-active" : ""}`} key={v.id}>
                  <div className="variant-header-row">
                    <button
                      type="button"
                      className="variant-heading"
                      aria-expanded={activeVariant === v.id}
                      aria-controls={`variant-${v.id}`}
                      onClick={() => setActiveVariant(current => current === v.id ? "" : v.id)}
                    >
                      <span className="variant-dot" style={{ background: v.colorHex }} />
                      <strong>{colorLabel}</strong>
                      <div className="variant-heading-meta">
                        <span className="variant-heading-price">
                          {v.regular ? money.format(variantPrice(toVariant(v)) / 100) : "Set price"}
                        </span>
                        <span className={`variant-heading-stock ${isOutOfStock ? "is-out" : ""}`}>
                          {!v.available
                            ? "Unavailable"
                            : v.stockQuantity !== undefined
                            ? (v.stockQuantity === 0 ? "Out of stock (0 pcs)" : `${v.stockQuantity} in stock`)
                            : "Untracked stock"}
                        </span>
                      </div>
                      <span className="variant-expand-toggle" aria-hidden="true">
                        {activeVariant === v.id ? "−" : "+"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="variant-delete-btn"
                      title={isOnlyOne ? "Product must have at least one colour" : `Remove ${colorLabel}`}
                      aria-label={`Remove ${colorLabel}`}
                      disabled={isOnlyOne}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeVariant(v.id, colorLabel);
                      }}
                    >
                      <SvgTrashIcon size={15} />
                    </button>
                  </div>
                  {activeVariant === v.id && <div className="variant-fields" id={`variant-${v.id}`}><div className="catalog-form-grid" hidden={section === "media"}>
                    <label>Colour name<input required maxLength={60} value={v.name} placeholder="e.g. Midnight blue" onChange={e => changeVariant(v.id, { name: e.target.value })} /></label>
                    <label>Colour swatch<div className="colour-input"><input aria-label={`Colour swatch for ${v.name || `colour ${index + 1}`}`} type="color" value={v.colorHex} onChange={e => changeVariant(v.id, { colorHex: e.target.value })} /><span>{v.colorHex.toUpperCase()}</span></div></label>
                    <label>{editing.customizable ? "Regular price — With Logo (BDT)" : "Regular price (BDT)"}<input type="number" min="0.01" max="1000000" step="0.01" required value={v.regular} onChange={e => changeVariant(v.id, { regular: e.target.value })} /></label>
                    <label>{editing.customizable ? "Sale price — With Logo (BDT)" : "Sale price (BDT)"}<input type="number" min="0.01" max="1000000" step="0.01" placeholder="No discount" value={v.sale} onChange={e => changeVariant(v.id, { sale: e.target.value })} /><small>Optional. Must be below regular price.</small></label>
                    {editing.customizable && <>
                      <label>Regular price — Without Logo (BDT)<input type="number" min="0.01" max="1000000" step="0.01" placeholder="Default: regular + 500 BDT" value={v.withoutLogoRegular} onChange={e => changeVariant(v.id, { withoutLogoRegular: e.target.value })} /><small>Price when customer selects &ldquo;Without Oneinfo Logo&rdquo;.</small></label>
                      <label>Sale price — Without Logo (BDT)<input type="number" min="0.01" max="1000000" step="0.01" placeholder="Optional sale price" value={v.withoutLogoSale} onChange={e => changeVariant(v.id, { withoutLogoSale: e.target.value })} /><small>Optional discounted price without logo.</small></label>
                    </>}
                    <label>
                      <span>Stock quantity (pcs)</span>
                      <input
                        type="number"
                        min={0}
                        max={1000000}
                        step={1}
                        placeholder="Untracked (leave empty)"
                        value={v.stockQuantity ?? ""}
                        onChange={event => changeVariant(v.id, { stockQuantity: event.target.value === "" ? undefined : Math.max(0, parseInt(event.target.value, 10)) })}
                      />
                      <small>e.g. 100 pcs. Decrements with orders; shows &ldquo;Out of stock&rdquo; and blocks ordering at 0.</small>
                    </label>
                    <label className="catalog-check" style={{ alignSelf: "center", paddingTop: "8px" }}>
                      <input type="checkbox" checked={v.available} onChange={e => changeVariant(v.id, { available: e.target.checked })} />
                      Available to order
                    </label>
                  </div>
                  <div className="catalog-form-grid" hidden={section !== "media"}>
                    <label className="full catalog-default-preview"><span>Default large preview<small>Opens first when this colour is selected.</small></span><select value={v.defaultMediaIndex} onChange={e => changeVariant(v.id, { defaultMediaIndex: Number(e.target.value) })}>{(v.media?.length ? v.media : [null]).map((m, i) => <option value={i} key={m?.id ?? "empty"}>{m ? `${i + 1}. ${m.label || (m.type === "model" ? "3D View" : m.type)}` : "Card illustration"}</option>)}</select></label>
                    <ProductMediaEditor items={v.media ?? []} token={token} onChange={media => changeVariant(v.id, { media, defaultMediaIndex: Math.min(v.defaultMediaIndex, Math.max(0, media.length - 1)), imageUrl: "", backImageUrl: "" })} />
                  </div>{section === "colours" && <PrintSetup slug={editing.slug} appearance={v.appearance} />}
                  <div className="variant-footer" hidden={section === "media"}>
                    <span className={`stock-status-pill ${isOutOfStock ? "is-out" : "is-available"}`}>
                      {!v.available
                        ? "Marked unavailable (Out of stock)"
                        : v.stockQuantity !== undefined
                        ? (v.stockQuantity === 0 ? "Out of stock (0 pcs remaining)" : `In stock (${v.stockQuantity} pcs remaining)`)
                        : "In stock (Untracked quantity)"}
                    </span>
                    <button type="button" className="catalog-remove-btn" disabled={isOnlyOne} title={isOnlyOne ? "Product must have at least one colour" : `Remove ${colorLabel}`} onClick={() => removeVariant(v.id, colorLabel)}>
                      <SvgTrashIcon size={14} />
                      <span>Remove colour</span>
                    </button>
                  </div></div>}
                </div>
              );
            })}</div>
          </section>
          <section className="catalog-section" hidden={section !== "publishing"}><h3>Publishing</h3><div className="catalog-form-grid">
            <label>Status<select value={editing.status} onChange={e => setEditing({...editing,status:e.target.value as ProductInput["status"]})}><option value="DRAFT">Draft · hidden</option><option value="PUBLISHED">Published · visible</option><option value="ARCHIVED">Archived · hidden</option></select></label>
            <label>Display order<input type="number" min={0} max={100000} required value={editing.sortOrder} onChange={e => setEditing({...editing,sortOrder:Number(e.target.value)})} /><small>Lower numbers appear first.</small></label>
            <label className="catalog-check full"><input type="checkbox" checked={editing.featured} onChange={e => setEditing({...editing,featured:e.target.checked})} />Highlight on homepage</label>
            {editing.featured && <label className="full">Highlight badge<input maxLength={40} placeholder="e.g. Most popular" value={editing.badge} onChange={e => setEditing({...editing,badge:e.target.value})} /></label>}
          </div></section>
        </div><aside className="catalog-preview"><p>Card preview</p>{preview && previewPrice && <>
          {editing.customizable ? (
            <div className={`catalog-preview-art ${preview.appearance}`} style={{background:preview.colorHex}}>
              <span>ONEINFO</span>
              <strong>YOUR NAME</strong>
              <small>SMART BUSINESS CARD</small>
              {previewImage && ProductImageSchema.safeParse(previewImage).success && (
                <img src={productMediaUrl(previewImage)} referrerPolicy="no-referrer" alt={preview.name} onError={e => { e.currentTarget.style.visibility="hidden"; }} onLoad={e => { e.currentTarget.style.visibility="visible"; }} />
              )}
            </div>
          ) : (
            <div
              className={`catalog-preview-art original-card-art ${isColorLight(preview.colorHex) || preview.appearance === "light" ? "is-light-card" : "is-dark-card"}`}
              style={{
                background: (isColorLight(preview.colorHex) || preview.appearance === "light")
                  ? `radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.15) 50%, rgba(0, 0, 0, 0.05) 100%), ${preview.colorHex || "#e8e5e0"}`
                  : `radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.05) 45%, rgba(0, 0, 0, 0.2) 100%), ${preview.colorHex || "#121316"}`
              }}
            >
              <img
                src={oneinfoLogo}
                alt="Oneinfo"
                className="card-preview-center-logo"
                style={{
                  filter: (isColorLight(preview.colorHex) || preview.appearance === "light") ? "none" : "brightness(0) invert(1)"
                }}
              />
            </div>
          )}
          <h3>{editing.name || "Your product name"}</h3><p>{preview.name || "Colour name"}</p>
          <div className="catalog-preview-price"><strong>{preview.regular ? money.format(variantPrice(previewPrice) / 100) : "Set a price"}</strong>{previewPrice.salePriceMinor !== null && previewPrice.salePriceMinor > 0 && previewPrice.salePriceMinor < previewPrice.priceMinor && <><del>{money.format(previewPrice.priceMinor / 100)}</del><span>{discountPercent(previewPrice) > 0 ? `${discountPercent(previewPrice)}% off` : "On sale"}</span></>}</div>
          <small>Discount is calculated automatically from this colour’s prices.</small>
        </>}</aside></fieldset></div>
        <footer className="catalog-editor-footer">{error ? <p role="alert" className="product-error">{error}</p> : <p>Changes go live when you save a published product.</p>}<div><button type="button" disabled={busy} className="catalog-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="catalog-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save product"}</button></div></footer>
      </form>
    </dialog>}
  </section>;
}

function PrintSetup({ slug, appearance }: { slug: string; appearance: string }) {
  const finish = printFinish(slug, appearance);
  return <details className="variant-print-setup"><summary>Print setup · {finish ? "Ready" : "Artwork needed"}</summary>
    {finish ? <><p>Back artwork, 92 × 61 mm with bleed, and QR position are set.</p>
      <img className="order-print-preview" loading="lazy" src={printTemplateUrl(finish)} alt="Sample back artwork and QR placement" />
      <small>Sample preview. Prepare an order card to download its unique QR.</small></> :
      <p>Back artwork, print size and QR position need a production template for this colour.</p>}
  </details>;
}
