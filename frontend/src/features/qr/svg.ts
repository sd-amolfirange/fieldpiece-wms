import { BrowserQRCodeSvgWriter } from "@zxing/browser";

/** QR code as SVG markup (black on white), generated in the browser. */
export function qrSvgMarkup(value: string, size = 240): string {
  const svg = new BrowserQRCodeSvgWriter().write(value, size, size);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(svg);
}

export const qrDataUrl = (value: string, size?: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvgMarkup(value, size))}`;
