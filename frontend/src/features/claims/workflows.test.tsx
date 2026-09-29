import { screen, within } from "@testing-library/react";
import { adminApi } from "@/features/admin";
import { toApiError } from "@/lib/api-error";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";
import { claimsApi } from "./api";

// W3 (claim settled by replacement), W4 (dealer claim settled by credit) and W5 (void warranty) through the real
// pages and the backend demo core (MSW).

const WORKFLOW_TIMEOUT = 60_000;

afterEach(() => useSession.getState().signOut());

describe("W3: warranty claim settled by replacement", () => {
  it(
    "files a claim with its coverage, then the desk reviews, approves a replacement and closes it with the new serial",
    async () => {
      // CU04: the customer picks the product, sees the coverage and describes the problem.
      await signInAs("customer.mreed@wms.local");
      const cu04 = renderApp("/claims/new?serial=SC680-251406233");
      expect(await screen.findByText(/In warranty until .+\. The claim is covered\./)).toBeInTheDocument();
      await cu04.user.selectOptions(screen.getByLabelText(/What's wrong/), "DISPLAY");
      await cu04.user.type(
        screen.getByLabelText(/Description/),
        "The display goes blank when the head swivels past 90 degrees.",
      );
      await cu04.user.click(screen.getByRole("button", { name: "Submit claim" }));
      expect(await screen.findByRole("heading", { name: "Progress" })).toBeInTheDocument();
      cu04.unmount();
      const [claim] = (await claimsApi.list({ q: "SC680-251406233" })).items;
      expect(claim).toMatchObject({ status: "SUBMITTED", source: "CUSTOMER", issueType: "DISPLAY" });

      // One open claim per product.
      await expect(
        claimsApi.create({
          unitSerial: "SC680-251406233",
          issueType: "OTHER",
          description: "Second claim attempt.",
          attachmentIds: [],
        }),
      ).rejects.toMatchObject({ status: 409 });

      // A10: start review, approve a replacement, close with the replacement serial.
      await signInAs("admin@wms.local");
      const a10 = renderApp(`/claims/${claim!.id}`);
      expect(await screen.findByRole("heading", { name: "Coverage when filed" })).toBeInTheDocument();
      await a10.user.click(screen.getByRole("button", { name: "Start review" }));
      await a10.user.click(await screen.findByRole("button", { name: "Approve" }));
      const approve = await screen.findByRole("dialog");
      await a10.user.selectOptions(within(approve).getByLabelText(/Resolution/), "REPLACE");
      await a10.user.click(within(approve).getByRole("button", { name: "Approve" }));
      expect(await screen.findByText("Approved for replacement under warranty.")).toBeInTheDocument();
      await a10.user.click(screen.getByRole("button", { name: "Close claim" }));
      const close = await screen.findByRole("dialog");
      await a10.user.type(within(close).getByLabelText(/Replacement serial number/), "263899901");
      await a10.user.type(within(close).getByLabelText(/Replacement batch number/), "2638-L01");
      await a10.user.click(within(close).getByRole("button", { name: "Close claim" }));
      expect(await screen.findByText("Replaced under warranty with SC680-263899901.")).toBeInTheDocument();
      a10.unmount();

      // The customer owns the replacement, with the rest of the warranty.
      await signInAs("customer.mreed@wms.local");
      renderApp("/");
      expect(await screen.findByText("SC680-263899901")).toBeInTheDocument();
      expect(screen.getByText("Replaced under warranty by SC680-263899901")).toBeInTheDocument();
    },
    WORKFLOW_TIMEOUT,
  );
});

describe("W4: dealer claim settled by credit", () => {
  it(
    "lets the dealer file and follow a claim, but only the desk decides it; the credit goes to Finance",
    async () => {
      await signInAs("dealer.lonestar@wms.local");
      const claim = await claimsApi.create({
        unitSerial: "MG44-252811902",
        issueType: "CONNECTIVITY",
        description: "Gauge drops the Job Link connection every few minutes.",
        attachmentIds: [],
      });
      expect(claim.source).toBe("DEALER");
      const denied = await claimsApi.act(claim.id, { action: "start_review" }).catch((e: unknown) => e);
      expect(toApiError(denied).status).toBe(403);

      await signInAs("admin@wms.local");
      await claimsApi.act(claim.id, { action: "start_review" });
      const a10 = renderApp(`/claims/${claim.id}`);
      await a10.user.click(await screen.findByRole("button", { name: "Approve" }));
      const approve = await screen.findByRole("dialog");
      await a10.user.selectOptions(within(approve).getByLabelText(/Resolution/), "CREDIT");
      await a10.user.type(within(approve).getByLabelText(/Credit amount \(USD\)/), "89.50");
      await a10.user.click(within(approve).getByRole("button", { name: "Approve" }));
      expect(await screen.findByText("Approved for a credit of $89.50.")).toBeInTheDocument();
      await a10.user.click(screen.getByRole("button", { name: "Close claim" }));
      await a10.user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Close claim" }),
      );
      expect(await screen.findByText("Credit of $89.50 issued.")).toBeInTheDocument();
      a10.unmount();

      const log = (await adminApi.integrations({ pageSize: 100 })).items;
      expect(
        log.some((m) => m.system === "FINANCE" && m.type === "credit_memo" && m.refId === claim.id),
      ).toBe(true);

      // DL07: the dealer sees the outcome in its list.
      await signInAs("dealer.lonestar@wms.local");
      renderApp("/claims");
      const row = (await screen.findAllByText(claim.id)).map((e) => e.closest("tr")).find(Boolean)!;
      expect(within(row).getByText("$89.50")).toBeInTheDocument();
    },
    WORKFLOW_TIMEOUT,
  );
});

describe("W5: void warranty", () => {
  it(
    "voids the warranty with a reason, and a later claim is recorded as not covered",
    async () => {
      await signInAs("admin@wms.local");
      const a05 = renderApp("/units/DR82-252207119");
      await a05.user.click(await screen.findByRole("button", { name: "Void warranty" }));
      const dialog = await screen.findByRole("dialog");
      await a05.user.selectOptions(within(dialog).getByLabelText(/Reason/), "UNAUTHORIZED_REPAIR");
      await a05.user.click(within(dialog).getByRole("button", { name: "Void warranty" }));
      expect(await screen.findByText(/Warranty void: unauthorized repair\./)).toBeInTheDocument();
      a05.unmount();

      await signInAs("customer.mreed@wms.local");
      const cu04 = renderApp("/claims/new?serial=DR82-252207119");
      expect(await screen.findByText(/warranty on this product is void/)).toBeInTheDocument();
      cu04.unmount();
      const claim = await claimsApi.create({
        unitSerial: "DR82-252207119",
        issueType: "INACCURATE_READING",
        description: "No longer alarms on a known R-410A leak.",
        attachmentIds: [],
      });
      expect(claim.coverage).toMatchObject({ covered: false, reason: "VOID" });
    },
    WORKFLOW_TIMEOUT,
  );
});
