import type { RequestContext } from "../../common/auth/auth-user";
import type { Tx } from "../../infra/prisma/prisma.service";
import type { Resolution } from "./claim-state-machine";

/**
 * Port for creating the RMA when a claim is approved (Section 8.3 step 6), implemented by the RMA module.
 * It keeps claims free of an import on rma, which itself depends on claims for its lifecycle.
 */
export abstract class RmaIssuer {
  abstract issue(
    tx: Tx,
    ctx: RequestContext,
    claim: { id: string; resolution: Resolution },
  ): Promise<{ id: string; displayNo: string }>;
}
