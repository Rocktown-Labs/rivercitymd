import { GiftCardReceiptEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function GiftCardReceiptPreview() {
  return (
    <GiftCardReceiptEmail
      purchaserName="Cameron"
      amount={100}
      deliveryMethod="email"
      recipientName="Sarah"
      recipientEmail="sarah@example.com"
      code="RC-RRHL-LMPL-LKGD-ERAH"
      cardUrl="https://www.rivercitymd.com/gift-cards/claim?token=preview"
      printUrl="https://www.rivercitymd.com/gift-cards/print/preview"
      businessName="River City Mobile Detailing"
    />
  );
}
