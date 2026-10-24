import { AbandonedCheckoutRecoveryEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function AbandonedCheckoutRecoveryPreview() {
  return (
    <AbandonedCheckoutRecoveryEmail
      customerName="Cameron"
      businessName="River City Mobile Detailing"
      appointmentDate="October 30, 2026"
      appointmentTime="10:00 AM"
      services={["Maintenance Refresh - 2022 Toyota Highlander"]}
      resumeUrl="https://www.rivercitymd.com/booking/resume?token=preview&recovery=email1"
      membershipOffer={{
        planName: "River City Maintenance Club",
        includedServiceName: "Maintenance Refresh",
        oneTimePrice: 175,
        monthlyPrice: 145,
        savingsPerVisit: 30,
        annualSavings: 360,
        kind: "replacement",
      }}
    />
  );
}
