import lightBack from "../../../output/essential-svg/03_PRINT_Light_Back.svg?url";
import darkBack from "../../../output/essential-svg/05_PRINT_Black_Back.svg?url";

export const isQrImage = (value: string) => /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value);
export const printTemplateUrl = (finish: "light" | "dark") => finish === "dark" ? darkBack : lightBack;

export async function loadPrintTemplate(finish: "light" | "dark", signal?: AbortSignal) {
  const response = await fetch(printTemplateUrl(finish), signal ? { signal } : {});
  if (!response.ok) throw new Error("Could not load the back artwork. Try again.");
  return response.text();
}

export function printArtwork(template: string, imageData: string) {
  if (!isQrImage(imageData)) throw new Error("This saved QR image cannot be exported.");
  if (!template.includes('width="260.79" height="172.91"') || !template.includes("</svg>")) throw new Error("The back artwork has no matching print dimensions.");
  // The original EPS bounds include bleed. Cover the template’s example QR.
  return template.replace('width="260.79" height="172.91"', 'width="92mm" height="61mm"')
    .replace("</svg>", `<rect x="103" y="61" width="55" height="55" fill="white"/><image x="103" y="61" width="55" height="55" href="${imageData}" style="image-rendering:pixelated"/></svg>`);
}

export function escapePrintText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
