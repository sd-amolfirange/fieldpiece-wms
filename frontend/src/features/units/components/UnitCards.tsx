import type { UnitView } from "@wms/domain";
import {
  ArrowRightLeft,
  ClipboardList,
  Download,
  FilePlus2,
  MessageSquare,
  Printer,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "@/components/feedback";
import { Button, Card, MonoId, Timeline, type TimelineItem } from "@/components/ui";
import { printQrLabel, QrCode, registerUrl } from "@/features/qr";
import { toApiError } from "@/lib/api-error";
import { formatDate, formatDateTime } from "@/lib/format";
import { useCurrentRole } from "@/lib/session";
import { unitsApi } from "../api";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

/** Model, installation and ownership facts for a unit (right-hand card on A05 / DL05 / CU03). */
export function UnitFactsCard({ unit, showOwner = true }: { unit: UnitView; showOwner?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <Card title={t("units.facts")}>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label={t("units.fields.model")}>
          {unit.modelName} <MonoId>{unit.modelCode}</MonoId>
        </Field>
        <Field label={t("units.fields.brand")}>{unit.brandName}</Field>
        <Field label={t("units.fields.capacity")}>
          {unit.capacity} · {unit.unitType}
        </Field>
        <Field label={t("units.fields.installed")}>
          {formatDate(unit.installDate, i18n.language) || "—"}
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("units.fields.location")}>{unit.location || "—"}</Field>
        </div>
        {showOwner ? <Field label={t("units.fields.customer")}>{unit.customerName ?? "—"}</Field> : null}
        <Field label={t("units.fields.dealer")}>{unit.dealerName ?? "—"}</Field>
      </dl>
    </Card>
  );
}

/** QR label (plan 3.4): the code opens customer self-registration with serial and model filled in. */
export function QrLabelCard({ unit }: { unit: UnitView }) {
  const { t } = useTranslation();
  const url = registerUrl(window.location.origin, unit.serial, unit.modelCode);
  return (
    <Card
      title={t("units.qrLabel")}
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={Printer}
          onClick={() =>
            printQrLabel({ url, serial: unit.serial, model: unit.modelName, title: t("units.qrLabel") })
          }
        >
          {t("units.printLabel")}
        </Button>
      }
    >
      <div className="flex h-48 w-full items-center justify-center rounded bg-ink-50">
        <QrCode
          value={url}
          label={t("units.qrAlt", { serial: unit.serial })}
          className="h-full w-auto object-contain"
        />
      </div>
      <p className="mt-2 text-center">
        <MonoId>{unit.serial}</MonoId>
      </p>
      <p className="text-center text-sm text-text-muted">{unit.modelName}</p>
    </Card>
  );
}

export function CertificateButton({
  unit,
  variant = "secondary",
}: {
  unit: UnitView;
  variant?: "primary" | "secondary";
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!unit.parts.length) return null;
  return (
    <Button
      variant={variant}
      icon={Download}
      loading={busy}
      onClick={() => {
        setBusy(true);
        unitsApi
          .downloadCertificate(unit.serial)
          .catch((e: unknown) => toast.error(toApiError(e).message))
          .finally(() => setBusy(false));
      }}
    >
      {t("units.certificate")}
    </Button>
  );
}

const eventIcon = {
  registered: ShieldCheck,
  part_replaced: ArrowRightLeft,
  voided: Ban,
  complaint_raised: MessageSquare,
  claim_created: ClipboardList,
  note: FilePlus2,
} as const;

/** Service, claim and registration history of a unit, newest first. */
export function UnitHistory({ unit }: { unit: UnitView }) {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  // Claim and complaint events link to their record for the roles that can open it.
  const linkFor = (type: string, ref?: string) =>
    !ref
      ? undefined
      : type === "claim_created" && role === "admin"
        ? `/claims/${ref}`
        : type === "complaint_raised" && (role === "admin" || role === "customer")
          ? `/complaints/${ref}`
          : undefined;
  const items: TimelineItem[] = [...unit.history]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e, index) => {
      const text = t(`units.history.${e.type}`, { ref: e.refId ?? "" });
      const to = linkFor(e.type, e.refId);
      return {
        id: `${e.at}-${index}`,
        icon: eventIcon[e.type],
        actor: e.byName,
        action: to ? (
          <Link to={to} className="underline-offset-2 hover:underline">
            {text}
          </Link>
        ) : (
          text
        ),
        timestamp: formatDateTime(e.at, i18n.language),
        comment: e.text,
      };
    });
  return items.length ? (
    <Timeline items={items} />
  ) : (
    <p className="text-sm text-text-muted">{t("units.noHistory")}</p>
  );
}
