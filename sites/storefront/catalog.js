import { variantPrice } from '@oneinfo/contracts';

export function addCartVariant(cart, product, variant, quantity) {
  if (!variant.available || !Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    throw new RangeError('Choose an available colour and a quantity from 1 to 99.');
  const existing = cart.find(item => item.id === product.id && item.variantId === variant.id);
  if ((existing?.quantity ?? 0) + quantity > 99) throw new RangeError('You can add up to 99 cards of each colour.');
  const item = { id:product.id, variantId:variant.id, name:product.name, variantName:variant.name, colorHex:variant.colorHex, priceMinor:variantPrice(variant), quantity:(existing?.quantity ?? 0) + quantity };
  return existing ? cart.map(previous => previous === existing ? item : previous) : [...cart, item];
}

export function reconcileCartItems(cart, products) {
  const merged = new Map();
  for (const item of cart) {
    if (!item || !Number.isInteger(item.quantity) || item.quantity < 1) continue;
    const product = products.find(p => p.id === item.id || (!item.id && p.name === item.name));
    if (!product) continue;
    // Legacy carts predate colour selection; new carts never switch a missing colour.
    const variant = item.variantId ? product.variants.find(v => v.id === item.variantId) : product.variants[0];
    if (!variant?.available) continue;
    const key = `${product.id}:${variant.id}`;
    const quantity = Math.min(99, (merged.get(key)?.quantity ?? 0) + item.quantity);
    merged.set(key, { id: product.id, variantId: variant.id, name: product.name, variantName: variant.name, colorHex: variant.colorHex, priceMinor: variantPrice(variant), quantity });
  }
  return [...merged.values()];
}

export function productRoute(hash) {
  if (!hash.startsWith('#product/')) return null;
  try {
    const [slug, query = ''] = hash.slice(9).split('?');
    return { slug: decodeURIComponent(slug), variantId: new URLSearchParams(query).get('colour') };
  } catch { return { slug: '', variantId: null }; }
}

export function spinFrame(start, distance, count) {
  if (count < 1) return 0;
  return ((start + Math.round(distance / 8)) % count + count) % count;
}
