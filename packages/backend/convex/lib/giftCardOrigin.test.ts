import { afterEach, expect, test, vi } from "vitest";
import { validateGiftCardOrigin } from "./giftCardOrigin";
afterEach(() => vi.unstubAllEnvs());
test("checkout returns only to exact trusted origins", () => {
  expect(validateGiftCardOrigin("https://www.rivercitymd.com/")).toBe(
    "https://www.rivercitymd.com",
  );
  for (const value of [
    "https://www.rivercitymd.com.evil.example",
    "https://rivercitymd.com@evil.example",
    "https://evil.example",
    "javascript:alert(1)",
  ])
    expect(() => validateGiftCardOrigin(value)).toThrow();
  vi.stubEnv(
    "GIFT_CARD_ALLOWED_ORIGINS",
    "http://localhost:3000,https://preview.example",
  );
  expect(validateGiftCardOrigin("http://localhost:3000")).toBe(
    "http://localhost:3000",
  );
  expect(validateGiftCardOrigin("https://preview.example")).toBe(
    "https://preview.example",
  );
  expect(() => validateGiftCardOrigin("http://localhost:3001")).toThrow();
});
