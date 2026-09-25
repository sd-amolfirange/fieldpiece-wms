import { AuthUser } from "./auth-user";
import type { Role } from "./roles";
import { claimScope, customerScope, registrationScope, rmaScope } from "./scope";

const user = (roles: Role[], organizationId: string | null = "org-1") =>
  new AuthUser("user-1", "u@example.com", "U", roles, organizationId, "USD", true);

describe("data scope", () => {
  it("gives agents and admins everything", () => {
    for (const roles of [["claims_agent"], ["admin"]] as Role[][]) {
      expect(claimScope(user(roles))).toEqual({});
      expect(registrationScope(user(roles))).toEqual({});
      expect(rmaScope(user(roles))).toEqual({});
      expect(customerScope(user(roles))).toEqual({ deletedAt: null });
    }
  });

  it("limits distributors to their organisation", () => {
    const d = user(["distributor"]);
    expect(claimScope(d)).toEqual({ registration: { distributorId: "org-1" } });
    expect(registrationScope(d)).toEqual({ distributorId: "org-1" });
    expect(customerScope(d)).toEqual({ deletedAt: null, distributorId: "org-1" });
  });

  it("limits service centers to RMAs routed to them", () => {
    const s = user(["service_center"]);
    expect(claimScope(s)).toEqual({ rma: { serviceCenterId: "org-1" } });
    expect(rmaScope(s)).toEqual({ serviceCenterId: "org-1" });
  });

  it("limits technicians to their own rows", () => {
    const t = user(["technician"], null);
    expect(claimScope(t)).toEqual({ createdBy: "user-1" });
    expect(registrationScope(t)).toEqual({
      OR: [{ createdBy: "user-1" }, { customer: { userId: "user-1" } }],
    });
    expect(customerScope(t)).toEqual({ deletedAt: null, userId: "user-1" });
    expect(rmaScope(t)).toEqual({ claim: { createdBy: "user-1" } });
  });

  it("shows nothing to an org-bound role with no organisation", () => {
    const orphan = user(["distributor"], null);
    expect(registrationScope(orphan)).toEqual({ distributorId: "00000000-0000-0000-0000-000000000000" });
  });

  it("uses the most privileged role when a user has several", () => {
    expect(claimScope(user(["technician", "claims_agent"]))).toEqual({});
  });
});
