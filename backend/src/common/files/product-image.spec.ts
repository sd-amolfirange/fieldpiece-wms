import { isProductImageKey, productImageKey, productImageUrl, productImageVersion } from "./product-image";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const API = { API_PUBLIC_URL: "https://api.example.com/", API_PREFIX: "api/v1" };

describe("product image keys", () => {
  it("only accepts keys issued for the same SKU", () => {
    expect(isProductImageKey("SC680", productImageKey("SC680", ID))).toBe(true);
    expect(isProductImageKey("SC680", productImageKey("SC660", ID))).toBe(false);
    expect(isProductImageKey("SC680", `claims/2026/09/${ID}`)).toBe(false);
    expect(isProductImageKey("SC680", `products/SC680/${ID}/../../claims`)).toBe(false);
    expect(isProductImageKey("SC680", "products/SC680/not-a-uuid")).toBe(false);
  });

  it("builds a versioned, absolute URL and null without an image", () => {
    const key = productImageKey("SC680", ID);
    expect(productImageVersion(key)).toBe(ID);
    expect(productImageUrl(API, "SC680", key)).toBe(
      `https://api.example.com/api/v1/products/SC680/image?v=${ID}`,
    );
    expect(productImageUrl(API, "SC680", null)).toBeNull();
  });
});
