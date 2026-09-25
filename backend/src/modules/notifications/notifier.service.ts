import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Notification } from "@wms/domain";
import { nextId } from "../../common/db/ids";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { toNotification } from "../../domain/views";

const LATEST = 30;

export interface NotifyExtra {
  params?: Record<string, string | number>;
  /** Frontend route opened when the notification is clicked. */
  link?: string;
}

/**
 * In-app notifications (the header bell). Written in the same transaction as the change they describe, so a
 * notification never announces something that was rolled back. Keys are listed in api-contract §5.12.
 */
@Injectable()
export class Notifier {
  constructor(private readonly prisma: PrismaService) {}

  async latest(userId: string): Promise<Notification[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      // Same instant: keep the order they were written in.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: LATEST,
    });
    return rows.map(toNotification);
  }

  async markRead(userId: string, ids?: readonly string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false, ...(ids ? { id: { in: [...ids] } } : {}) },
      data: { read: true },
    });
  }

  async notify(db: Db, userIds: readonly string[], key: string, now: Date, extra: NotifyExtra = {}): Promise<void> {
    let unique = [...new Set(userIds)];
    if (!unique.length) return;
    // Some submitters aren't logins (e.g. "system" for ERP and email intake); only real users get notifications.
    const existing = await db.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true } });
    const ids = new Set(existing.map((u) => u.id));
    unique = unique.filter((id) => ids.has(id));
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const userId of unique) {
      rows.push({
        id: await nextId(db, "NTF"),
        userId,
        key,
        params: extra.params,
        link: extra.link,
        createdAt: now,
        read: false,
      });
    }
    await db.notification.createMany({ data: rows });
  }

  async adminIds(db: Db): Promise<string[]> {
    const admins = await db.user.findMany({ where: { role: "admin", isActive: true }, select: { id: true } });
    return admins.map((u) => u.id);
  }

  /**
   * Users who follow a record: its customer and, unless excluded, the selling dealer and that dealer's
   * distributor.
   */
  async followers(
    db: Db,
    record: { customerId?: string | null; dealerId?: string | null },
    { includeDealer = true }: { includeDealer?: boolean } = {},
  ): Promise<string[]> {
    const or: Prisma.UserWhereInput[] = [];
    if (record.customerId) or.push({ customerId: record.customerId });
    if (includeDealer && record.dealerId) {
      or.push({ dealerId: record.dealerId });
      const dealer = await db.dealer.findUnique({ where: { id: record.dealerId }, select: { distributorId: true } });
      if (dealer?.distributorId) or.push({ distributorId: dealer.distributorId });
    }
    if (!or.length) return [];
    const users = await db.user.findMany({ where: { OR: or, isActive: true }, select: { id: true } });
    return users.map((u) => u.id);
  }
}
