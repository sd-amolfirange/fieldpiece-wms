import { createColumnHelper } from "@tanstack/react-table";
import type { ModelPart, UnitPartView } from "@wms/domain";
import { Wrench } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, MonoId, WarrantyStatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useCoverageText } from "./coverage";

// Part-wise warranty table (plan 3.1): one row per part with its own dates, status and days left. Built on the
// existing DataTable, so on phones each part becomes a card. Replaced parts stay listed as history.

const unitCol = createColumnHelper<UnitPartView>();
const templateCol = createColumnHelper<ModelPart>();

export function PartWarrantyTable({ parts }: { parts: UnitPartView[] }) {
  const { t, i18n } = useTranslation();
  const coverage = useCoverageText();
  // Fitted parts first, replaced ones after them.
  const rows = useMemo(
    () => [...parts].sort((a, b) => Number(!!a.replacedAt) - Number(!!b.replacedAt)),
    [parts],
  );

  const columns = useMemo(
    () => [
      unitCol.accessor("partType", {
        header: t("parts.columns.part"),
        cell: (i) => (
          <span>
            <span className="font-semibold">{t(`parts.type.${i.getValue()}`)}</span>
            {i.row.original.replacedAt ? (
              <span className="block text-xs text-text-muted">
                {t("parts.replacedOn", {
                  date: formatDate(i.row.original.replacedAt, i18n.language),
                  serial: i.row.original.replacedBySerial,
                })}
              </span>
            ) : i.row.original.replacesSerial ? (
              <span className="block text-xs text-text-muted">
                {t("parts.replaces", { serial: i.row.original.replacesSerial })}
              </span>
            ) : null}
          </span>
        ),
      }),
      unitCol.accessor("serial", {
        header: t("parts.columns.serial"),
        cell: (i) => (i.getValue() ? <MonoId>{i.getValue()}</MonoId> : t("parts.unitSerial")),
      }),
      unitCol.accessor("warrantyStart", {
        header: t("parts.columns.starts"),
        cell: (i) => formatDate(i.getValue(), i18n.language),
      }),
      unitCol.accessor("warrantyEnd", {
        header: t("parts.columns.ends"),
        cell: (i) => formatDate(i.getValue(), i18n.language),
      }),
      unitCol.accessor("status", {
        header: t("parts.columns.status"),
        cell: (i) =>
          i.row.original.replacedAt ? t("parts.replaced") : <WarrantyStatusBadge status={i.getValue()} />,
      }),
      unitCol.accessor("daysRemaining", {
        header: t("parts.columns.daysLeft"),
        cell: (i) => <span className="tabular-nums">{i.row.original.replacedAt ? "" : i.getValue()}</span>,
      }),
      unitCol.display({
        id: "covers",
        header: t("parts.columns.covers"),
        cell: (i) => coverage(i.row.original),
      }),
    ],
    [t, i18n.language, coverage],
  );

  return (
    <DataTable
      caption={t("parts.caption")}
      columns={columns}
      data={rows}
      total={rows.length}
      page={1}
      pageSize={50}
      onPageChange={() => {}}
      getRowId={(p) => p.id}
      emptyIcon={Wrench}
      emptyMessage={t("parts.noneYet")}
    />
  );
}

/** Model template (A06): which parts, how long each is covered, and what the cover includes. */
export function ModelTemplateTable({ parts }: { parts: ModelPart[] }) {
  const { t } = useTranslation();
  const coverage = useCoverageText();
  const columns = useMemo(
    () => [
      templateCol.accessor("partType", {
        header: t("parts.columns.part"),
        cell: (i) => <span className="font-semibold">{t(`parts.type.${i.getValue()}`)}</span>,
      }),
      templateCol.accessor("warrantyMonths", {
        header: t("parts.columns.warranty"),
        cell: (i) =>
          i.getValue() % 12 === 0
            ? t("parts.years", { count: i.getValue() / 12 })
            : t("parts.months", { count: i.getValue() }),
      }),
      templateCol.display({
        id: "covers",
        header: t("parts.columns.covers"),
        cell: (i) => coverage(i.row.original),
      }),
      templateCol.accessor("serialised", {
        header: t("parts.columns.ownSerial"),
        cell: (i) => (i.getValue() ? t("common.yes") : t("common.no")),
      }),
    ],
    [t, coverage],
  );
  return (
    <DataTable
      caption={t("parts.templateCaption")}
      columns={columns}
      data={parts}
      total={parts.length}
      page={1}
      pageSize={50}
      onPageChange={() => {}}
      getRowId={(p) => p.partType}
      emptyIcon={Wrench}
      emptyMessage={t("parts.noneYet")}
    />
  );
}
