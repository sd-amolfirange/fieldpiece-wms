import {
  Copy,
  Download,
  ExternalLink,
  Globe,
  Mail,
  Plug,
  QrCode as QrIcon,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { Button, buttonVariants, Card, ChannelBadge, MonoId } from "@/components/ui";
import { QrCode } from "@/features/qr";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { useCurrentRole } from "@/lib/session";
import { bulkImportsApi } from "../api";
import { useIntakeInfo } from "../hooks";

// Registration hub (dealer / distributor): every way a product registration reaches the warranty desk, in one
// place. Dealers register at the counter (single, QR or bulk); buyers use the website form, email their receipt
// or sign in; partner systems (point of sale, distributor ERP, online marketplaces) send registrations through
// the partner API. Managing partner API keys is an admin task, done from Admin > Integrations instead.

const PARTNER_SAMPLE = `POST {url}/registrations
X-Api-Key: fpk_…
Content-Type: application/json

{
  "registrations": [{
    "serial": "SC680-263810457",
    "batchNumber": "2638-L01",
    "modelCode": "SC680",
    "purchaseDate": "2026-09-15",
    "invoiceNumber": "INV-10001",
    "customer": {
      "name": "Alex Rivera",
      "email": "alex.rivera@example.com",
      "state": "TX",
      "zip": "77002"
    }
  }]
}`;

function copy(text: string, done: string) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(done))
    .catch(() => undefined);
}

function ChannelCard({
  icon: Icon,
  title,
  channels,
  children,
  actions,
}: {
  icon: typeof Globe;
  title: string;
  channels: Parameters<typeof ChannelBadge>[0]["status"][];
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card
      as="article"
      title={
        <span className="flex items-center gap-2">
          <Icon size={20} strokeWidth={1.75} aria-hidden />
          {title}
        </span>
      }
      actions={
        <span className="flex flex-wrap gap-1">
          {channels.map((c) => (
            <ChannelBadge key={c} status={c} />
          ))}
        </span>
      }
    >
      <div className="space-y-4">
        {children}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </Card>
  );
}

export default function RegistrationHubPage() {
  const { t } = useTranslation();
  const role = useCurrentRole();
  const info = useIntakeInfo();
  const origin = window.location.origin;
  const formUrl = `${origin}${info.data?.publicFormPath ?? "/register-product"}`;
  const apiOrigin = new URL(env.apiBaseUrl, origin).origin;
  const partnerUrl = info.data ? `${apiOrigin}${info.data.partnerApiPath}` : "";

  return (
    <>
      <PageHeader
        title={t("hub.title")}
        breadcrumbs={[{ label: t("nav.dashboard"), to: "/" }, { label: t("hub.title") }]}
      />
      <p className="mb-6 text-body text-text-muted">{t("hub.intro")}</p>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <ChannelCard
            icon={ShieldCheck}
            title={t("hub.dealer.title")}
            channels={["DEALER"]}
            actions={
              can(role, "registrations:create") ? (
                <Link to="/registrations/new" className={buttonVariants()}>
                  <QrIcon size={20} strokeWidth={1.75} aria-hidden />
                  {t("hub.dealer.action")}
                </Link>
              ) : null
            }
          >
            <p className="text-body">{t("hub.dealer.help")}</p>
          </ChannelCard>

          <ChannelCard
            icon={Upload}
            title={t("hub.bulk.title")}
            channels={["BULK"]}
            actions={
              <>
                <Link to="/registrations/bulk" className={buttonVariants()}>
                  <Upload size={20} strokeWidth={1.75} aria-hidden />
                  {t("hub.bulk.action")}
                </Link>
                <a
                  href={bulkImportsApi.templateUrl("xlsx")}
                  className={buttonVariants({ variant: "secondary" })}
                  download
                >
                  <Download size={20} strokeWidth={1.75} aria-hidden />
                  {t("bulk.templateXlsx")}
                </a>
              </>
            }
          >
            <p className="text-body">{t("hub.bulk.help")}</p>
          </ChannelCard>

          <ChannelCard
            icon={Globe}
            title={t("hub.web.title")}
            channels={["WEB"]}
            actions={
              <>
                <a href={formUrl} target="_blank" rel="noreferrer" className={buttonVariants()}>
                  <ExternalLink size={20} strokeWidth={1.75} aria-hidden />
                  {t("hub.web.open")}
                </a>
                <Button variant="secondary" icon={Copy} onClick={() => copy(formUrl, t("hub.copied"))}>
                  {t("hub.web.copy")}
                </Button>
              </>
            }
          >
            <p className="text-body">{t("hub.web.help")}</p>
            <div className="flex gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-ink-50">
                <QrCode value={formUrl} label={t("hub.web.qrAlt")} className="h-full w-auto object-contain" />
              </div>
              <p className="min-w-0 text-sm">
                <MonoId>{formUrl}</MonoId>
                <span className="block text-text-muted">{t("hub.web.qrHelp")}</span>
              </p>
            </div>
          </ChannelCard>

          <ChannelCard
            icon={Mail}
            title={t("hub.email.title")}
            channels={["EMAIL"]}
            actions={
              info.data ? (
                <Button
                  variant="secondary"
                  icon={Copy}
                  onClick={() => copy(info.data.inboundEmail, t("hub.copied"))}
                >
                  {t("hub.email.copy")}
                </Button>
              ) : null
            }
          >
            <p className="text-body">{t("hub.email.help")}</p>
            <p>
              <MonoId>{info.data?.inboundEmail ?? "—"}</MonoId>
            </p>
          </ChannelCard>

          <ChannelCard
            icon={ShieldCheck}
            title={t("hub.portal.title")}
            channels={["PORTAL"]}
            actions={
              <Link to="/units" className={buttonVariants()}>
                <QrIcon size={20} strokeWidth={1.75} aria-hidden />
                {t("hub.portal.action")}
              </Link>
            }
          >
            <p className="text-body">{t("hub.portal.help")}</p>
          </ChannelCard>

          <ChannelCard
            icon={Plug}
            title={t("hub.partner.title")}
            channels={["API", "RETAIL", "ERP", "OVERWATCH", "JOBLINK"]}
            actions={
              partnerUrl ? (
                <Button variant="secondary" icon={Copy} onClick={() => copy(partnerUrl, t("hub.copied"))}>
                  {t("hub.partner.copy")}
                </Button>
              ) : null
            }
          >
            <p className="text-body">{t("hub.partner.help")}</p>
            <pre
              className="overflow-x-auto rounded bg-ink-50 p-3 font-mono text-sm"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
              tabIndex={0}
              role="region"
              aria-label={t("hub.partner.sample")}
            >
              {PARTNER_SAMPLE.replace("{url}", partnerUrl || "/api/partner/v1")}
            </pre>
          </ChannelCard>
        </div>
      </div>
    </>
  );
}
