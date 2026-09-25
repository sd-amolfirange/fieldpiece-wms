import { ErrorCode } from "../../../common/errors/error-codes";
import { parseIsoDate } from "../../../common/time/utc-date";
import { checkRegistrationRules } from "../registration-rules";

const today = parseIsoDate("2026-09-23");
const product = { sku: "SC680", serialPattern: null, launchDate: parseIsoDate("2019-01-01") };
const check = (over: Partial<Parameters<typeof checkRegistrationRules>[0]>) =>
  checkRegistrationRules({
    serial: "SC680-100037",
    purchaseDate: parseIsoDate("2026-03-01"),
    today,
    product,
    ...over,
  });

describe("registration rules", () => {
  it("passes a valid registration", () => expect(check({})).toBeNull());

  it("requires a known product", () => {
    expect(check({ product: null })?.code).toBe(ErrorCode.PRODUCT_NOT_FOUND);
  });

  it("checks the serial against the product pattern when one is set", () => {
    const vp85 = { sku: "VP85", serialPattern: "^VP85[0-9]{6}$", launchDate: null };
    expect(check({ product: vp85, serial: "VP85-1" })?.code).toBe(ErrorCode.SERIAL_FORMAT_INVALID);
    expect(check({ product: vp85, serial: "VP85123456" })).toBeNull();
  });

  it("rejects purchase dates in the future, but allows today", () => {
    expect(check({ purchaseDate: parseIsoDate("2026-09-24") })?.code).toBe(ErrorCode.PURCHASE_IN_FUTURE);
    expect(check({ purchaseDate: today })).toBeNull();
  });

  it("rejects purchase dates before launch", () => {
    expect(check({ purchaseDate: parseIsoDate("2018-12-31") })?.code).toBe(ErrorCode.PURCHASE_BEFORE_LAUNCH);
    expect(check({ purchaseDate: parseIsoDate("2019-01-01") })).toBeNull();
  });
});
