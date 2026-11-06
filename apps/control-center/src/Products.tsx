import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { ProductImageSchema, ProductInputSchema, productMedia, discountPercent, variantPrice, type Product, type ProductInput, type ProductVariant } from "@oneinfo/contracts";
import { api, productMediaUrl } from "./api.js";
import { ProductMediaEditor } from "./ProductMediaEditor.js";

type VariantDraft = Omit<ProductVariant, "priceMinor" | "salePriceMinor"> & { regular: string; sale: string };
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
const newVariant = (): VariantDraft => ({ id: crypto.randomUUID(), name: "", colorHex: "#143534", regular: "", sale: "", available: true, finish: "", appearance: "dark", imageUrl: "", backImageUrl: "", showAllColourMedia:true, defaultMediaIndex:0, media:[] });
const toVariant = ({ regular, sale, ...v }: VariantDraft): ProductVariant => ({ ...v, media:v.media?.map(m=>m.type === "spin" ? {...m,frames:m.frames.map(f=>f.trim()).filter(Boolean)} : m), priceMinor: Math.round(Number(regular) * 100), salePriceMinor: sale === "" ? null : Math.round(Number(sale) * 100) });
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
    const variants = product ? product.variants.map(({priceMinor, salePriceMinor, ...v}) => ({...v, regular: String(priceMinor / 100), sale: salePriceMinor === null ? "" : String(salePriceMinor / 100), backImageUrl: v.backImageUrl ?? "", showAllColourMedia:true, defaultMediaIndex:v.defaultMediaIndex ?? 0, media:productMedia(v).map(m=>({...m,id: m.id.startsWith("legacy-") ? crypto.randomUUID() : m.id}))})) : [newVariant()];
    setEditing(product ? {...product, warranty:product.warrantyIsDemo ? "" : product.warranty ?? "", warrantyIsDemo:false, variants} : {name:"", slug:"", subtitle:"", description:"", warranty:"", warrantyIsDemo:false, features:[], status:"DRAFT", featured:false, badge:"", sortOrder:0, variants});
    setActiveVariant(variants[0]!.id); setFeatures(product?.features.join("\n") ?? ""); setError(""); setNotice("");
  }
  function changeVariant(id: string, changes: Partial<VariantDraft>) {
    setEditing(p => p && ({...p, variants: p.variants.map(v => v.id === id ? {...v, ...changes} : v)}));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editing) return;
    const invalid = editing.variants.find(v => !/^\d+(\.\d{1,2})?$/.test(v.regular) || (v.sale !== "" && !/^\d+(\.\d{1,2})?$/.test(v.sale)));
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
  const filtered = items.filter(p => `${p.name} ${p.slug} ${p.status}`.toLowerCase().includes(search.toLowerCase()));
  const preview = editing?.variants.find(v => v.id === activeVariant) ?? editing?.variants[0];
  const cover = preview ? productMedia(preview).find(m=>m.type === "image" || (m.type === "video" && m.poster)) : undefined;
  const previewImage = cover?.type === "image" ? cover.url : cover?.type === "video" ? cover.poster : "";
  const previewPrice = preview ? toVariant(preview) : null;
  return <section className="products-admin">
    <div className="catalog-toolbar"><div><h2>Your card collection</h2><p>{items.length} products · Manage colours, pricing and visibility.</p></div><button className="catalog-primary" onClick={() => edit()}>+ New product</button></div>
    <div className="catalog-filters"><input aria-label="Search products" placeholder="Search products or status…" value={search} onChange={e => setSearch(e.target.value)} /><button className="catalog-secondary" onClick={() => void load()}>Refresh collection</button><a href={`${import.meta.env.VITE_STOREFRONT_URL ?? "http://127.0.0.1:5175"}/#products`} target="_blank" rel="noreferrer">View storefront ↗</a></div>
    {error && !editing && <p role="alert" className="product-error">{error}</p>}{notice && <p role="status" className="catalog-notice">{notice}</p>}
    {!loaded && !error && <p>Loading products…</p>}
    <div className="product-admin-grid">{filtered.map(p => <article className="product-admin-card" key={p.id}>
      <div className="catalog-card-top"><span className={`pill ${p.status === "PUBLISHED" ? "success" : ""}`}>{p.status.toLowerCase()}</span>{p.featured && <span className="catalog-highlight">Homepage highlight</span>}</div>
      <h3>{p.name}</h3><p>{p.subtitle || "Smart business card"}</p>
      <div className="catalog-colours">{p.variants.map(v => <span key={v.id} title={`${v.name}${v.available ? "" : " · unavailable"}`} style={{background:v.colorHex, opacity:v.available ? 1 : .35}} />)}<small>{p.variants.length} {p.variants.length === 1 ? "colour" : "colours"}</small></div>
      <div className="catalog-card-bottom"><strong>{priceRange(p)}</strong><button className="catalog-secondary" onClick={() => edit(p)}>Edit {p.name}</button></div>
    </article>)}</div>{loaded && filtered.length === 0 && <p>No products found.</p>}
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
            <label className="full">Subtitle<input maxLength={100} value={editing.subtitle} onChange={e => setEditing({...editing,subtitle:e.target.value})} /></label>
            <label className="full">Description<textarea rows={2} maxLength={1000} value={editing.description} onChange={e => setEditing({...editing,description:e.target.value})} /></label>
            <label className="full">Features<textarea rows={3} placeholder="One feature per line" value={features} onChange={e => setFeatures(e.target.value)} /><small>One per line, up to 12.</small></label>
          </div></section>
          <section className="catalog-section" hidden={section !== "warranty"}><h3>Warranty</h3><div className="catalog-form-grid">
            <label className="full">Warranty terms<textarea rows={5} maxLength={2000} placeholder="Duration, what is covered, exclusions, and how to claim…" value={editing.warranty} onChange={e=>setEditing({...editing,warranty:e.target.value})} /><small>Shown in the product’s Warranty section. Leave empty to hide it.</small></label>
          </div></section>
          <section className="catalog-section" hidden={section !== "colours" && section !== "media"}><div className="catalog-section-heading"><div><h3>{section === "media" ? "Media by colour" : "Colours & prices"}</h3><p>{section === "media" ? "Select a colour to manage its images, videos and 360° views." : "Set the price and availability for each colour."}</p></div><button hidden={section === "media"} className="catalog-secondary" type="button" disabled={editing.variants.length >= 40} onClick={() => { const v=newVariant(); setEditing({...editing,variants:[...editing.variants,v]}); setActiveVariant(v.id); }}>+ Add colour</button></div>
            <div className="variant-list">{editing.variants.map((v, index) => <div className={`variant-editor ${activeVariant === v.id ? "is-active" : ""}`} key={v.id}>
              <button type="button" className="variant-heading" aria-expanded={activeVariant === v.id} aria-controls={`variant-${v.id}`} onClick={() => setActiveVariant(current => current === v.id ? "" : v.id)}><span className="variant-dot" style={{background:v.colorHex}} /><strong>{v.name || `Colour ${index + 1}`}</strong><span>{v.available ? (v.regular ? money.format(variantPrice(toVariant(v)) / 100) : "Set price") : "Unavailable"}</span><span aria-hidden="true">{activeVariant === v.id ? "−" : "+"}</span></button>
              {activeVariant === v.id && <div className="variant-fields" id={`variant-${v.id}`}><div className="catalog-form-grid" hidden={section === "media"}>
                <label>Colour name<input required maxLength={60} value={v.name} placeholder="e.g. Midnight blue" onChange={e => changeVariant(v.id,{name:e.target.value})} /></label>
                <label>Colour swatch<div className="colour-input"><input aria-label={`Colour swatch for ${v.name || `colour ${index+1}`}`} type="color" value={v.colorHex} onChange={e => changeVariant(v.id,{colorHex:e.target.value})} /><span>{v.colorHex.toUpperCase()}</span></div></label>
                <label>Regular price (BDT)<input type="number" min="0.01" max="1000000" step="0.01" required value={v.regular} onChange={e => changeVariant(v.id,{regular:e.target.value})} /></label>
                <label>Sale price (BDT)<input type="number" min="0.01" max="1000000" step="0.01" placeholder="No discount" value={v.sale} onChange={e => changeVariant(v.id,{sale:e.target.value})} /><small>Optional. Must be below the regular price.</small></label>
              </div>
              <div className="catalog-form-grid" hidden={section !== "media"}>
                <label className="full catalog-default-preview"><span>Default large preview<small>Opens first when this colour is selected.</small></span><select value={v.defaultMediaIndex} onChange={e=>changeVariant(v.id,{defaultMediaIndex:Number(e.target.value)})}>{(v.media?.length ? v.media : [null]).map((m,i)=><option value={i} key={m?.id ?? "empty"}>{m ? `${i+1}. ${m.label || (m.type === "model" ? "3D View" : m.type)}` : "Card illustration"}</option>)}</select></label>
                <ProductMediaEditor items={v.media ?? []} token={token} onChange={media=>changeVariant(v.id,{media,defaultMediaIndex:Math.min(v.defaultMediaIndex,Math.max(0,media.length-1)),imageUrl:"",backImageUrl:""})} />
              </div><div className="variant-footer" hidden={section === "media"}><label className="catalog-check"><input type="checkbox" checked={v.available} onChange={e => changeVariant(v.id,{available:e.target.checked})} />Available to order</label>
                <label>Stock quantity <input type="number" min={0} max={1000000} step={1} placeholder="Untracked" value={v.stockQuantity ?? ""}
                  onChange={event => changeVariant(v.id, { stockQuantity: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                <button type="button" className="catalog-remove" disabled={editing.variants.length === 1} onClick={() => { const variants=editing.variants.filter(x => x.id !== v.id); setEditing({...editing,variants}); setActiveVariant(variants[0]!.id); }}>Remove colour</button></div></div>}
            </div>)}</div>
          </section>
          <section className="catalog-section" hidden={section !== "publishing"}><h3>Publishing</h3><div className="catalog-form-grid">
            <label>Status<select value={editing.status} onChange={e => setEditing({...editing,status:e.target.value as ProductInput["status"]})}><option value="DRAFT">Draft · hidden</option><option value="PUBLISHED">Published · visible</option><option value="ARCHIVED">Archived · hidden</option></select></label>
            <label>Display order<input type="number" min={0} max={100000} required value={editing.sortOrder} onChange={e => setEditing({...editing,sortOrder:Number(e.target.value)})} /><small>Lower numbers appear first.</small></label>
            <label className="catalog-check full"><input type="checkbox" checked={editing.featured} onChange={e => setEditing({...editing,featured:e.target.checked})} />Highlight on homepage</label>
            {editing.featured && <label className="full">Highlight badge<input maxLength={40} placeholder="e.g. Most popular" value={editing.badge} onChange={e => setEditing({...editing,badge:e.target.value})} /></label>}
          </div></section>
        </div><aside className="catalog-preview"><p>Card preview</p>{preview && previewPrice && <>
          <div className={`catalog-preview-art ${preview.appearance}`} style={{background:preview.colorHex}}><span>ONEINFO</span><strong>YOUR NAME</strong><small>SMART BUSINESS CARD</small>{previewImage && ProductImageSchema.safeParse(previewImage).success && <img src={productMediaUrl(previewImage)} referrerPolicy="no-referrer" alt={preview.name} onError={e => { e.currentTarget.style.visibility="hidden"; }} onLoad={e => { e.currentTarget.style.visibility="visible"; }} />}</div>
          <h3>{editing.name || "Your product name"}</h3><p>{preview.name || "Colour name"}</p>
          <div className="catalog-preview-price"><strong>{preview.regular ? money.format(variantPrice(previewPrice) / 100) : "Set a price"}</strong>{previewPrice.salePriceMinor !== null && previewPrice.salePriceMinor > 0 && previewPrice.salePriceMinor < previewPrice.priceMinor && <><del>{money.format(previewPrice.priceMinor / 100)}</del><span>{discountPercent(previewPrice) > 0 ? `${discountPercent(previewPrice)}% off` : "On sale"}</span></>}</div>
          <small>Discount is calculated automatically from this colour’s prices.</small>
        </>}</aside></fieldset></div>
        <footer className="catalog-editor-footer">{error ? <p role="alert" className="product-error">{error}</p> : <p>Changes go live when you save a published product.</p>}<div><button type="button" disabled={busy} className="catalog-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="catalog-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save product"}</button></div></footer>
      </form>
    </dialog>}
  </section>;
}
