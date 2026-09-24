import type { Attachment } from "@wms/domain";
import { FileText, Film } from "lucide-react";
import { useTranslation } from "react-i18next";

// Photo / video / PDF thumbnails (plan 3.6), in the same square image frame as product cards.
// Each opens the full file in a new tab.

export function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  const { t } = useTranslation();
  if (!attachments.length) return <p className="text-sm text-text-muted">{t("complaints.noPhotos")}</p>;
  return (
    <ul className="flex flex-wrap gap-4">
      {attachments.map((a) => (
        <li key={a.id}>
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t("complaints.openFile", { name: a.name })}
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-ink-50 hover:ring-2 hover:ring-ink-1000"
          >
            {a.mime.startsWith("image/") ? (
              <img src={a.url} alt="" className="h-full w-full object-contain" />
            ) : a.mime.startsWith("video/") ? (
              <Film size={24} strokeWidth={1.75} className="text-ink-400" aria-hidden />
            ) : (
              <FileText size={24} strokeWidth={1.75} className="text-ink-400" aria-hidden />
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
