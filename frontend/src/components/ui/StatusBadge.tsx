import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type {
  BulkRowStatus,
  ComplaintSource,
  ComplaintStatus,
  Coverage,
  FinancePostingStatus,
  IntegrationDirection,
  IntegrationStatus,
  RegistrationChannel,
  RegistrationFlag,
  RegistrationStatus,
} from "@wms/domain";
import type { RmaStatus } from "@/types";
import { Badge } from "./Badge";
import {
  bulkRowStatusStyle,
  channelStyle,
  claimStatusStyle,
  complaintSourceStyle,
  complaintStatusStyle,
  coverageStyle,
  financePostingStyle,
  integrationDirectionStyle,
  integrationStatusStyle,
  registrationFlagStyle,
  registrationStatusStyle,
  rmaStatusStyle,
  warrantyStatusStyle,
  type AnyClaimStatus,
  type AnyWarrantyStatus,
} from "./status-styles";

// Status is never shown by colour alone: every badge carries its label (Section 3.2).

interface StatusBadgeProps<S extends string> {
  status: S;
  className?: string;
}

export function ClaimStatusBadge({ status, className }: StatusBadgeProps<AnyClaimStatus>) {
  const { t } = useTranslation();
  return <Badge className={cn(claimStatusStyle[status], className)}>{t(`status.claim.${status}`)}</Badge>;
}

export function WarrantyStatusBadge({ status, className }: StatusBadgeProps<AnyWarrantyStatus>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(warrantyStatusStyle[status], className)}>{t(`status.warranty.${status}`)}</Badge>
  );
}

export function RmaStatusBadge({ status, className }: StatusBadgeProps<RmaStatus>) {
  const { t } = useTranslation();
  return <Badge className={cn(rmaStatusStyle[status], className)}>{t(`status.rma.${status}`)}</Badge>;
}

export function RegistrationStatusBadge({ status, className }: StatusBadgeProps<RegistrationStatus>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(registrationStatusStyle[status], className)}>
      {t(`status.registration.${status}`)}
    </Badge>
  );
}

/** Where a registration came from: Dealer, Portal, Email, ERP, Bulk. */
export function ChannelBadge({ status, className }: StatusBadgeProps<RegistrationChannel>) {
  const { t } = useTranslation();
  return <Badge className={cn(channelStyle[status], className)}>{t(`status.channel.${status}`)}</Badge>;
}

export function RegistrationFlagBadge({ status, className }: StatusBadgeProps<RegistrationFlag>) {
  const { t } = useTranslation();
  return <Badge className={cn(registrationFlagStyle[status], className)}>{t(`status.flag.${status}`)}</Badge>;
}

export function BulkRowStatusBadge({ status, className }: StatusBadgeProps<BulkRowStatus>) {
  const { t } = useTranslation();
  return <Badge className={cn(bulkRowStatusStyle[status], className)}>{t(`status.bulkRow.${status}`)}</Badge>;
}

export function CoverageBadge({ status, className }: StatusBadgeProps<Coverage>) {
  const { t } = useTranslation();
  return <Badge className={cn(coverageStyle[status], className)}>{t(`status.coverage.${status}`)}</Badge>;
}

export function ComplaintStatusBadge({ status, className }: StatusBadgeProps<ComplaintStatus>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(complaintStatusStyle[status], className)}>{t(`status.complaint.${status}`)}</Badge>
  );
}

/** Who raised a complaint: Customer, Dealer or Admin. */
export function ComplaintSourceBadge({ status, className }: StatusBadgeProps<ComplaintSource>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(complaintSourceStyle[status], className)}>{t(`status.source.${status}`)}</Badge>
  );
}

export function FinancePostingBadge({ status, className }: StatusBadgeProps<FinancePostingStatus>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(financePostingStyle[status], className)}>{t(`status.finance.${status}`)}</Badge>
  );
}

export function IntegrationStatusBadge({ status, className }: StatusBadgeProps<IntegrationStatus>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(integrationStatusStyle[status], className)}>
      {t(`status.integration.${status}`)}
    </Badge>
  );
}

export function IntegrationDirectionBadge({ status, className }: StatusBadgeProps<IntegrationDirection>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(integrationDirectionStyle[status], className)}>
      {t(`status.direction.${status}`)}
    </Badge>
  );
}
