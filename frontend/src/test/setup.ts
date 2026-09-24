import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import "@/lib/i18n";
import { i18n } from "@/lib/i18n";
import { resetMockDb } from "@/mocks/db";
import { server } from "@/mocks/server";

beforeAll(async () => {
  await i18n.changeLanguage("en");
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDb();
  sessionStorage.clear();
});
afterAll(() => server.close());

// jsdom gaps used by Radix and Recharts
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
