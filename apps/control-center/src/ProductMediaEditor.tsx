import type { ProductMedia } from "@oneinfo/contracts";

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
    {items.length === 0 && <p>No media yet. Add an image, a video or a 360° view.</p>}
    {items.map((m,i) => <div className="media-editor-item" key={m.id}>
      <div className="media-editor-row"><strong>{i+1}. {m.type === "spin" ? "360° view" : m.type === "video" ? "Video" : "Image"}</strong><div><button type="button" aria-label={`Move media ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" aria-label={`Move media ${i+1} down`} disabled={i===items.length-1} onClick={()=>move(i,1)}>↓</button><button type="button" aria-label={`Remove media ${i+1}`} onClick={()=>onChange(items.filter(x=>x.id!==m.id))}>Remove</button></div></div>
      <label>Caption<input maxLength={80} value={m.label} placeholder="e.g. Card close-up" onChange={e=>update(m.id,{label:e.target.value})} /></label>
      {m.type === "spin" ? <label>360° image frames<textarea rows={5} value={m.frames.join("\n")} placeholder="One image URL per line, in rotation order" onChange={e=>update(m.id,{frames:e.target.value.split("\n")})} /><small>Add 2–120 images of the same product, photographed in rotation order. Customers can drag or use the slider.</small></label> : <label>{m.type === "video" ? "Video URL (MP4 / WebM)" : "Image URL (SVG / WebP / PNG / JPG)"}<input value={m.url} placeholder="https://… or /assets/…" onChange={e=>update(m.id,{url:e.target.value})} /></label>}
      {m.type === "video" && <label>Poster image (optional)<input value={m.poster} placeholder="https://… or /assets/…" onChange={e=>update(m.id,{poster:e.target.value})} /></label>}
    </div>)}
    <div className="media-editor-add">{(["image","video","spin"] as const).map(type=><button className="catalog-secondary" type="button" key={type} disabled={items.length>=20} onClick={()=>add(type)}>+ {type === "spin" ? "360° view" : type === "video" ? "Video" : "Image"}</button>)}</div>
    <small>Paste hosted HTTPS URLs or bundled /assets/ paths. No file upload is required.</small>
  </div>;
}
