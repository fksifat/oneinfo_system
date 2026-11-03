import { describe, it, expect } from "vitest";
import { ProductInputSchema, UpdateProductSchema, productMedia, productGallery, discountPercent, variantPrice } from "../../../packages/contracts/src/index.js";
import { reconcileCartItems, productRoute, spinFrame } from "../../../sites/storefront/catalog.js";
const variant = { id:"01800000-0000-4000-8000-000000000011", name:"White", colorHex:"#ffffff", priceMinor:129000, salePriceMinor:null, available:true, finish:"Satin", appearance:"light", imageUrl:"" };
const product = { id:"01800000-0000-4000-8000-000000000001", name:"Example card", slug:"example-card", variants:[variant] };
const blue = {...variant, id:"01800000-0000-4000-8000-000000000012", name:"Blue", colorHex:"#193c66", priceMinor:200000, salePriceMinor:150000};
describe("catalog input boundaries", () => {
  it("defaults products to drafts and permits an empty image", () => {
    const parsed=ProductInputSchema.parse(product);
    expect(parsed.status).toBe("DRAFT"); expect(parsed.variants[0].imageUrl).toBe("");
  });
  it("rejects invalid money and misleading discounts", () => {
    for (const priceMinor of [-1, 0, 1.1, 100000001]) expect(ProductInputSchema.safeParse({...product,variants:[{...variant,priceMinor}]}).success).toBe(false);
    for (const salePriceMinor of [-1,0,129000,130000,1.1]) expect(ProductInputSchema.safeParse({...product,variants:[{...variant,salePriceMinor}]}).success).toBe(false);
  });
  it("validates image URLs, hex colours, unique IDs and colour names", () => {
    for (const imageUrl of ["javascript:alert(1)","data:image/svg+xml,foo","http://example.com/photo.png"]) expect(ProductInputSchema.safeParse({...product,variants:[{...variant,imageUrl}]}).success).toBe(false);
    for (const variants of [[],[variant,variant],[variant,{...blue,name:" white "}],[{...variant,colorHex:"red;display:none"}]]) expect(ProductInputSchema.safeParse({...product,variants}).success).toBe(false);
    expect(ProductInputSchema.safeParse({...product,variants:[variant,blue]}).success).toBe(true);
  });
  it("requires a version, bounds features and validates status", () => {
    expect(UpdateProductSchema.safeParse(product).success).toBe(false);
    expect(ProductInputSchema.safeParse({...product,features:Array(13).fill("Feature")}).success).toBe(false);
    expect(ProductInputSchema.safeParse({...product,status:"DELETED"}).success).toBe(false);
  });
  it("uses sale price and computes discounts without overstating savings", () => {
    expect(variantPrice(variant)).toBe(129000); expect(variantPrice(blue)).toBe(150000);
    expect(discountPercent(blue)).toBe(25); expect(discountPercent(variant)).toBe(0);
    expect(discountPercent({...blue,priceMinor:300,salePriceMinor:200})).toBe(33);
    expect(discountPercent({...blue,priceMinor:10000,salePriceMinor:9999})).toBe(0);
  });
});
describe("variant cart reconciliation", () => {
  const catalog=[{...product,variants:[variant,blue]}];
  it("keeps colours separate, reprices and merges only identical variants", () => {
    const items=reconcileCartItems([{id:product.id,variantId:variant.id,quantity:1},{id:product.id,variantId:blue.id,priceMinor:1,quantity:2},{id:product.id,variantId:blue.id,quantity:1}],catalog);
    expect(items).toHaveLength(2); expect(items[1]).toMatchObject({variantName:"Blue",priceMinor:150000,quantity:3});
  });
  it("drops missing/unavailable colours without silently substituting another", () => {
    const cart=[{id:product.id,variantId:blue.id,quantity:1}];
    expect(reconcileCartItems(cart,[product])).toEqual([]);
    expect(reconcileCartItems(cart,[{...product,variants:[{...blue,available:false}]}])).toEqual([]);
    expect(reconcileCartItems(cart,[])).toEqual([]);
  });
  it("migrates old carts to the original colour and bounds quantities", () => {
    expect(reconcileCartItems([{name:product.name,quantity:120}],catalog)[0]).toMatchObject({variantId:variant.id,quantity:99});
    expect(reconcileCartItems([{id:product.id,quantity:-1},{id:product.id,quantity:1.5}],catalog)).toEqual([]);
  });
});

describe("product detail routes", () => {
  it("keeps collection anchors separate from product routes", () => {
    expect(productRoute("#products")).toBeNull();
    expect(productRoute("#how")).toBeNull();
    expect(productRoute("#product/oneinfo-essential")).toEqual({slug:"oneinfo-essential",variantId:null});
  });
  it("preserves the selected colour and handles malformed URLs", () => {
    expect(productRoute("#product/oneinfo-essential?colour=white")).toEqual({slug:"oneinfo-essential",variantId:"white"});
    expect(productRoute("#product/%broken")).toEqual({slug:"",variantId:null});
  });
});

describe("product artwork URLs", () => {
  it("accepts bundled front/back artwork and preserves older products", () => {
    const parsed=ProductInputSchema.parse({...product,variants:[{...variant,imageUrl:"/assets/essential/light-front.webp",backImageUrl:"/assets/essential/light-back.webp"}]});
    expect(parsed.variants[0].backImageUrl).toBe("/assets/essential/light-back.webp");
    expect(ProductInputSchema.parse(product).variants[0].backImageUrl).toBe("");
  });
  it("rejects external protocol-relative URLs and path traversal", () => {
    for (const backImageUrl of ["//evil.example/image.png","/assets/../private.png","/other/image.png","javascript:alert(1)"])
      expect(ProductInputSchema.safeParse({...product,variants:[{...variant,backImageUrl}]}).success).toBe(false);
  });
});

describe("product media gallery", () => {
  const image={id:"01800000-0000-4000-8000-000000000021",type:"image",url:"/assets/card.svg"};
  const video={id:"01800000-0000-4000-8000-000000000022",type:"video",url:"/assets/card.mp4"};
  const spin={id:"01800000-0000-4000-8000-000000000023",type:"spin",frames:["/assets/one.webp","/assets/two.webp"]};
  it("accepts ordered mixed media and optional captions/posters", () => {
    const p=ProductInputSchema.parse({...product,variants:[{...variant,media:[video,image,spin]}]});
    expect(p.variants[0].media?.map(m=>m.type)).toEqual(["video","image","spin"]);
  });
  it("rejects invalid URLs, empty spins and duplicated IDs", () => {
    for(const media of [[{...video,url:"javascript:alert(1)"}],[{...image,url:"//bad.example/a.svg"}],[{...spin,frames:["/assets/one.webp"]}],[image,image],Array(21).fill(image)])
      expect(ProductInputSchema.safeParse({...product,variants:[{...variant,media}]}).success).toBe(false);
  });
  it("retains older images but honours explicitly empty galleries", () => {
    const old={imageUrl:"/assets/a.svg",backImageUrl:"/assets/b.svg"};
    expect(productMedia(old).map(m=>m.url)).toEqual(["/assets/a.svg","/assets/b.svg"]);
    expect(productMedia({...old,media:[]})).toEqual([]);
  });
  it("wraps 360 frames in both directions", () => {
    expect(spinFrame(0,16,12)).toBe(2); expect(spinFrame(0,-8,12)).toBe(11);
    expect(spinFrame(11,8,12)).toBe(0); expect(spinFrame(0,8,0)).toBe(0);
  });
});

describe("gallery colour selection", () => {
  const white=ProductInputSchema.parse(product).variants[0];
  const black={...white,id:"01800000-0000-4000-8000-000000000099",name:"Black",imageUrl:"/assets/black.svg"};
  const light={...white,imageUrl:"/assets/light.svg"};
  it("includes all colour media by default with stable colour/index mapping", () => {
    const items=productGallery([light,black],black);
    expect(items.map(x=>x.variant.name)).toEqual(["White","Black"]);
    expect(items.map(x=>x.index)).toEqual([0,0]);
  });
  it("allows the admin to limit media to a selected colour", () => {
    expect(productGallery([light,black],{...black,showAllColourMedia:false})).toHaveLength(1);
    expect(ProductInputSchema.safeParse({...product,variants:[{...light,defaultMediaIndex:20}]}).success).toBe(false);
    expect(ProductInputSchema.parse(product).variants[0].defaultMediaIndex).toBe(0);
  });
});
