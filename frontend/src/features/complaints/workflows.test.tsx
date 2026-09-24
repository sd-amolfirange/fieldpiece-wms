import { screen, within } from "@testing-library/react";
import { adminApi } from "@/features/admin";
import { claimsApi } from "@/features/claims";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";
import { complaintsApi } from "./api";

// W3 (customer complaint on an old unit, covered compressor, service hand-off, manufacturer claim) through the
// real pages and the backend demo core (MSW). The simulator steps call the same endpoints as the A13 buttons.

const WORKFLOW_TIMEOUT = 30_000;
const SERIAL = "AER-SPL15-210311";

afterEach(() => useSession.getState().signOut());

describe("W3: customer complaint to manufacturer claim", () => {
  it(
    "shows cover before submit, hands off to service, resolves with a new part warranty and recovers the claim",
    async () => {
      // CU04: the entitlement is shown before submitting.
      await signInAs("customer.rk@demo.wms");
      const cu04 = renderApp(`/complaints/new?serial=${SERIAL}`);
      expect(await screen.findByText(`What's covered for ${SERIAL}`)).toBeInTheDocument();
      expect(await screen.findByText("Covered: Compressor.")).toBeInTheDocument();
      expect(screen.getByText("Labour is chargeable.")).toBeInTheDocument();
      await cu04.user.type(screen.getByLabelText(/what's wrong/i), "No cooling");
      await cu04.user.click(screen.getByRole("button", { name: "Raise complaint" }));
      expect(await screen.findByText("Progress")).toBeInTheDocument();
      cu04.unmount();

      // A07: newest first, source Customer.
      await signInAs("admin@demo.wms");
      const list = await complaintsApi.list({ sort: "-createdAt" });
      const complaint = list.items[0]!;
      expect(complaint.unitSerial).toBe(SERIAL);
      expect(complaint.source).toBe("CUSTOMER");

      // A08: entitlement panel and Send to service system.
      const a08 = renderApp(`/complaints/${complaint.id}`);
      expect(await screen.findByText("What's covered")).toBeInTheDocument();
      await a08.user.click(screen.getByRole("button", { name: "Send to service system" }));
      expect(await screen.findAllByText("With service")).not.toHaveLength(0);
      a08.unmount();

      // A12: outbound service request with unit, part serials and entitlement.
      const log = await adminApi.integrations({ system: "SERVICE", direction: "OUT" });
      const request = log.items.find((m) => m.refId === complaint.id)!;
      expect(request.type).toBe("service_request");
      expect(JSON.stringify(request.payload)).toContain(SERIAL);

      // A13: the service system returns the job result.
      const resolved = await adminApi.simulateJobResult({
        complaintId: complaint.id,
        partType: "COMPRESSOR",
      });
      expect(resolved.status).toBe("RESOLVED");
      expect(resolved.jobResult?.partsReplaced[0]?.partType).toBe("COMPRESSOR");
      expect(resolved.jobResult?.photos).toHaveLength(2);
      const claimId = resolved.claimId!;

      // A08: job result with old and new serials, photos and sign-off.
      const a08b = renderApp(`/complaints/${complaint.id}`);
      expect(await screen.findByRole("heading", { name: "Job result" })).toBeInTheDocument();
      expect(screen.getByText("Customer sign-off")).toBeInTheDocument();
      a08b.unmount();

      // A05: part history shows the replacement and links the claim.
      const a05 = renderApp(`/units/${SERIAL}`);
      await a05.user.click(await screen.findByRole("tab", { name: "Service & claim history" }));
      expect(await screen.findByText("replaced a part")).toBeInTheDocument();
      expect(await screen.findByRole("link", { name: `created claim ${claimId}` })).toBeInTheDocument();
      a05.unmount();

      // A09: the new claim is Draft.
      const a09 = renderApp("/claims");
      const table = await screen.findByRole("table");
      const row = (await within(table).findByText(claimId)).closest("tr")!;
      expect(within(row).getByText("Draft")).toBeInTheDocument();
      a09.unmount();

      // A10: add RMA number and amount, submit to the manufacturer.
      const a10 = renderApp(`/claims/${claimId}`);
      expect(
        await screen.findByRole("heading", { name: "Evidence from the job result" }),
      ).toBeInTheDocument();
      await a10.user.click(screen.getByRole("button", { name: "Submit to manufacturer" }));
      await a10.user.type(await screen.findByLabelText(/RMA number/), "RMA-AER-7781");
      await a10.user.type(screen.getByLabelText(/Amount claimed/), "8500");
      const dialog = screen.getByRole("dialog");
      await a10.user.click(within(dialog).getByRole("button", { name: "Submit to manufacturer" }));
      expect(await screen.findAllByText("Submitted")).not.toHaveLength(0);
      a10.unmount();

      // A13: the manufacturer approves; A10: mark paid, settlement posted to Finance.
      await adminApi.simulateOemDecision({ claimId, decision: "APPROVED" });
      const a10b = renderApp(`/claims/${claimId}`);
      await a10b.user.click(await screen.findByRole("button", { name: "Mark paid" }));
      expect(await screen.findAllByText("Posted to Finance")).not.toHaveLength(0);
      a10b.unmount();
      const paid = await claimsApi.get(claimId);
      expect(paid.status).toBe("PAID");
      const finance = await adminApi.integrations({ system: "FINANCE" });
      expect(finance.items.some((m) => m.refId === claimId && m.type === "finance_posting")).toBe(true);

      // CU05: the customer's timeline shows Resolved with the new part warranty.
      await signInAs("customer.rk@demo.wms");
      renderApp(`/complaints/${complaint.id}`);
      expect(await screen.findByText(/New Compressor .* is under warranty until/)).toBeInTheDocument();
      expect(screen.getAllByText("Resolved").length).toBeGreaterThan(0);
    },
    WORKFLOW_TIMEOUT,
  );
});
