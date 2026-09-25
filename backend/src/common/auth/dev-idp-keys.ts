import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from "jose";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

const ALG = "RS256";

interface StoredKey {
  kid: string;
  privateJwk: JWK;
  publicJwk: JWK;
}

/**
 * Signing key for the development identity provider. Development and test only: the env schema refuses
 * DEV_IDP_ENABLED in production. The key is persisted (git-ignored) so tokens survive hot reloads.
 */
@Injectable()
export class DevIdpKeys implements OnModuleInit {
  private readonly logger = new Logger(DevIdpKeys.name);
  private stored: StoredKey | null = null;
  private privateKey: KeyLike | Uint8Array | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.DEV_IDP_ENABLED) return;
    this.stored = (await this.load()) ?? (await this.generate());
    this.privateKey = await importJWK(this.stored.privateJwk, ALG);
  }

  get enabled(): boolean {
    return this.stored !== null;
  }

  get alg(): string {
    return ALG;
  }

  get kid(): string {
    return this.require().kid;
  }

  signingKey(): KeyLike | Uint8Array {
    if (!this.privateKey) throw new Error("Dev IdP is not enabled");
    return this.privateKey;
  }

  publicJwks(): { keys: JWK[] } {
    return { keys: [this.require().publicJwk] };
  }

  private require(): StoredKey {
    if (!this.stored) throw new Error("Dev IdP is not enabled");
    return this.stored;
  }

  private async load(): Promise<StoredKey | null> {
    if (!this.env.DEV_IDP_KEY_FILE) return null;
    try {
      return JSON.parse(await readFile(this.env.DEV_IDP_KEY_FILE, "utf8")) as StoredKey;
    } catch {
      return null;
    }
  }

  private async generate(): Promise<StoredKey> {
    const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
    const kid = `dev-${Date.now().toString(36)}`;
    const key: StoredKey = {
      kid,
      privateJwk: { ...(await exportJWK(privateKey)), kid, alg: ALG, use: "sig" },
      publicJwk: { ...(await exportJWK(publicKey)), kid, alg: ALG, use: "sig" },
    };
    if (this.env.DEV_IDP_KEY_FILE) {
      await mkdir(dirname(this.env.DEV_IDP_KEY_FILE), { recursive: true });
      await writeFile(this.env.DEV_IDP_KEY_FILE, JSON.stringify(key), { mode: 0o600 });
      this.logger.log(`Generated dev IdP signing key ${kid}`);
    }
    return key;
  }
}
