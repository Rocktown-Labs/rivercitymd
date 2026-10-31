import { AdminGiftCardNotificationEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function AdminGiftCardNotificationPreview() {
  return (
    <AdminGiftCardNotificationEmail
      purchaserName="Cameron"
      purchaserEmail="cameron@example.com"
      recipientName="Sarah"
      recipientEmail="sarah@example.com"
      amount={100}
      paymentMethod="stripe"
      deliveryMethod="email"
      adminUrl="https://www.rivercitymd.com/admin/gift-cards"
      businessName="River City Mobile Detailing"
    />
  );
}
