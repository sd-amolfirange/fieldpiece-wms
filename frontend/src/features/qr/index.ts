// Public API of the QR feature: label payload, QR image, label printing and the camera scanner.
export { parseQrPayload, registerUrl, type QrPayload } from "./payload";
export { QrCode } from "./QrCode";
export { qrDataUrl } from "./svg";
export { printQrLabel } from "./print-label";
export { QrScannerModal } from "./QrScannerModal";
