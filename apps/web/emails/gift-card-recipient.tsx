import { GiftCardRecipientEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function GiftCardRecipientPreview() {
  return (
    <GiftCardRecipientEmail
      purchaserName="Cameron"
      recipientName="Sarah"
      amount={100}
      code="RC-RRHL-LMPL-LKGD-ERAH"
      message="Enjoy that fresh-from-the-lot feeling."
      claimUrl="https://www.rivercitymd.com/gift-cards/claim?token=preview"
      printUrl="https://www.rivercitymd.com/gift-cards/print/preview"
      pinRequired
      businessName="River City Mobile Detailing"
    />
  );
}
