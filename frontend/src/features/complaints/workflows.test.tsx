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

describe("W4: dealer complaint on behalf of a customer", () => {
  const DEALER_UNIT = "AER-SPL18-251120";

  it(
    "finds only its own units, raises with the admin's entitlement preview, and follows the claim without acting",
    async () => {
      // DL04: the dealer finds its sold unit; another dealer's unit isn't there.
      await signInAs("dealer.coolair@demo.wms");
      const dl04 = renderApp(`/units?q=${DEALER_UNIT}`);
      expect(await within(await screen.findByRole("table")).findByText(DEALER_UNIT)).toBeInTheDocument();
      dl04.unmount();
      await expect(complaintsApi.entitlement("KEL-CAS30-240220")).rejects.toMatchObject({ status: 404 });

      // DL05 -> DL06: part-wise status, then raise with a photo; same entitlement as the admin sees.
      const adminView = await (async () => {
        await signInAs("admin@demo.wms");
        const e = await complaintsApi.entitlement(DEALER_UNIT);
        await signInAs("dealer.coolair@demo.wms");
        return e;
      })();
      const dl05 = renderApp(`/units/${DEALER_UNIT}`);
      await dl05.user.click(await screen.findByRole("link", { name: "Raise complaint" }));
      expect(await screen.findByText(`What's covered for ${DEALER_UNIT}`)).toBeInTheDocument();
      expect(await complaintsApi.entitlement(DEALER_UNIT)).toEqual(adminView);
      await dl05.user.type(screen.getByLabelText(/what's wrong/i), "Water leaking from indoor unit");
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      await dl05.user.upload(input!, new File(["jpeg"], "leak.jpg", { type: "image/jpeg" }));
      await dl05.user.click(screen.getByRole("button", { name: "Raise complaint" }));
      expect(await screen.findByText("Progress")).toBeInTheDocument();
      dl05.unmount();

      // A07: source Dealer with the dealer's name; only the admin can send it to service.
      await signInAs("admin@demo.wms");
      const complaint = (await complaintsApi.list({ sort: "-createdAt" })).items[0]!;
      expect(complaint.source).toBe("DEALER");
      const a07 = renderApp("/complaints");
      const row = (await within(await screen.findByRole("table")).findByText(complaint.id)).closest("tr")!;
      expect(within(row).getByText("Dealer")).toBeInTheDocument();
      expect(within(row).getAllByText("CoolAir Traders").length).toBeGreaterThan(0);
      a07.unmount();

      // DL07: tracker per complaint and claims view only; the dealer can't change a claim.
      await signInAs("dealer.coolair@demo.wms");
      const dl07 = renderApp("/complaints");
      const trackers = await screen.findAllByRole("list", { name: "Progress" });
      expect(trackers.length).toBeGreaterThan(0);
      await dl07.user.click(screen.getByRole("tab", { name: "Claims" }));
      expect(await screen.findByText(/you can follow their status here/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Submit|Approve|Mark paid/ })).not.toBeInTheDocument();
      dl07.unmount();
      const claims = await claimsApi.list({});
      expect(claims.items.length).toBeGreaterThan(0);
      await expect(claimsApi.act(claims.items[0]!.id, { action: "approve" })).rejects.toMatchObject({
        status: 403,
      });
    },
    WORKFLOW_TIMEOUT,
  );
});

describe("W5: void warranty and chargeable repair", () => {
  const VOID_UNIT = "AER-SPL18-230502";

  it(
    "records the void with reason, user and date, shows it to the customer, and never raises a claim",
    async () => {
      // A05: Void warranty with a reason and a note.
      await signInAs("admin@demo.wms");
      const a05 = renderApp(`/units/${VOID_UNIT}`);
      await a05.user.click(await screen.findByRole("button", { name: "Void warranty" }));
      const dialog = await screen.findByRole("dialog");
      await a05.user.selectOptions(within(dialog).getByLabelText(/Reason/), "UNAUTHORISED_REPAIR");
      await a05.user.type(
        within(dialog).getByLabelText(/Note/),
        "Warranty seal broken by a local technician.",
      );
      await a05.user.click(within(dialog).getByRole("button", { name: "Void warranty" }));
      expect(await screen.findByText(/Voided by WMS office admin on/)).toBeInTheDocument();
      await a05.user.click(screen.getByRole("tab", { name: "Service & claim history" }));
      expect(await screen.findByText("voided the warranty: unauthorised repair")).toBeInTheDocument();
      a05.unmount();

      // CU03: the customer sees Void with the reason.
      await signInAs("customer.rk@demo.wms");
      const cu03 = renderApp(`/units/${VOID_UNIT}`);
      expect(await screen.findByText(/Warranty void: unauthorised repair/)).toBeInTheDocument();
      cu03.unmount();

      // CU04: the form shows the visit is chargeable.
      const cu04 = renderApp(`/complaints/new?serial=${VOID_UNIT}`);
      expect(await screen.findByText(/warranty on this unit is void/)).toBeInTheDocument();
      expect(screen.getByText("Nothing to claim from the manufacturer for this job.")).toBeInTheDocument();
      await cu04.user.type(screen.getByLabelText(/what's wrong/i), "Not cooling at night");
      await cu04.user.click(screen.getByRole("button", { name: "Raise complaint" }));
      expect(await screen.findByText("Progress")).toBeInTheDocument();
      cu04.unmount();

      // A08: Chargeable; send to service; the job result creates no claim.
      await signInAs("admin@demo.wms");
      const complaint = (await complaintsApi.list({ sort: "-createdAt" })).items[0]!;
      expect(complaint.unitSerial).toBe(VOID_UNIT);
      expect(complaint.entitlement).toMatchObject({
        parts: "CHARGEABLE",
        labour: "CHARGEABLE",
        claimable: false,
      });
      const claimsBefore = (await claimsApi.list({})).total;
      await complaintsApi.sendToService(complaint.id);
      const resolved = await adminApi.simulateJobResult({ complaintId: complaint.id, partType: "PCB" });
      expect(resolved.claimId).toBeUndefined();
      expect((await claimsApi.list({})).total).toBe(claimsBefore);
    },
    WORKFLOW_TIMEOUT,
  );
});
