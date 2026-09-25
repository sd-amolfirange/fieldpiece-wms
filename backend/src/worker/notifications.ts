import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import type { QueuedEvent } from "../infra/outbox/event-types";
import { ClaimsService } from "../modules/claims";
import { RegistrationsService } from "../modules/registrations";

/** Escapes user text for HTML email bodies (Section 11.2: escape at render time). */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

interface Email {
  to: string;
  subject: string;
  lines: string[];
  link?: { label: string; href: string };
}

/**
 * Email notifications for domain events. Handlers are idempotent in effect (a duplicate event sends a
 * duplicate email at worst). TODO: SMS provider and per-user notification preferences. [CONFIRM]
 */
@Injectable()
export class NotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private readonly transport: Transporter | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly registrations: RegistrationsService,
    private readonly claims: ClaimsService,
  ) {
    this.transport = env.SMTP_URL ? createTransport(env.SMTP_URL) : null;
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }

  async handle(event: QueuedEvent): Promise<void> {
    const email = await this.compose(event);
    if (!email) return;
    if (!this.transport) {
      this.logger.warn({ type: event.type }, "SMTP_URL not set; email skipped");
      return;
    }
    const text = [...email.lines, email.link ? `${email.link.label}: ${email.link.href}` : ""].join("\n\n");
    const html = [
      ...email.lines.map((l) => `<p>${escapeHtml(l)}</p>`),
      email.link ? `<p><a href="${escapeHtml(email.link.href)}">${escapeHtml(email.link.label)}</a></p>` : "",
    ].join("");
    await this.transport.sendMail({
      from: this.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text,
      html,
    });
    this.logger.log({ type: event.type, eventId: event.eventId }, "Email sent");
  }

  private async compose(event: QueuedEvent): Promise<Email | null> {
    const app = this.env.WEB_APP_URL;
    if (event.type === "registration.created") {
      const reg = await this.registrations.findForDocument(String(event.payload.registrationId));
      if (!reg?.customer.email) return null;
      return {
        to: reg.customer.email,
        subject: `Your ${reg.product.name} is registered`,
        lines: [
          `Hi ${reg.customer.contactName},`,
          `Your ${reg.product.name} (serial ${reg.serialNumber}) is registered. Coverage runs until ${reg.warrantyEnd.toISOString().slice(0, 10)}.`,
        ],
        link: {
          label: "Check your warranty",
          href: `${app}/check?serial=${encodeURIComponent(reg.serialNumber)}`,
        },
      };
    }

    const claim = event.aggregate === "claim" ? await this.claims.forNotification(event.aggregateId) : null;
    if (!claim) return null;
    const link = { label: `View claim ${claim.displayNo}`, href: `${app}/claims/${claim.id}` };
    switch (event.type) {
      case "claim.submitted":
        return {
          to: claim.creator.email,
          subject: `We received claim ${claim.displayNo}`,
          lines: ["We've received your claim and will review it shortly."],
          link,
        };
      case "claim.needs_info":
        return {
          to: claim.creator.email,
          subject: `Claim ${claim.displayNo} needs more information`,
          lines: ["We need a bit more information to review your claim. Open the claim to reply."],
          link,
        };
      case "claim.approved":
        return {
          to: claim.creator.email,
          subject: `Claim ${claim.displayNo} approved`,
          lines: [
            `Your claim is approved.${claim.rma ? ` Your return authorisation is ${claim.rma.displayNo}.` : ""}`,
            "Open the claim for shipping instructions.",
          ],
          link,
        };
      case "claim.rejected":
        return {
          to: claim.creator.email,
          subject: `Update on claim ${claim.displayNo}`,
          lines: ["We couldn't approve your claim. Open it to see the reason and our message."],
          link,
        };
      case "claim.sla_breached":
        // TODO: escalate per settings (team lead, channel) when the assignee is empty. [CONFIRM]
        return claim.assignee
          ? {
              to: claim.assignee.email,
              subject: `SLA breached: ${claim.displayNo}`,
              lines: ["This claim is past its review SLA."],
              link,
            }
          : null;
      default:
        return null;
    }
  }
}
