import { Package } from "lucide-react";
import { cn } from "@/lib/cn";

// The square product-photo frame used everywhere a unit, registration or claim shows its model (Section 3.5):
// ink-50 background, the model's real photo when the seed data has one, else the Package placeholder icon.
// Never a broken image: a model with no imageUrl always falls back to the icon.

const SIZE = { sm: "h-10 w-10", md: "h-20 w-20", lg: "h-64 w-full" } as const;
const ICON = { sm: 16, md: 24, lg: 48 } as const;

export interface ProductThumbProps {
  /** The model's product photo (`UnitView.modelImageUrl`, `RegistrationView.modelImageUrl`, etc.). */
  imageUrl?: string;
  size?: keyof typeof SIZE;
  className?: string;
}

export function ProductThumb({ imageUrl, size = "md", className }: ProductThumbProps) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded bg-ink-50", SIZE[size], className)}>
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full object-contain" />
      ) : (
        <Package size={ICON[size]} strokeWidth={1.75} className="text-ink-400" aria-hidden />
      )}
    </div>
  );
}
