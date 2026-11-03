import { useState } from "react";
import { ProductImageSchema, type ProductMedia } from "@oneinfo/contracts";

import { productMediaUrl } from "./api.js";

const mediaNames = { image: "Image", video: "Video", spin: "360° view", model: "3D View" };

function ImagePreview({url}: {url:string}) {
  const [size, setSize] = useState<{width:number; height:number} | null>(null);
  const [failed, setFailed] = useState(false);
  if (!url || !ProductImageSchema.safeParse(url).success) return null;
  const vector = /\.svg(?:[?#]|$)/i.test(url);
  const sameRatio = size && Math.abs(size.width / size.height - 4 / 3) <= .01;
  const lowResolution = size && !vector && (size.width < 1600 || size.height < 1200);
  return <figure className="media-image-preview">
    <div><img src={productMediaUrl(url)} alt="Artwork in the storefront frame" onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setFailed(true)} /></div>
    <figcaption role="status" className={failed || (size && (!sameRatio || lowResolution)) ? "media-size-warning" : ""}>{failed ? "Image could not load. Check the URL before saving." : !size ? "Loading image dimensions…" : <>{vector ? "SVG · scalable" : `${size.width} × ${size.height} px`}{!sameRatio ? " · Different ratio: extra space will appear. Use a 1600 × 1200 canvas." : lowResolution ? " · For a sharper image, use 1600 × 1200 px or larger." : " · Fits the storefront frame."}</>}</figcaption>
  </figure>;
}

export function ProductMediaEditor({items, onChange}: {items:ProductMedia[]; onChange:(items:ProductMedia[])=>void}) {
  function update(id:string, changes:object) { onChange(items.map(m => m.id === id ? {...m,...changes} as ProductMedia : m)); }
  function move(index:number, offset:number) {
    const next=[...items]; [next[index],next[index+offset]]=[next[index+offset]!,next[index]!]; onChange(next);
  }
  function add(type:ProductMedia["type"]) {
    const base={id:crypto.randomUUID(),label:""};
    onChange([...items,type === "spin" ? {...base,type,frames:["",""]} : type === "video" ? {...base,type,url:"",poster:""} : {...base,type,url:""}]);
  }
  return <div className="media-editor full">
    <div className="media-editor-heading"><strong>Media gallery</strong><small>First image or poster is the collection cover. Up to 20 items.</small></div>
    <div className="media-size-guide"><strong>Recommended: 1600 × 1200 px</strong><small>Use the same 4:3 canvas and product scale for every colour. SVG artwork can use the same proportions at any resolution. Images, video posters and 360° frames share one fixed frame, without stretching or cropping.</small></div>
    {items.length === 0 && <p>No media yet. Add an image or a video.</p>}
    <div className="media-editor-items">{items.map((m,i) => <div className="media-editor-item" key={m.id}>
      <div className="media-editor-row"><strong>{i+1}. {mediaNames[m.type]}</strong><div><button type="button" aria-label={`Move media ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" aria-label={`Move media ${i+1} down`} disabled={i===items.length-1} onClick={()=>move(i,1)}>↓</button><button type="button" aria-label={`Remove media ${i+1}`} onClick={()=>onChange(items.filter(x=>x.id!==m.id))}>Remove</button></div></div>
      {m.type === "spin" ? <label>360° image frames<textarea rows={5} value={m.frames.join("\n")} placeholder="One image URL per line, in rotation order" onChange={e=>update(m.id,{frames:e.target.value.split("\n")})} /><small>Add 2–120 images of the same product, photographed in rotation order. Customers can drag or use the slider.</small></label> : <label>{m.type === "model" ? "GLB URL" : m.type === "video" ? "Video URL (Google Drive / MP4 / WebM)" : "Image URL (SVG / WebP / PNG / JPG)"}<input value={m.url} placeholder="https://… or /assets/…" onChange={e=>update(m.id,{url:e.target.value})} />{m.type === "model" && <small>Use a direct HTTPS .glb link or a bundled /assets/ path.</small>}{m.type === "video" && <small>Use a 4:3 video, ideally 1600 × 1200. For Drive, paste the file share link with Anyone with the link access.</small>}</label>}
      {m.type === "model" && <button type="button" className="catalog-secondary" onClick={e=>{e.preventDefault(); update(m.id,{url:"/assets/essential/black-demo.glb"});}}>Use demo model</button>}
      {m.type !== "model" && <ImagePreview key={m.type === "image" ? m.url : m.type === "video" ? m.poster : m.frames[0]} url={m.type === "image" ? m.url : m.type === "video" ? m.poster : m.frames[0] ?? ""} />}
    </div>)}</div>
    <div className="media-editor-add">{(["image","video","model"] as const).map(type=><button className="catalog-secondary" type="button" key={type} disabled={items.length>=20} onClick={()=>add(type)}>+ {mediaNames[type]}</button>)}</div>
    <small>Paste a direct HTTPS media URL or a bundled /assets/ path.</small>
  </div>;
}
