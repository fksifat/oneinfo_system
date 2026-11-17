import { catalogVariantId, productMedia, resolveProductImageUrl, variantPrice, type Product } from "@oneinfo/contracts";

const columns = ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "brand", "item_group_id", "color"].join(",");
const bdt = (minor: number) => `${(minor / 100).toFixed(2)} BDT`;
const csvCell = (value: string) => {
  const text = value.replace(/\s+/g, " ").trim();
  return `"${(/^[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
};

type CatalogProduct = Pick<Product, "id" | "slug" | "name" | "description" | "subtitle" | "variants">;

export function metaCatalogCsv(products: CatalogProduct[], storefrontUrl: string) {
  const storefront = new URL("/", storefrontUrl);
  const rows = products.flatMap(product => product.variants.flatMap(variant => {
    const source = productMedia(variant).map(item => item.type === "image" ? item.url : item.type === "video" ? item.poster : "")
      .find(Boolean) || variant.imageUrl;
    const image = source && URL.parse(resolveProductImageUrl(source), storefront);
    if (!image || image.protocol !== "https:" || image.username || image.password) return [];

    const title = `${product.name} – ${variant.name}`;
    const link = new URL(storefront);
    link.hash = `product/${encodeURIComponent(product.slug)}?colour=${encodeURIComponent(variant.id)}`;
    const sale = variantPrice(variant);
    return [[catalogVariantId(product.id, variant.id), title, product.description || product.subtitle || title,
      variant.available && variant.stockQuantity !== 0 ? "in stock" : "out of stock", "new", bdt(variant.priceMinor),
      sale < variant.priceMinor ? bdt(sale) : "", link.href, image.href, "Oneinfo", product.id, variant.name].map(csvCell).join(",")];
  }));
  return [columns, ...rows].join("\r\n") + "\r\n";
}
