import { useMemo } from "react";
import { qrDataUrl } from "./svg";

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const src = useMemo(() => qrDataUrl(value), [value]);
  return <img src={src} alt={label} className={className} />;
}
