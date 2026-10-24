import { AbandonedCheckoutRecoveryEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function AbandonedCheckoutFollowUpPreview() {
  return (
    <AbandonedCheckoutRecoveryEmail
      customerName="Cameron"
      businessName="River City Mobile Detailing"
      appointmentDate="October 30, 2026"
      appointmentTime="10:00 AM"
      services={["Signature Detail - 2022 Toyota Highlander"]}
      resumeUrl="https://www.rivercitymd.com/booking/resume?token=preview&recovery=email2"
      followUp
      membershipOffer={{
        planName: "River City Maintenance Club",
        includedServiceName: "Maintenance Refresh",
        monthlyPrice: 145,
        kind: "after_detail",
      }}
    />
  );
}
