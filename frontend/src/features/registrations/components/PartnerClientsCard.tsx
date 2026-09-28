import { createColumnHelper } from "@tanstack/react-table";
import type { PartnerClientView } from "@wms/domain";
import { KeyRound, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/feedback";
import {
  Button,
  Card,
  ChannelBadge,
  DataTable,
  FormField,
  Input,
  Modal,
  MonoId,
  NativeSelect,
  PartnerKeyBadge,
} from "@/components/ui";
import { useDealers } from "@/features/catalog";
import { toApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import type { NewPartnerClient } from "../api";
import { useCreatePartnerClient, usePartnerClients, useSetPartnerActive } from "../hooks";

// Partner systems allowed to send registrations through the partner API (warranty desk only). A new key is shown
// once, when it's created; the server keeps only a hash of it.

const CHANNELS: PartnerClientView["channel"][] = ["API", "RETAIL", "ERP"];
const col = createColumnHelper<PartnerClientView>();

function AddPartnerModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const dealers = useDealers();
  const create = useCreatePartnerClient();
  const [form, setForm] = useState<NewPartnerClient>({ name: "", channel: "API" });
  const [apiKey, setApiKey] = useState<string | null>(null);
  const close = () => {
    onOpenChange(false);
    setApiKey(null);
    setForm({ name: "", channel: "API" });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={apiKey ? t("partners.keyTitle") : t("partners.addTitle")}
      description={apiKey ? t("partners.keyHelp") : t("partners.addHelp")}
      footer={
        apiKey ? (
          <Button onClick={close}>{t("common.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              icon={KeyRound}
              loading={create.isPending}
              disabled={!form.name.trim()}
              onClick={() =>
                create.mutate(
                  { ...form, name: form.name.trim(), dealerId: form.dealerId || undefined },
                  {
                    onSuccess: (r) => setApiKey(r.apiKey),
                    onError: (e) => toast.error(toApiError(e).message),
                  },
                )
              }
            >
              {t("partners.create")}
            </Button>
          </>
        )
      }
    >
      {apiKey ? (
        <pre
          className="overflow-x-auto rounded bg-ink-50 p-3 font-mono text-sm"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
          tabIndex={0}
          role="region"
          aria-label={t("partners.keyTitle")}
        >
          {apiKey}
        </pre>
      ) : (
        <div className="space-y-4">
          <FormField label={t("partners.fields.name")} required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </FormField>
          <FormField label={t("partners.fields.channel")} helper={t("partners.channelHelp")} required>
            <NativeSelect
              value={form.channel}
              onChange={(e) =>
                setForm((f) => ({ ...f, channel: e.target.value as PartnerClientView["channel"] }))
              }
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`status.channel.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("partners.fields.dealer")} helper={t("partners.dealerHelp")}>
            <NativeSelect
              value={form.dealerId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, dealerId: e.target.value }))}
            >
              <option value="">—</option>
              {dealers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      )}
    </Modal>
  );
}

export function PartnerClientsCard() {
  const { t, i18n } = useTranslation();
  const query = usePartnerClients({ enabled: true });
  const setActive = useSetPartnerActive();
  const [adding, setAdding] = useState(false);

  const columns = useMemo(
    () => [
      col.accessor("name", { header: t("partners.columns.name"), enableSorting: false }),
      col.accessor("channel", {
        header: t("partners.columns.channel"),
        enableSorting: false,
        cell: (i) => <ChannelBadge status={i.getValue()} />,
      }),
      col.accessor("dealerName", {
        header: t("partners.columns.dealer"),
        enableSorting: false,
        cell: (i) => i.getValue() ?? "—",
      }),
      col.accessor("keyPrefix", {
        header: t("partners.columns.key"),
        enableSorting: false,
        cell: (i) => <MonoId>{`${i.getValue()}…`}</MonoId>,
      }),
      col.accessor("lastUsedAt", {
        header: t("partners.columns.lastUsed"),
        enableSorting: false,
        cell: (i) => formatDateTime(i.getValue(), i18n.language) || "—",
      }),
      col.accessor("active", {
        header: t("partners.columns.status"),
        enableSorting: false,
        cell: (i) => <PartnerKeyBadge status={i.getValue() ? "ACTIVE" : "INACTIVE"} />,
      }),
      col.display({
        id: "toggle",
        header: t("common.actions"),
        cell: ({ row: { original: p } }) => (
          <Button
            variant="secondary"
            size="sm"
            loading={setActive.isPending && setActive.variables?.id === p.id}
            onClick={() =>
              setActive.mutate(
                { id: p.id, active: !p.active },
                {
                  onSuccess: (r) =>
                    toast.success(t(r.active ? "partners.turnedOn" : "partners.turnedOff"), r.name),
                  onError: (e) => toast.error(toApiError(e).message),
                },
              )
            }
          >
            {p.active ? t("partners.turnOff") : t("partners.turnOn")}
          </Button>
        ),
      }),
    ],
    [t, i18n.language, setActive],
  );

  return (
    <Card
      title={t("partners.title")}
      actions={
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
          {t("partners.add")}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-text-muted">{t("partners.help")}</p>
      <DataTable
        caption={t("partners.title")}
        columns={columns}
        data={query.data}
        total={query.data?.length ?? 0}
        page={1}
        pageSize={Math.max(query.data?.length ?? 0, 1)}
        onPageChange={() => undefined}
        getRowId={(row) => row.id}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyIcon={KeyRound}
        emptyMessage={t("partners.empty")}
      />
      <AddPartnerModal open={adding} onOpenChange={setAdding} />
    </Card>
  );
}
