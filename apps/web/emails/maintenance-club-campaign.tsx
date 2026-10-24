import { MaintenanceClubCampaignEmail } from "@rivercitymd/backend/convex/emailTemplates";

export default function MaintenanceClubCampaignPreview() {
  return (
    <MaintenanceClubCampaignEmail
      customerName="Cameron"
      businessName="River City Mobile Detailing"
      planName="River City Maintenance Club"
      includedServiceName="Maintenance Refresh"
      vehicleLabel="2022 Toyota Highlander"
      oneTimePrice={175}
      monthlyPrice={145}
      savingsPerVisit={30}
      annualSavings={360}
      resumeUrl="https://www.rivercitymd.com/booking/resume?token=preview&recovery=campaign"
      unsubscribeUrl="https://www.rivercitymd.com/unsubscribe?token=preview"
    />
  );
}
