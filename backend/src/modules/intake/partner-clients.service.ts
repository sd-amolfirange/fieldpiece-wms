import { Injectable } from "@nestjs/common";
import type { PartnerClientView, RegistrationChannel } from "@wms/domain";
import { createHash, randomBytes } from "node:crypto";
import { opt } from "../../common/db/dates";
import { AppError } from "../../common/errors/app-error";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";

// Partner systems that send registrations through the partner API (distributor ERPs, online marketplaces, retail
// chains). Each has an API key; only its SHA-256 is stored, and the key itself is shown once, when it's created.

export type PartnerChannel = Extract<RegistrationChannel, "API" | "RETAIL" | "ERP">;
export const PARTNER_CHANNELS: readonly PartnerChannel[] = ["API", "RETAIL", "ERP"];

export interface PartnerClientRow {
  id: string;
  name: string;
  channel: PartnerChannel;
  dealerId: string | null;
}

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** "fpk_" + 40 random characters. The prefix identifies Fieldpiece partner keys in logs and secret scanners. */
export const newApiKey = () => `fpk_${randomBytes(30).toString("base64url")}`;

const invalidKey = () =>
  new AppError(401, "invalid_api_key", "The API key is missing, wrong or no longer active.");

@Injectable()
export class PartnerClientsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The partner behind an X-Api-Key header, or 401. Records when the key was last used. */
  async authenticate(key: string | undefined, now: Date): Promise<PartnerClientRow> {
    if (!key || !key.startsWith("fpk_") || key.length > 200) throw invalidKey();
    const client = await this.prisma.partnerClient.findUnique({ where: { keyHash: hashApiKey(key) } });
    if (!client || !client.active) throw invalidKey();
    await this.prisma.partnerClient.update({ where: { id: client.id }, data: { lastUsedAt: now } });
    return {
      id: client.id,
      name: client.name,
      channel: client.channel as PartnerChannel,
      dealerId: client.dealerId,
    };
  }

  async list(): Promise<PartnerClientView[]> {
    const rows = await this.prisma.partnerClient.findMany({
      include: { dealer: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      channel: r.channel as PartnerChannel,
      dealerId: opt(r.dealerId),
      dealerName: opt(r.dealer?.name),
      keyPrefix: r.keyPrefix,
      active: r.active,
      lastUsedAt: r.lastUsedAt?.toISOString(),
    }));
  }

  /** Creates a partner and returns its API key, which is never shown again. */
  async create(
    body: { name?: unknown; channel?: unknown; dealerId?: unknown },
    now: Date,
  ): Promise<{ client: PartnerClientView; apiKey: string }> {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const channel = body.channel as PartnerChannel;
    const dealerId = typeof body.dealerId === "string" && body.dealerId ? body.dealerId : undefined;
    const errors: Record<string, string> = {};
    if (!name) errors.name = "validation.required";
    if (!PARTNER_CHANNELS.includes(channel)) errors.channel = "validation.channel";
    if (dealerId && !(await this.prisma.dealer.findUnique({ where: { id: dealerId } })))
      errors.dealerId = "validation.pickDealer";
    if (Object.keys(errors).length) throw AppError.validation("Check the highlighted fields.", errors);
    const apiKey = newApiKey();
    const id = `pc-${randomBytes(6).toString("hex")}`;
    await this.insert(this.prisma, { id, name, channel, dealerId, apiKey }, now);
    const client = (await this.list()).find((c) => c.id === id)!;
    return { client, apiKey };
  }

  async setActive(id: string, active: boolean): Promise<PartnerClientView> {
    const updated = await this.prisma.partnerClient.updateMany({ where: { id }, data: { active } });
    if (!updated.count) throw AppError.notFound("Partner");
    return (await this.list()).find((c) => c.id === id)!;
  }

  /** Also used by the seed for the demo partners. */
  async insert(
    db: Db,
    input: { id: string; name: string; channel: PartnerChannel; dealerId?: string; apiKey: string },
    now: Date,
  ): Promise<void> {
    await db.partnerClient.create({
      data: {
        id: input.id,
        name: input.name,
        channel: input.channel,
        dealerId: input.dealerId,
        keyHash: hashApiKey(input.apiKey),
        keyPrefix: input.apiKey.slice(0, 12),
        createdAt: now,
      },
    });
  }
}
