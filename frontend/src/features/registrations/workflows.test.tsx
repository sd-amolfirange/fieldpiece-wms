import { screen, within } from "@testing-library/react";
import { addDaysIso, todayIso } from "@wms/domain";
import { adminApi } from "@/features/admin";
import { toApiError } from "@/lib/api-error";
import { http } from "@/lib/http";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";
import { bulkImportsApi, intakeApi, registrationsApi } from "./api";

// W2 (customer self-registration by QR), W1 (dealer bulk registration) and W6 (registration channels) through
// the real pages and the backend demo core (MSW).

// Whole-workflow tests: several screens each, so they get a longer budget than unit tests.
const WORKFLOW_TIMEOUT = 60_000;

afterEach(() => useSession.getState().signOut());

describe("W2: customer self-registration by QR", () => {
  it(
    "opens pre-filled from the QR link, goes to the inbox as Customer portal, and gets its warranty on approval",
    async () => {
      await signInAs("customer.mreed@wms.local");
      const cu01 = renderApp("/register?serial=SM482V-261804517&model=SM482V&batch=2618-L02");
      expect(await screen.findByText("Details read from the QR label on your product.")).toBeInTheDocument();
      expect(screen.getByText("SM482V-261804517")).toBeInTheDocument();
      expect(screen.getByText("2618-L02")).toBeInTheDocument();
      expect(await screen.findByText("SMAN Wireless 4-Port Digital Manifold (SM482V)")).toBeInTheDocument();

      await cu01.user.type(screen.getByLabelText(/purchase date/i), addDaysIso(todayIso(), -2));
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      await cu01.user.upload(input!, new File(["jpeg"], "receipt.jpg", { type: "image/jpeg" }));
      await cu01.user.click(screen.getByRole("button", { name: "Register product" }));
      expect(await screen.findByRole("heading", { name: "Registration sent" })).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
      cu01.unmount();

      // Admin: the registration is in the inbox as a portal registration; approve it on the review screen.
      await signInAs("admin@wms.local");
      const pending = await registrationsApi.list({ status: "PENDING" });
      const reg = pending.items.find((r) => r.serial === "SM482V-261804517")!;
      expect(reg.channel).toBe("PORTAL");
      expect(reg.batchNumber).toBe("2618-L02");
      expect(reg.attachmentIds).toHaveLength(1);

      const a03 = renderApp(`/registrations/${reg.id}`);
      expect(await screen.findByText("Customer portal")).toBeInTheDocument();
      expect(screen.getByText("Receipt or invoice")).toBeInTheDocument();
      await a03.user.click(screen.getByRole("button", { name: "Approve" }));
      expect(await screen.findByRole("link", { name: "Open product" })).toBeInTheDocument();
      a03.unmount();

      // A05: a 1-year warranty from the purchase date; QR label with the batch.
      const a05 = renderApp("/units/SM482V-261804517");
      expect(await screen.findByRole("heading", { name: "QR label" })).toBeInTheDocument();
      expect(await screen.findByText("1 year from the date of purchase")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "QR code for SM482V-261804517" })).toBeInTheDocument();
      a05.unmount();

      // Customer: the product is theirs now.
      await signInAs("customer.mreed@wms.local");
      renderApp("/");
      expect(await screen.findByText("SM482V-261804517")).toBeInTheDocument();
    },
    WORKFLOW_TIMEOUT,
  );
});

describe("W1: dealer bulk registration", () => {
  const header =
    "Serial number,Batch number,Model,Purchase date,Customer name,Customer phone,Customer email,City,State,ZIP,Invoice number";
  const day = addDaysIso(todayIso(), -3);
  const csv = [
    header,
    `263599101,2635-L01,SC680,${day},Adam Rhodes,(713) 555-0120,,Houston,TX,77002,LS-1`,
    `263599102,2635-L02,VP87,${day},Bianca Flores,(713) 555-0121,,Pasadena,TX,77502,LS-2`,
    `263599103,2635-L01,SC690,${day},Carl Jenkins,(713) 555-0122,,Pearland,TX,77581,LS-3`,
    `MG44-252811902,2528-L01,MG44,${day},Dana Scott,(713) 555-0123,,Spring,TX,77373,LS-4`,
    "263599105,2635-L03,SRS1,,Eric Lawson,(713) 555-0124,,Katy,TX,77450,LS-5",
  ].join("\n");

  it(
    "registers clean rows, flags the rest, fixes inline, and sends only the duplicate to the warranty desk",
    async () => {
      await signInAs("dealer.lonestar@wms.local");
      const batch = await bulkImportsApi.upload(
        new File([csv], "lonestar_week.csv", { type: "text/csv" }),
        undefined,
      );
      expect(batch.counts).toEqual({ total: 5, registered: 2, errors: 2, review: 1 });
      expect(batch.rows.find((r) => r.values.serial === "263599103")?.errors).toEqual({
        modelCode: "unknown_model",
      });
      expect(batch.rows.find((r) => r.values.serial === "263599105")?.errors).toEqual({
        purchaseDate: "required",
      });

      // DL02 shows the rows; fix the model and the date inline, then resubmit.
      const dl02 = renderApp(`/registrations/bulk?batch=${batch.id}`);
      expect(
        await screen.findByText(/5 rows checked: 2 registered, 2 need fixing, 1 sent to the warranty desk/),
      ).toBeInTheDocument();
      await dl02.user.selectOptions(screen.getAllByLabelText("Model, row 4")[0]!, "SC680");
      await dl02.user.type(screen.getAllByLabelText("Purchase date, row 6")[0]!, day);
      await dl02.user.click(screen.getByRole("button", { name: "Resubmit 2 fixed rows" }));
      expect(
        await screen.findByText(/5 rows checked: 4 registered, 0 need fixing, 1 sent to the warranty desk/),
      ).toBeInTheDocument();
      dl02.unmount();

      // DL04: the new products are Active, with their batch numbers.
      const dl04 = renderApp("/units?q=26359");
      const table = await screen.findByRole("table");
      expect(await within(table).findAllByText("Active")).toHaveLength(4);
      expect(within(table).getAllByText("2635-L01").length).toBeGreaterThan(0);
      dl04.unmount();

      // A02: only the duplicate needs a human.
      await signInAs("admin@wms.local");
      // The seed inbox has other duplicates too; this upload added exactly one, pending, with the existing record.
      const duplicates = await registrationsApi.list({ flag: "DUPLICATE", status: "PENDING", pageSize: 100 });
      const fromUpload = duplicates.items.filter(
        (r) => r.channel === "BULK" && r.serial === "MG44-252811902",
      );
      expect(fromUpload).toHaveLength(1);
      expect(fromUpload[0]?.duplicateOf?.customerName).toBe("James Nguyen");
    },
    WORKFLOW_TIMEOUT,
  );
});

describe("W6: registration channels", () => {
  it(
    "takes ERP, email, marketplace, web form and partner registrations, logs the CRM update and counts the channel",
    async () => {
      await signInAs("admin@wms.local");
      const channelCount = async (label: string) => {
        const a01 = renderApp("/");
        const card = (await screen.findByRole("heading", { name: "Registrations by channel" })).closest(
          "section",
        )!;
        await a01.user.click(within(card).getByRole("button", { name: "View data" }));
        const cell = within(card).queryByText(label);
        const value = cell ? Number(cell.closest("tr")!.lastElementChild?.textContent) : 0;
        a01.unmount();
        return value;
      };
      const emailBefore = await channelCount("Email");

      // A13: ERP invoice with 3 serials, a registration email with the receipt, 2 marketplace orders.
      const erp = await adminApi.simulateErpInvoice();
      expect(erp.map((r) => r.channel)).toEqual(["ERP", "ERP", "ERP"]);
      expect(new Set(erp.map((r) => r.serial)).size).toBe(3);
      const email = await adminApi.simulateRegistrationEmail();
      expect(email.channel).toBe("EMAIL");
      expect(email.attachmentIds).toHaveLength(1);
      const market = await adminApi.simulateMarketplaceOrder();
      expect(market.map((r) => [r.channel, r.status])).toEqual([
        ["RETAIL", "APPROVED"],
        ["RETAIL", "APPROVED"],
      ]);

      // Website form: no account, a receipt, always reviewed.
      useSession.getState().signOut();
      const web = await intakeApi.publicRegister(
        {
          serial: "263899911",
          batchNumber: "2638-L02",
          modelCode: "SC260",
          purchaseDate: addDaysIso(todayIso(), -1),
          customerName: "Jordan Lee",
          customerEmail: "jordan.lee@example.com",
          state: "TX",
          zip: "77002",
        },
        new File(["jpeg"], "receipt.jpg", { type: "image/jpeg" }),
      );
      expect(web.status).toBe("PENDING");
      await signInAs("admin@wms.local");

      // A02: new items with their channel badges, same Pending status as every reviewed channel.
      const a02 = renderApp("/registrations?status=PENDING");
      const table = await screen.findByRole("table");
      const emailRow = (await within(table).findByText(new RegExp(email.serial))).closest("tr")!;
      expect(within(emailRow).getByText("Email")).toBeInTheDocument();
      const erpRow = within(table).getByText(new RegExp(erp[0]!.serial)).closest("tr")!;
      expect(within(erpRow).getByText("Distributor ERP")).toBeInTheDocument();
      const webRow = within(table)
        .getByText(/263899911/)
        .closest("tr")!;
      expect(within(webRow).getByText("Web form")).toBeInTheDocument();
      a02.unmount();

      // A03: approve the emailed registration.
      const a03 = renderApp(`/registrations/${email.id}`);
      await a03.user.click(await screen.findByRole("button", { name: "Approve" }));
      expect(await screen.findByRole("link", { name: "Open product" })).toBeInTheDocument();
      a03.unmount();

      // Partner API: a new key registers a product at once and is refused once turned off.
      const { client, apiKey } = await intakeApi.createPartnerClient({
        name: "Bayou Air Parts point of sale",
        channel: "API",
        dealerId: "d-bayou",
      });
      expect(apiKey).toMatch(/^fpk_/);
      const send = (key: string) =>
        http
          .post<{ results: { status: string }[] }>(
            "/partner/v1/registrations",
            {
              serial: "263899921",
              batchNumber: "2638-L01",
              modelCode: "SC680",
              purchaseDate: addDaysIso(todayIso(), -1),
              customer: { name: "Kyle Fontenot", state: "LA", zip: "70802" },
            },
            { headers: { "X-Api-Key": key }, skipAuthRefresh: true },
          )
          .then(
            (r) => ({ status: r.status, results: r.data.results }),
            (e: unknown) => ({ status: toApiError(e).status, results: [] }),
          );
      const accepted = await send(apiKey);
      expect(accepted.status).toBe(200);
      expect(accepted.results[0]?.status).toBe("REGISTERED");
      await intakeApi.setPartnerActive(client.id, false);
      expect((await send(apiKey)).status).toBe(401);

      // A12: inbound ERP and email, outbound CRM update for the approved email registration.
      const log = (await adminApi.integrations({ pageSize: 100 })).items;
      expect(log.some((m) => m.system === "ERP" && m.direction === "IN" && m.type === "erp_invoice")).toBe(
        true,
      );
      expect(log.some((m) => m.system === "EMAIL" && m.direction === "IN" && m.refId === email.id)).toBe(
        true,
      );
      expect(log.some((m) => m.system === "CRM" && m.direction === "OUT" && m.refId === email.id)).toBe(true);

      // A01: the channel chart counts the approved email registration.
      expect(await channelCount("Email")).toBe(emailBefore + 1);
    },
    WORKFLOW_TIMEOUT,
  );
});
