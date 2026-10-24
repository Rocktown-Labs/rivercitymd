import { WinBackEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function WinBackPreview() {
  return (
    <WinBackEmail
      customerName="Gerard"
      businessName="River City Mobile Detailing"
      planName="River City Maintenance Club"
      includedServiceName="Maintenance Refresh"
      monthlyPrice={145}
      vehicleLabel="2022 Toyota Highlander"
      lastServiceName="Deep Reset Detail"
      bookingUrl="https://www.rivercitymd.com/book"
      unsubscribeUrl="https://www.rivercitymd.com/unsubscribe?token=preview"
    />
  );
}
