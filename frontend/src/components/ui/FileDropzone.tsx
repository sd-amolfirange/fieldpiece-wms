import { FileText, Upload, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useDropzone, type Accept, type FileRejection } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatFileSize } from "@/lib/format";

// Section 5.2: image/* and PDF, max 10 MB per file, 5 files per claim,
// thumbnails, progress bar and a remove button per file.
// Section 11: `capture="environment"` opens the rear camera on phones.

export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILES = 5;
const DEFAULT_ACCEPT: Accept = { "image/*": [], "application/pdf": [".pdf"] };

export interface UploadItem {
  file: File;
  /** 0-100 while uploading, undefined when not started. */
  progress?: number;
  error?: string;
}

interface FileDropzoneProps {
  value: UploadItem[];
  onChange: (items: UploadItem[]) => void;
  onReject?: (messages: string[]) => void;
  maxFiles?: number;
  maxSizeMb?: number;
  /** File types to accept. Defaults to photos and PDF. */
  accept?: Accept;
  /** Replaces the default "Photos or PDF…" hint under the drop text. */
  hint?: string;
  /** Opens the rear camera on phones. Pass false for documents such as spreadsheets. */
  capture?: "environment" | false;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function FileDropzone({
  value,
  onChange,
  onReject,
  maxFiles = MAX_FILES,
  maxSizeMb = MAX_FILE_SIZE_MB,
  accept = DEFAULT_ACCEPT,
  hint,
  capture = "environment",
  id,
  ...aria
}: FileDropzoneProps) {
  const { t } = useTranslation();
  const remaining = maxFiles - value.length;

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    const messages = rejected.map(({ file, errors }) => {
      const code = errors[0]?.code;
      if (code === "file-too-large") return t("fields.fileTooLarge", { name: file.name, maxSizeMb });
      if (code === "too-many-files") return t("fields.tooManyFiles", { maxFiles });
      return t("fields.fileWrongType", { name: file.name });
    });
    const room = accepted.slice(0, Math.max(0, remaining));
    if (accepted.length > room.length) messages.push(t("fields.tooManyFiles", { maxFiles }));
    if (messages.length) onReject?.([...new Set(messages)]);
    if (room.length) onChange([...value, ...room.map((file) => ({ file }))]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize: maxSizeMb * 1024 * 1024,
    maxFiles,
    disabled: remaining <= 0,
  });

  const previews = useMemo(
    () => value.map((item) => (item.file.type.startsWith("image/") ? URL.createObjectURL(item.file) : null)),
    [value],
  );
  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  return (
    <div>
      <div
        {...getRootProps({
          className: cn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-ink-200 bg-ink-50 p-6 text-center",
            isDragActive && "border-ink-1000 bg-brand-50",
            remaining <= 0 && "cursor-not-allowed opacity-40",
          ),
        })}
      >
        <input {...getInputProps({ id, capture: capture || undefined, ...aria })} />
        <Upload size={24} strokeWidth={1.75} aria-hidden className="text-ink-500" />
        <p className="text-body font-semibold">{t("fields.fileDrop")}</p>
        <p className="text-xs text-text-muted">{hint ?? t("fields.fileDropHint", { maxSizeMb, maxFiles })}</p>
      </div>

      {value.length ? (
        <ul className="mt-3 space-y-2">
          {value.map((item, index) => (
            <li
              key={`${item.file.name}-${index}`}
              className="flex items-center gap-3 rounded border border-border p-2"
            >
              {previews[index] ? (
                <img
                  src={previews[index] ?? undefined}
                  alt=""
                  className="h-12 w-12 rounded-sm bg-ink-50 object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-sm bg-ink-50">
                  <FileText size={20} strokeWidth={1.75} aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.file.name}</p>
                <p className="text-xs text-text-muted">{formatFileSize(item.file.size)}</p>
                {item.progress !== undefined ? (
                  <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-ink-100"
                    role="progressbar"
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={item.file.name}
                  >
                    <div className="h-full bg-ink-1000" style={{ width: `${item.progress}%` }} />
                  </div>
                ) : null}
                {item.error ? <p className="text-xs text-danger">{item.error}</p> : null}
              </div>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded text-ink-700 hover:bg-ink-50"
                aria-label={t("fields.removeFile", { name: item.file.name })}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
