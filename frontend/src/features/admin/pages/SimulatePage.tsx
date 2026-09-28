import { FileSpreadsheet, Mail, RotateCcw, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Button, Card, Modal } from "@/components/ui";
import { toApiError } from "@/lib/api-error";
import { AdminTabs } from "../components/AdminTabs";
import { useSimulator } from "../hooks";

// A13 System events: stand-ins for the systems that send registrations to the WMS (W6): a distributor's ERP
// sales feed, the registration mailbox and an online marketplace through the partner API.

function IntakeCard() {
  const { t } = useTranslation();
  const { erpInvoice, registrationEmail, marketplaceOrder } = useSimulator();
  return (
    <Card title={t("simulate.intake.title")}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t("simulate.intake.help")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={FileSpreadsheet}
            loading={erpInvoice.isPending}
            onClick={() =>
              erpInvoice.mutate(undefined, {
                onSuccess: (regs) =>
                  toast.success(
                    t("simulate.intake.erpDone", { count: regs.length }),
                    regs.map((r) => r.serial).join(", "),
                  ),
                onError: (e) => toast.error(toApiError(e).message),
              })
            }
          >
            {t("simulate.intake.erp")}
          </Button>
          <Button
            icon={Mail}
            loading={registrationEmail.isPending}
            onClick={() =>
              registrationEmail.mutate(undefined, {
                onSuccess: (reg) => toast.success(t("simulate.intake.emailDone"), reg.serial),
                onError: (e) => toast.error(toApiError(e).message),
              })
            }
          >
            {t("simulate.intake.email")}
          </Button>
          <Button
            icon={ShoppingCart}
            loading={marketplaceOrder.isPending}
            onClick={() =>
              marketplaceOrder.mutate(undefined, {
                onSuccess: (regs) =>
                  toast.success(
                    t("simulate.intake.marketplaceDone", { count: regs.length }),
                    regs.map((r) => r.serial).join(", "),
                  ),
                onError: (e) => toast.error(toApiError(e).message),
              })
            }
          >
            {t("simulate.intake.marketplace")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ResetCard() {
  const { t } = useTranslation();
  const { reset } = useSimulator();
  const [open, setOpen] = useState(false);
  return (
    <Card title={t("simulate.reset.title")}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t("simulate.reset.help")}</p>
        <Button variant="danger" icon={RotateCcw} onClick={() => setOpen(true)}>
          {t("simulate.reset.button")}
        </Button>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("simulate.reset.confirmTitle")}
        description={t("simulate.reset.confirmHelp")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success(t("simulate.reset.done"));
                  },
                  onError: (e) => toast.error(toApiError(e).message),
                })
              }
            >
              {t("simulate.reset.button")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </Card>
  );
}

export default function SimulatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t("simulate.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("simulate.title") }]}
      />
      <AdminTabs />
      <p className="mb-6 text-body text-text-muted">{t("simulate.intro")}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <IntakeCard />
        <ResetCard />
      </div>
    </>
  );
}
