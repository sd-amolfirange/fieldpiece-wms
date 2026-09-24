import { qrSvgMarkup } from "./svg";

// Prints just the QR label (not the page) through a hidden frame. The label is a plain print document:
// QR code, serial and model, sized for a small sticker.

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export function printQrLabel({
  url,
  serial,
  model,
  title,
}: {
  url: string;
  serial: string;
  model: string;
  title: string;
}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title>
<style>
  @page { size: 60mm 80mm; margin: 4mm; }
  body { font-family: system-ui, sans-serif; text-align: center; margin: 0; }
  svg { width: 48mm; height: 48mm; }
  .serial { font-family: ui-monospace, monospace; font-size: 11pt; font-weight: 600; margin-top: 2mm; }
  .model { font-size: 9pt; margin-top: 1mm; }
</style></head><body>
${qrSvgMarkup(url, 400)}
<div class="serial">${escapeHtml(serial)}</div>
<div class="model">${escapeHtml(model)}</div>
</body></html>`);
  doc.close();
  const win = frame.contentWindow;
  window.setTimeout(() => {
    win?.focus();
    win?.print();
    window.setTimeout(() => frame.remove(), 1000);
  }, 50);
}
