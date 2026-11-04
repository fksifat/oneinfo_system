import { useRef, useState } from "react";
import { ProductImageSchema, type ProductMedia } from "@oneinfo/contracts";

import { productMediaUrl, uploadProductMedia } from "./api.js";

const mediaNames = { image: "Image", video: "Video", spin: "360° view", model: "3D View" };

async function prepareImage(file: File) {
  const extension = file.name.toLowerCase().endsWith(".svg") ? "svg" : file.name.toLowerCase().endsWith(".png") ? "png" : file.name.toLowerCase().endsWith(".webp") ? "webp" : "jpg";
  if (extension === "svg") return { blob: file, extension };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bitmap.width, 1200 / bitmap.height);
    if (scale === 1 && file.size < 700 * 1024) { bitmap.close(); return { blob: file, extension }; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const optimized = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .86));
    return optimized?.type === "image/webp" && optimized.size < file.size ? { blob: optimized, extension: "webp" } : { blob: file, extension };
  } catch { return { blob: file, extension }; }
}

function ImagePreview({url}: {url:string}) {
  const [size, setSize] = useState<{width:number; height:number} | null>(null);
  const [failed, setFailed] = useState(false);
  if (!url || !ProductImageSchema.safeParse(url).success) return null;
  const vector = /\.svg(?:[?#]|$)/i.test(url);
  const sameRatio = size && Math.abs(size.width / size.height - 4 / 3) <= .01;
  const lowResolution = size && !vector && (size.width < 1600 || size.height < 1200);
  return <figure className="media-image-preview">
    <div><img src={productMediaUrl(url)} alt="Artwork in the storefront frame" referrerPolicy="no-referrer" onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setFailed(true)} /></div>
    <figcaption role="status" className={failed || (size && (!sameRatio || lowResolution)) ? "media-size-warning" : ""}>{failed ? "Image could not load. Check the file or URL." : !size ? "Loading image dimensions…" : <>{vector ? "SVG · scalable" : `${size.width} × ${size.height} px`}{!sameRatio ? " · Different ratio: extra space will appear. Use a 1600 × 1200 canvas." : lowResolution ? " · For a sharper image, use 1600 × 1200 px or larger." : " · Fits the storefront frame."}</>}</figcaption>
  </figure>;
}

export function ProductMediaEditor({items, onChange, token}: {items:ProductMedia[]; onChange:(items:ProductMedia[])=>void; token:string}) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState("");
  function commit(next:ProductMedia[]) { itemsRef.current = next; onChange(next); }
  function update(id:string, changes:object) { commit(itemsRef.current.map(m => m.id === id ? {...m,...changes} as ProductMedia : m)); }
  function move(index:number, offset:number) {
    const next=[...itemsRef.current]; [next[index],next[index+offset]]=[next[index+offset]!,next[index]!]; commit(next);
  }
  function add(type:ProductMedia["type"]) {
    const base={id:crypto.randomUUID(),label:""};
    commit([...itemsRef.current,type === "spin" ? {...base,type,frames:["",""]} : type === "video" ? {...base,type,url:"",poster:""} : {...base,type,url:""}]);
  }
  async function upload(id:string, type:ProductMedia["type"], files:File[]) {
    if (!files.length) return;
    setError(""); setUploading(current=>[...current,id]);
    try {
      if (type === "spin") {
        const selected = files.slice(0,120).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        if (!selected.length) throw new Error("A 360° gallery can contain up to 120 frames.");
        const urls: string[] = [];
        for (let i=0;i<selected.length;i+=4) {
          const batch = await Promise.all(selected.slice(i,i+4).map(async file=>{
            const prepared = await prepareImage(file);
            return uploadProductMedia(prepared.blob,prepared.extension,token);
          }));
          urls.push(...batch);
        }
        update(id,{frames:urls});
      } else {
        const file = files[0]!;
        const prepared = type === "image" ? await prepareImage(file) : {blob:file,extension:type === "model" ? "glb" : file.name.toLowerCase().endsWith(".webm") ? "webm" : "mp4"};
        update(id,{url:await uploadProductMedia(prepared.blob,prepared.extension,token)});
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed. Try again."); }
    finally { setUploading(current=>current.filter(item=>item!==id)); }
  }
  return <div className="media-editor full">
    <div className="media-editor-heading"><strong>Media gallery</strong><small>First image or poster is the collection cover. Up to 20 items.</small></div>
    <div className="media-size-guide"><strong>Recommended: 1600 × 1200 px</strong><small>Upload media directly from your device. Large raster images are reduced and converted to WebP when that makes the file smaller. Uploaded media is served from Oneinfo with long term browser caching.</small></div>
    {items.length === 0 && <p>No media yet. Add an image or a video.</p>}
    <div className="media-editor-items">{items.map((m,i) => <div className="media-editor-item" key={m.id}>
      <div className="media-editor-row"><strong>{i+1}. {mediaNames[m.type]}</strong><div><button type="button" aria-label={`Move media ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" aria-label={`Move media ${i+1} down`} disabled={i===items.length-1} onClick={()=>move(i,1)}>↓</button><button type="button" aria-label={`Remove media ${i+1}`} onClick={()=>commit(itemsRef.current.filter(x=>x.id!==m.id))}>Remove</button></div></div>
      {m.type === "spin" ? <>
        <small>{m.frames.filter(Boolean).length} frames set · Choose all 360° images together, in rotation order (up to 120). Uploading replaces the current frames.</small>
        <label className="media-upload">{uploading.includes(m.id) ? "Uploading frames…" : "Choose 360° frames"}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple disabled={uploading.includes(m.id)} onChange={e=>{void upload(m.id,m.type,Array.from(e.currentTarget.files ?? [])); e.currentTarget.value="";}} /></label>
      </> : <>
        <small>{m.url ? "A media file is set. Choose a new file to replace it." : "No file selected."}{m.type === "video" ? " Use a 4:3 video; maximum 10 MB." : m.type === "model" ? " GLB only; maximum 10 MB." : ""}</small>
        <label className="media-upload">{uploading.includes(m.id) ? "Uploading…" : m.url ? `Replace ${mediaNames[m.type].toLowerCase()}` : `Choose ${mediaNames[m.type].toLowerCase()}`}<input type="file" accept={m.type === "image" ? "image/png,image/jpeg,image/webp,image/svg+xml" : m.type === "video" ? "video/mp4,video/webm" : ".glb,model/gltf-binary"} disabled={uploading.includes(m.id)} onChange={e=>{void upload(m.id,m.type,Array.from(e.currentTarget.files ?? [])); e.currentTarget.value="";}} /></label>
      </>}
      {m.type !== "model" && <ImagePreview key={m.type === "image" ? m.url : m.type === "video" ? m.poster : m.frames[0]} url={m.type === "image" ? m.url : m.type === "video" ? m.poster : m.frames[0] ?? ""} />}
    </div>)}</div>
    <div className="media-editor-add">{(["image","video","model"] as const).map(type=><button className="catalog-secondary" type="button" key={type} disabled={items.length>=20} onClick={()=>add(type)}>+ {mediaNames[type]}</button>)}</div>
    {error && <p role="alert" className="media-upload-error">{error}</p>}
    <small>Save the product after uploading. Uploaded media will be used on the storefront after the product is saved.</small>
  </div>;
}
