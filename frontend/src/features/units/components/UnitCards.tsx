import type { UnitView } from "@wms/domain";
import {
  CalendarPlus,
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
import {
  Button,
  Card,
  ChannelBadge,
  MonoId,
  ProductThumb,
  Timeline,
  WarrantyStatusBadge,
  type TimelineItem,
} from "@/components/ui";
import { printQrLabel, QrCode, registerUrl } from "@/features/qr";
import { toApiError } from "@/lib/api-error";
import { formatDate, formatDateTime } from "@/lib/format";
import { unitsApi } from "../api";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-overline text-text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

/** Product, purchase and ownership facts (right-hand card on A05 / DL05 / CU03). */
export function UnitFactsCard({ unit, showOwner = true }: { unit: UnitView; showOwner?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <Card title={t("units.facts")}>
      <div className="mb-4 flex gap-4">
        <ProductThumb imageUrl={unit.modelImageUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium">
            {unit.modelName} <MonoId>{unit.modelCode}</MonoId>
          </p>
          <p className="text-sm text-text-muted">{unit.modelDescription}</p>
        </div>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label={t("units.fields.category")}>{unit.categoryName}</Field>
        <Field label={t("units.fields.batch")}>
          {unit.batchNumber ? <MonoId>{unit.batchNumber}</MonoId> : "—"}
        </Field>
        <Field label={t("units.fields.purchased")}>
          {formatDate(unit.purchaseDate, i18n.language) || "—"}
        </Field>
        <Field label={t("units.fields.placeOfPurchase")}>
          {unit.placeOfPurchase ?? unit.dealerName ?? "—"}
        </Field>
        {showOwner ? <Field label={t("units.fields.customer")}>{unit.customerName ?? "—"}</Field> : null}
        <Field label={t("units.fields.dealer")}>{unit.dealerName ?? "—"}</Field>
        {unit.registrationChannel ? (
          <Field label={t("units.fields.registeredVia")}>
            <ChannelBadge status={unit.registrationChannel} />
          </Field>
        ) : null}
        {unit.replacesSerial ? (
          <Field label={t("units.fields.replaces")}>
            <Link to={`/units/${unit.replacesSerial}`} className="underline-offset-2 hover:underline">
              <MonoId>{unit.replacesSerial}</MonoId>
            </Link>
          </Field>
        ) : null}
        {unit.replacedBySerial ? (
          <Field label={t("units.fields.replacedBy")}>
            <Link to={`/units/${unit.replacedBySerial}`} className="underline-offset-2 hover:underline">
              <MonoId>{unit.replacedBySerial}</MonoId>
            </Link>
          </Field>
        ) : null}
      </dl>
    </Card>
  );
}

/** The product's warranty: term, period and days left (one warranty per product, from the date of purchase). */
export function WarrantySummary({ unit }: { unit: UnitView }) {
  const { t, i18n } = useTranslation();
  if (!unit.warrantyEnd) return <p className="text-sm text-text-muted">{t("units.notRegisteredLong")}</p>;
  const running = unit.status === "ACTIVE" || unit.status === "EXPIRING_SOON";
  const extendedMonths = (unit.extensions ?? []).reduce((n, x) => n + x.months, 0);
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Field label={t("units.fields.status")}>
        <WarrantyStatusBadge status={unit.status} />
      </Field>
      <Field label={t("units.fields.term")}>
        {extendedMonths ? t("units.termExtended", { count: extendedMonths }) : t("units.term")}
      </Field>
      <Field label={t("units.fields.starts")}>{formatDate(unit.warrantyStart, i18n.language)}</Field>
      <Field label={t("units.fields.ends")}>{formatDate(unit.warrantyEnd, i18n.language)}</Field>
      {running ? (
        <Field label={t("units.fields.daysLeft")}>
          <span className="tabular-nums">{unit.daysRemaining}</span>
        </Field>
      ) : null}
      <Field label={t("units.fields.covers")} className="sm:col-span-2">
        {t("units.covers")}
      </Field>
      {unit.extensions?.length ? (
        <Field label={t("units.fields.extensions")} className="sm:col-span-2">
          <ul className="space-y-1">
            {unit.extensions.map((x) => (
              <li key={x.id} className="text-sm">
                {t("units.extensionLine", {
                  months: x.months,
                  from: formatDate(x.previousEnd, i18n.language),
                  to: formatDate(x.newEnd, i18n.language),
                  by: x.soldByName,
                  date: formatDate(x.at, i18n.language),
                })}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
    </dl>
  );
}

/** QR label (plan 3.4): the code opens customer self-registration with serial, model and batch filled in. */
export function QrLabelCard({ unit }: { unit: UnitView }) {
  const { t } = useTranslation();
  const url = registerUrl(window.location.origin, unit.serial, unit.modelCode, unit.batchNumber);
  return (
    <Card
      title={t("units.qrLabel")}
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={Printer}
          onClick={() =>
            printQrLabel({
              url,
              serial: unit.serial,
              batchNumber: unit.batchNumber,
              model: unit.modelName,
              title: t("units.qrLabel"),
            })
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
      {unit.batchNumber ? (
        <p className="text-center text-sm text-text-muted">
          {t("units.batchLine", { batch: unit.batchNumber })}
        </p>
      ) : null}
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
  if (!unit.warrantyEnd) return null;
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
  voided: Ban,
  claim_filed: MessageSquare,
  claim_closed: ClipboardList,
  replaced: ArrowRightLeft,
  extended: CalendarPlus,
  note: FilePlus2,
} as const;

/** Registration, claim and warranty history of a product, newest first. */
export function UnitHistory({ unit }: { unit: UnitView }) {
  const { t, i18n } = useTranslation();
  // Claim events (and a replacement under a claim) link to the claim.
  const linkFor = (type: string, ref?: string) =>
    ref && (type === "claim_filed" || type === "claim_closed" || type === "replaced")
      ? `/claims/${ref}`
      : undefined;
  const items: TimelineItem[] = [...unit.history]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e, index) => {
      const text =
        e.type === "voided" && e.reason
          ? t("units.history.voidedBecause", { reason: t(`units.voidReason.${e.reason}`) })
          : t(`units.history.${e.type}`, { ref: e.refId ?? "" });
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
        comment: e.type === "claim_closed" && e.text ? t(`claims.resolution.${e.text}`) : e.text,
      };
    });
  return items.length ? (
    <Timeline items={items} />
  ) : (
    <p className="text-sm text-text-muted">{t("units.noHistory")}</p>
  );
}
