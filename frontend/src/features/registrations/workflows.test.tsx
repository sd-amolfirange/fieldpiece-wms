import { screen, within } from "@testing-library/react";
import { addDaysIso, todayIso } from "@wms/domain";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";
import { bulkImportsApi, registrationsApi } from "./api";

// W2 (customer self-registration by QR) and W1 (dealer bulk registration) through the real pages and the
// backend demo core (MSW).

// Whole-workflow tests: several screens each, so they get a longer budget than unit tests.
const WORKFLOW_TIMEOUT = 30_000;

afterEach(() => useSession.getState().signOut());

describe("W2: customer self-registration by QR", () => {
  it(
    "opens pre-filled from the QR link, goes to the admin inbox as Portal, and gets part-wise warranty on approval",
    async () => {
      await signInAs("customer.rk@demo.wms");
      const cu01 = renderApp("/register?serial=AER-SPL15-240917&model=AER-SPL15");
      expect(await screen.findByText("Details read from the QR label on your unit.")).toBeInTheDocument();
      expect(screen.getByText("AER-SPL15-240917")).toBeInTheDocument();
      expect(await screen.findByText("Aeris Split 1.5 TR (AER-SPL15)")).toBeInTheDocument();

      await cu01.user.type(screen.getByLabelText(/purchase date/i), addDaysIso(todayIso(), -2));
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      await cu01.user.upload(input!, new File(["jpeg"], "invoice.jpg", { type: "image/jpeg" }));
      await cu01.user.click(screen.getByRole("button", { name: "Register product" }));
      expect(await screen.findByRole("heading", { name: "Registration sent" })).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
      cu01.unmount();

      // Admin: the registration is in the inbox with a Portal badge; approve it on the review screen.
      await signInAs("admin@demo.wms");
      const pending = await registrationsApi.list({ status: "PENDING" });
      const reg = pending.items.find((r) => r.serial === "AER-SPL15-240917")!;
      expect(reg.channel).toBe("PORTAL");
      expect(reg.attachmentIds).toHaveLength(1);

      const a03 = renderApp(`/registrations/${reg.id}`);
      expect(await screen.findByText("Portal")).toBeInTheDocument();
      expect(screen.getByText("Invoice")).toBeInTheDocument();
      await a03.user.click(screen.getByRole("button", { name: "Approve" }));
      expect(await screen.findByRole("link", { name: "Open unit" })).toBeInTheDocument();
      a03.unmount();

      // A05: unit 1 year, compressor 10 years, PCB 5 years, each tracked separately; QR label generated.
      const a05 = renderApp("/units/AER-SPL15-240917");
      expect(await screen.findByRole("heading", { name: "QR label" })).toBeInTheDocument();
      const rows = await screen.findAllByText(/^(Unit|Compressor|PCB)$/);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(screen.getByRole("img", { name: "QR code for AER-SPL15-240917" })).toBeInTheDocument();
      a05.unmount();

      // Customer: the unit is theirs now, with a notification.
      await signInAs("customer.rk@demo.wms");
      renderApp("/");
      expect(await screen.findByText("AER-SPL15-240917")).toBeInTheDocument();
    },
    WORKFLOW_TIMEOUT,
  );
});

describe("W1: dealer bulk registration", () => {
  const csv = [
    "Serial number,Model code,Customer name,Customer phone,City,Install date",
    `AER-SPL15-260991,AER-SPL15,R. Kulkarni,+91 90000 00101,Pune,${todayIso()}`,
    `AER-SPL18-260992,AER-SPL18,B. Chavan,+91 90000 00992,Pune,${todayIso()}`,
    `AER-SPL15-260993,AER-SPL20,C. Deshmukh,+91 90000 00993,Pune,${todayIso()}`,
    `AER-SPL15-250301,AER-SPL15,D. Gaikwad,+91 90000 00994,Pune,${todayIso()}`,
    "AER-SPL15-260995,AER-SPL15,G. Jadhav,+91 90000 00995,Pune,",
  ].join("\n");

  it(
    "registers clean rows, flags the rest, fixes inline, and sends only the duplicate to the admin",
    async () => {
      await signInAs("dealer.coolair@demo.wms");
      const batch = await bulkImportsApi.upload(
        new File([csv], "coolair_week.csv", { type: "text/csv" }),
        undefined,
      );
      expect(batch.counts).toEqual({ total: 5, registered: 2, errors: 2, review: 1 });
      expect(batch.rows.find((r) => r.values.serial === "AER-SPL15-260993")?.errors).toEqual({
        modelCode: "unknown_model",
      });
      expect(batch.rows.find((r) => r.values.serial === "AER-SPL15-260995")?.errors).toEqual({
        installDate: "required",
      });

      // DL02 shows the rows; fix the model code and the date inline, then resubmit.
      const dl02 = renderApp(`/registrations/bulk?batch=${batch.id}`);
      expect(
        await screen.findByText(/5 rows checked: 2 registered, 2 need fixing, 1 sent to admin review/),
      ).toBeInTheDocument();
      await dl02.user.selectOptions(screen.getAllByLabelText("Model code, row 4")[0]!, "AER-SPL15");
      await dl02.user.type(screen.getAllByLabelText("Install date, row 6")[0]!, todayIso());
      await dl02.user.click(screen.getByRole("button", { name: "Resubmit 2 fixed rows" }));
      expect(
        await screen.findByText(/5 rows checked: 4 registered, 0 need fixing, 1 sent to admin review/),
      ).toBeInTheDocument();
      dl02.unmount();

      // DL04: the new units are Active with the model's parts attached.
      const dl04 = renderApp("/units?q=26099");
      const table = await screen.findByRole("table");
      expect(await within(table).findAllByText("Active")).toHaveLength(4);
      dl04.unmount();

      // A02: only the duplicate needs a human.
      await signInAs("admin@demo.wms");
      const exceptions = await registrationsApi.list({ flag: "EXCEPTION" });
      expect(exceptions.items.map((r) => r.serial)).toEqual(["AER-SPL15-250301"]);
      expect(exceptions.items[0]?.duplicateOf?.customerName).toBe("S. Deshpande");

      // Customer R. Kulkarni sees the new unit without filling anything in.
      await signInAs("customer.rk@demo.wms");
      renderApp("/");
      expect(await screen.findByText("AER-SPL15-260991")).toBeInTheDocument();
    },
    WORKFLOW_TIMEOUT,
  );
});
