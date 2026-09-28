import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type {
  BulkRowStatus,
  ClaimSource,
  IntegrationDirection,
  IntegrationStatus,
  RegistrationChannel,
  RegistrationFlag,
  RegistrationStatus,
} from "@wms/domain";
import { Badge } from "./Badge";
import {
  bulkRowStatusStyle,
  channelStyle,
  claimSourceStyle,
  claimStatusStyle,
  integrationDirectionStyle,
  integrationStatusStyle,
  partnerKeyStyle,
  registrationFlagStyle,
  registrationStatusStyle,
  warrantyStatusStyle,
  type AnyClaimStatus,
  type AnyWarrantyStatus,
  type PartnerKeyStatus,
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

export function RegistrationStatusBadge({ status, className }: StatusBadgeProps<RegistrationStatus>) {
  const { t } = useTranslation();
  return (
    <Badge className={cn(registrationStatusStyle[status], className)}>
      {t(`status.registration.${status}`)}
    </Badge>
  );
}

/** Where a registration came from: Dealer, Bulk, Portal, Web form, Email, ERP, Partner API, Marketplace. */
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

/** Who filed a warranty claim: Customer, Dealer or Warranty desk. */
export function ClaimSourceBadge({ status, className }: StatusBadgeProps<ClaimSource>) {
  const { t } = useTranslation();
  return <Badge className={cn(claimSourceStyle[status], className)}>{t(`status.source.${status}`)}</Badge>;
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

/** Whether a partner system's API key is accepted. */
export function PartnerKeyBadge({ status, className }: StatusBadgeProps<PartnerKeyStatus>) {
  const { t } = useTranslation();
  return <Badge className={cn(partnerKeyStyle[status], className)}>{t(`status.partnerKey.${status}`)}</Badge>;
}
