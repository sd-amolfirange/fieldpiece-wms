import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, FormField, Modal, SerialNumberInput, Spinner } from "@/components/ui";
import { parseQrPayload, type QrPayload } from "./payload";

// Camera QR scanner (W2 / DL03). Reads the unit's QR label with @zxing/browser. The camera needs HTTPS (or
// localhost); when it can't start, the serial can be typed instead.

interface QrScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (payload: QrPayload) => void;
}

type CameraState = "starting" | "scanning" | "blocked" | "insecure" | "unavailable";

export function QrScannerModal({ open, onOpenChange, onResult }: QrScannerModalProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [manual, setManual] = useState("");
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnreadable(false);
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    let controls: IScannerControls | undefined;
    let cancelled = false;
    setState("starting");
    const start = () => {
      const video = videoRef.current;
      if (!video) return;
      new BrowserQRCodeReader()
        .decodeFromConstraints({ video: { facingMode: "environment" } }, video, (result) => {
          if (!result || cancelled) return;
          const payload = parseQrPayload(result.getText());
          if (!payload) {
            setUnreadable(true);
            return;
          }
          cancelled = true;
          controls?.stop();
          onResult(payload);
          onOpenChange(false);
        })
        .then((c) => {
          controls = c;
          if (cancelled) c.stop();
          else setState("scanning");
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState(
            error instanceof DOMException && error.name === "NotAllowedError" ? "blocked" : "unavailable",
          );
        });
    };
    // The video element mounts with the modal content; start on the next frame.
    const frame = window.requestAnimationFrame(start);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      controls?.stop();
    };
  }, [open, onOpenChange, onResult]);

  const submitManual = () => {
    const payload = parseQrPayload(manual);
    if (!payload) return;
    onResult(payload);
    onOpenChange(false);
  };

  const message =
    state === "blocked"
      ? t("qr.cameraBlocked")
      : state === "insecure"
        ? t("qr.cameraInsecure")
        : state === "unavailable"
          ? t("qr.cameraUnavailable")
          : unreadable
            ? t("qr.unreadable")
            : t("qr.pointCamera");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("qr.scanTitle")}
      description={message}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
      }
    >
      <div className="space-y-4">
        {state === "starting" || state === "scanning" ? (
          <div className="flex h-72 w-full items-center justify-center overflow-hidden rounded bg-ink-50">
            <video
              ref={videoRef}
              className={state === "scanning" ? "h-full w-full object-cover" : "hidden"}
              muted
              playsInline
            />
            {state === "starting" ? <Spinner size={24} label={t("qr.starting")} /> : null}
          </div>
        ) : null}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitManual();
          }}
        >
          <FormField label={t("qr.typeSerial")}>
            <SerialNumberInput value={manual} onChange={(e) => setManual(e.target.value)} />
          </FormField>
          <Button type="submit" variant="secondary" disabled={!parseQrPayload(manual)}>
            {t("qr.useSerial")}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
