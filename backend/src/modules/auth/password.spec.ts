import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("Correct horse 1");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    await expect(verifyPassword("Correct horse 1", hash)).resolves.toBe(true);
    await expect(verifyPassword("correct horse 1", hash)).resolves.toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toEqual(await hashPassword("same"));
  });

  it("rejects malformed hashes instead of throwing", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$abc")).resolves.toBe(false);
  });

  it("has a dummy hash that matches nothing", async () => {
    await expect(verifyPassword("", await dummyPasswordHash())).resolves.toBe(false);
  });
});
