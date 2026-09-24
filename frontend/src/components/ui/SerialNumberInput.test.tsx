import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidSerial } from "@/lib/serial";
import { SerialNumberInput } from "./SerialNumberInput";

describe("SerialNumberInput", () => {
  it("uppercases while typing and trims on blur", async () => {
    render(<SerialNumberInput aria-label="Serial number" />);
    const input = screen.getByLabelText("Serial number");
    await userEvent.type(input, " aer spl15");
    expect(input).toHaveValue(" AER SPL15");
    await userEvent.tab();
    expect(input).toHaveValue("AERSPL15");
  });

  it("renders in the mono font", () => {
    render(<SerialNumberInput aria-label="Serial number" />);
    expect(screen.getByLabelText("Serial number").className).toContain("font-mono");
  });
});

describe("isValidSerial", () => {
  it("checks against the default pattern", () => {
    expect(isValidSerial("aer-spl15-240917")).toBe(true);
    expect(isValidSerial("abc")).toBe(false);
  });

  it("accepts a product-specific pattern", () => {
    expect(isValidSerial("VRF10123456", "^VRF10[0-9]{6}$")).toBe(true);
    expect(isValidSerial("VRF10-12", "^VRF10[0-9]{6}$")).toBe(false);
  });
});
