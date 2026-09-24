import { createColumnHelper } from "@tanstack/react-table";
import type { Role, UserView } from "@wms/domain";
import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Skeleton } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Card, DataTable, NativeSelect } from "@/components/ui";
import { AdminTabs } from "../components/AdminTabs";
import { useOrgStructure } from "../hooks";

// A11 Dealers & users: the distributor -> dealer hierarchy (set once by the admin; access follows from it) and every
// account with its login.

const ROLES: Role[] = ["admin", "distributor", "dealer", "customer"];
const col = createColumnHelper<UserView>();

export default function DealersUsersPage() {
  const { t } = useTranslation();
  const org = useOrgStructure();
  const [role, setRole] = useState<Role | "">("");

  const users = useMemo(
    () => (org.data?.users ?? []).filter((u) => !role || u.role === role),
    [org.data, role],
  );
  const columns = useMemo(
    () => [
      col.accessor("name", { header: t("org.columns.name"), enableSorting: false }),
      col.accessor("email", {
        header: t("org.columns.login"),
        enableSorting: false,
        cell: (i) => <span className="font-mono">{i.getValue()}</span>,
      }),
      col.accessor("role", {
        header: t("org.columns.role"),
        enableSorting: false,
        cell: (i) => t(`roles.${i.getValue()}`),
      }),
      col.accessor("orgName", {
        header: t("org.columns.organisation"),
        enableSorting: false,
        cell: (i) => i.getValue() ?? "—",
      }),
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t("org.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("org.title") }]}
      />
      <AdminTabs />
      {org.error ? <ErrorState error={org.error} onRetry={() => void org.refetch()} /> : null}
      {org.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : org.data ? (
        <div className="space-y-6">
          <section aria-labelledby="org-hierarchy" className="space-y-4">
            <h2 id="org-hierarchy" className="text-h3">
              {t("org.hierarchy")}
            </h2>
            <div className="grid gap-6 lg:grid-cols-3">
              {org.data.distributors.map((d) => (
                <Card key={d.id} title={d.name}>
                  <p className="mb-2 text-sm text-text-muted">
                    {t("org.distributorIn", { city: d.city, count: d.dealers.length })}
                  </p>
                  <ul className="list-disc space-y-1 ps-5 text-body">
                    {d.dealers.map((dealer) => (
                      <li key={dealer.id}>
                        {dealer.name} <span className="text-sm text-text-muted">· {dealer.city}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
              {org.data.directDealers.length ? (
                <Card title={t("org.directDealers")}>
                  <p className="mb-2 text-sm text-text-muted">{t("org.directHelp")}</p>
                  <ul className="list-disc space-y-1 ps-5 text-body">
                    {org.data.directDealers.map((dealer) => (
                      <li key={dealer.id}>
                        {dealer.name} <span className="text-sm text-text-muted">· {dealer.city}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </section>

          <DataTable
            caption={t("org.users")}
            columns={columns}
            data={users}
            total={users.length}
            page={1}
            pageSize={Math.max(users.length, 1)}
            onPageChange={() => undefined}
            getRowId={(u) => u.id}
            emptyIcon={Users}
            emptyMessage={t("org.noUsers")}
            toolbar={
              <>
                <h2 className="me-auto text-h3">{t("org.users")}</h2>
                <label htmlFor="org-role" className="sr-only">
                  {t("org.filterRole")}
                </label>
                <NativeSelect
                  id="org-role"
                  className="w-full sm:w-48"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role | "")}
                >
                  <option value="">{t("org.allRoles")}</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              </>
            }
          />
        </div>
      ) : null}
    </>
  );
}
