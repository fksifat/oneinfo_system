import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { orderDesignExtensions } from "@oneinfo/contracts";

export const orderDesignDirectory = resolve(process.env.PRODUCT_MEDIA_DIR || fileURLToPath(new URL("../../../../.product-media", import.meta.url)), "order-designs");

export function validOrderDesign(extension: typeof orderDesignExtensions[number], file: Buffer) {
  const header = file.toString("latin1", 0, 128);
  const pdf = header.startsWith("%PDF-");
  const postscript = header.startsWith("%!PS-Adobe");
  const binaryEps = file.toString("hex", 0, 4) === "c5d0d3c6";
  switch (extension) {
    case "png": return file.toString("hex", 0, 8) === "89504e470d0a1a0a";
    case "jpg": return file.toString("hex", 0, 3) === "ffd8ff";
    case "pdf": return pdf;
    case "eps": return binaryEps || (postscript && header.split("\n")[0]?.includes("EPSF"));
    case "ai": return pdf || postscript;
  }
}

export async function orderDesignExists(id: string) {
  try { return (await stat(resolve(orderDesignDirectory, id))).isFile(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
