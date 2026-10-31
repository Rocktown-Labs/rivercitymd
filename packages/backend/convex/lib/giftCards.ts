/**
 * Gift card constants and pure helpers.
 *
 * The gift card code is a bearer secret. It is stored server-side and only
 * returned by internal/admin functions or the purchaser's access-token page.
 * Public list queries return `codeLast4` only.
 */

export const GIFT_CARD_PRESETS = [100, 200, 300, 400, 500] as const;
export const GIFT_CARD_MIN_AMOUNT = 100;
export const GIFT_CARD_MAX_AMOUNT = 1000;
export const GIFT_CARD_AMOUNT_STEP = 100;
export const GIFT_CARD_TAX_CODE = "txcd_10502000";
export const GIFT_CARD_PRODUCT_NAME = "River City Mobile Detailing Gift Card";
export const GIFT_CARD_CLAIM_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const GIFT_CARD_REDEMPTION_TTL_MS = 1000 * 60 * 30;
export const GIFT_CARD_DORMANCY_YEARS = 3;
export const GIFT_CARD_DORMANCY_MS =
  1000 * 60 * 60 * 24 * 365.25 * GIFT_CARD_DORMANCY_YEARS;
export const GIFT_CARD_CURRENCY = "usd" as const;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateGiftCardCode(): string {
  const hex = crypto.randomUUID().replaceAll("-", "").toUpperCase();
  const chars = Array.from(hex.slice(0, 16), (char) => {
    const value = Number.parseInt(char, 16);
    return CODE_ALPHABET[value % CODE_ALPHABET.length];
  });
  return `RC-${chars.slice(0, 4).join("")}-${chars
    .slice(4, 8)
    .join("")}-${chars.slice(8, 12).join("")}-${chars
    .slice(12, 16)
    .join("")}`;
}

export function normalizeGiftCardCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatGiftCardCodeForDisplay(code: string): string {
  const normalized = normalizeGiftCardCode(code);
  if (normalized.length !== 16) return code.trim().toUpperCase();
  return `RC-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}`;
}

export function generateGiftCardPin(): string {
  const value = Number.parseInt(
    crypto.randomUUID().replaceAll("-", "").slice(0, 8),
    16,
  );
  return String(value % 10000).padStart(4, "0");
}

export function isValidGiftCardPin(pin: string | undefined): boolean {
  return Boolean(pin && /^\d{4}$/.test(pin.trim()));
}

export function isValidGiftCardAmount(amount: number): boolean {
  return (
    Number.isFinite(amount) &&
    Number.isInteger(amount) &&
    amount >= GIFT_CARD_MIN_AMOUNT &&
    amount <= GIFT_CARD_MAX_AMOUNT &&
    amount % GIFT_CARD_AMOUNT_STEP === 0
  );
}

export function normalizeGiftCardEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function getGiftCardLastFinancialActivity(card: {
  lastFinancialActivityAt?: number;
  issuedAt?: number;
  createdAt: number;
}): number {
  return card.lastFinancialActivityAt ?? card.issuedAt ?? card.createdAt;
}

export function getAvailableGiftCardBalance(card: {
  balance: number;
  reservedBalance?: number;
}): number {
  return Math.max(
    0,
    Math.round((card.balance - (card.reservedBalance ?? 0)) * 100) / 100,
  );
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getGiftCardStatusLabel(status: string): string {
  switch (status) {
    case "pending_payment":
      return "Pending payment";
    case "active":
      return "Active";
    case "depleted":
      return "Used";
    case "voided":
      return "Voided";
    default:
      return status;
  }
}
