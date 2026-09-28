import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidSerial } from "@/lib/serial";
import { SerialNumberInput } from "./SerialNumberInput";

describe("SerialNumberInput", () => {
  it("uppercases while typing and trims on blur", async () => {
    render(<SerialNumberInput aria-label="Serial number" />);
    const input = screen.getByLabelText("Serial number");
    await userEvent.type(input, " 2514 06233a");
    expect(input).toHaveValue(" 2514 06233A");
    await userEvent.tab();
    expect(input).toHaveValue("251406233A");
  });

  it("renders in the mono font", () => {
    render(<SerialNumberInput aria-label="Serial number" />);
    expect(screen.getByLabelText("Serial number").className).toContain("font-mono");
  });
});

describe("isValidSerial", () => {
  it("checks against the default pattern", () => {
    expect(isValidSerial("251406233")).toBe(true);
    expect(isValidSerial("abc")).toBe(false);
  });

  it("accepts a product-specific pattern", () => {
    expect(isValidSerial("251406233", "^[0-9]{9}$")).toBe(true);
    expect(isValidSerial("25140623", "^[0-9]{9}$")).toBe(false);
  });
});
