import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ClaimStatusBadge, MonoId } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useClaims } from "../hooks";

// Claims filed on one product (tab on the product page), newest first.

export function UnitClaims({ serial }: { serial: string }) {
  const { t, i18n } = useTranslation();
  const query = useClaims({ q: serial, pageSize: 50, sort: "-createdAt" });
  const claims = query.data?.items.filter((c) => c.unitSerial === serial) ?? [];
  if (query.isLoading) return <p className="text-sm text-text-muted">{t("common.loading")}</p>;
  if (!claims.length) return <p className="text-sm text-text-muted">{t("claims.noneForUnit")}</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {claims.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <Link to={`/claims/${c.id}`} className="underline-offset-2 hover:underline">
            <MonoId>{c.id}</MonoId>
          </Link>
          <ClaimStatusBadge status={c.status} />
          <span className="text-sm">{t(`claims.issue.${c.issueType}`)}</span>
          <span className="text-sm text-text-muted">{formatDate(c.createdAt, i18n.language)}</span>
        </li>
      ))}
    </ul>
  );
}
