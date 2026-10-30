/**
 * Pure React Email template components — no Convex or "use node" dependencies.
 * Imported by convex/emails.tsx (server actions) and emails/ (react-email dev preview).
 */

import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Heading,
  Hr,
  Img,
  Font,
  Preview,
  Link,
} from "@react-email/components";

// --- Brand Colors (hex for email compatibility) ---
const brand = {
  charcoal: "#1a1714",
  charcoalLight: "#2a2520",
  cream: "#f7f5f2",
  white: "#ffffff",
  textPrimary: "#1a1714",
  textSecondary: "#6b6560",
  textMuted: "#9a9590",
  teal: "#2a8fa8",
  tealDark: "#237a90",
  border: "#e8e4df",
  detailBg: "#f7f5f2",
  successGreen: "#2d8f5e",
  warningAmber: "#c4850c",
} as const;

// --- Shared Styles ---
export const emailStyles = {
  body: {
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    backgroundColor: brand.cream,
    margin: "0",
    padding: "0",
  },
  outerContainer: {
    maxWidth: "600px",
    margin: "0 auto",
  },
  header: {
    backgroundColor: brand.charcoal,
    padding: "32px 40px",
    textAlign: "center" as const,
    borderRadius: "12px 12px 0 0",
  },
  logo: {
    width: "72px",
    height: "72px",
    borderRadius: "50%",
  },
  headerText: {
    color: brand.textMuted,
    fontSize: "11px",
    letterSpacing: "2.5px",
    textTransform: "uppercase" as const,
    marginTop: "16px",
    marginBottom: "0",
    fontWeight: "400" as const,
  },
  contentContainer: {
    backgroundColor: brand.white,
    padding: "40px",
    borderLeft: `1px solid ${brand.border}`,
    borderRight: `1px solid ${brand.border}`,
  },
  heading: {
    fontFamily: "Georgia, 'Times New Roman', serif",
    color: brand.textPrimary,
    fontSize: "26px",
    fontWeight: "400" as const,
    lineHeight: "1.3",
    marginTop: "0",
    marginBottom: "8px",
  },
  subheading: {
    fontFamily: "Georgia, 'Times New Roman', serif",
    color: brand.textPrimary,
    fontSize: "18px",
    fontWeight: "400" as const,
    lineHeight: "1.3",
    marginTop: "0",
    marginBottom: "16px",
  },
  text: {
    color: brand.textSecondary,
    fontSize: "15px",
    lineHeight: "1.6",
    marginTop: "0",
    marginBottom: "16px",
  },
  textBody: {
    color: brand.textPrimary,
    fontSize: "15px",
    lineHeight: "1.7",
    marginTop: "0",
    marginBottom: "24px",
  },
  detailBox: {
    backgroundColor: brand.detailBg,
    padding: "24px",
    borderRadius: "8px",
    borderLeft: `3px solid ${brand.teal}`,
    marginBottom: "28px",
  },
  detailRow: {
    color: brand.textPrimary,
    fontSize: "14px",
    lineHeight: "1.5",
    marginTop: "0",
    marginBottom: "6px",
  },
  detailLabel: {
    color: brand.textSecondary,
    fontSize: "11px",
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    fontWeight: "600" as const,
    marginTop: "0",
    marginBottom: "2px",
  },
  detailValue: {
    color: brand.textPrimary,
    fontSize: "15px",
    fontWeight: "500" as const,
    marginTop: "0",
    marginBottom: "14px",
  },
  primaryButton: {
    backgroundColor: brand.teal,
    color: brand.white,
    padding: "14px 32px",
    textDecoration: "none" as const,
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "600" as const,
    letterSpacing: "0.5px",
    display: "inline-block" as const,
  },
  successButton: {
    backgroundColor: brand.successGreen,
    color: brand.white,
    padding: "14px 32px",
    textDecoration: "none" as const,
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "600" as const,
    letterSpacing: "0.5px",
    display: "inline-block" as const,
  },
  hr: {
    borderColor: brand.border,
    borderWidth: "1px",
    borderStyle: "solid" as const,
    margin: "28px 0",
  },
  footerContainer: {
    backgroundColor: brand.charcoal,
    padding: "28px 40px",
    borderRadius: "0 0 12px 12px",
    textAlign: "center" as const,
  },
  footerText: {
    color: brand.textMuted,
    fontSize: "12px",
    lineHeight: "1.6",
    marginTop: "0",
    marginBottom: "4px",
  },
  serviceList: {
    color: brand.textPrimary,
    fontSize: "14px",
    lineHeight: "1.8",
    paddingLeft: "18px",
    marginTop: "4px",
    marginBottom: "0",
  },
} as const;

// --- Shared Layout ---

function EmailLayout({
  preview,
  logoUrl,
  businessName,
  footerNote,
  children,
}: {
  preview: string;
  logoUrl?: string;
  businessName: string;
  footerNote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const logoSrc = logoUrl || "https://rivercitymd.com/BoldRiverCityMobileDetailingLogo.png";

  return (
    <Html>
      <Head>
        <Font
          fontFamily="Georgia"
          fallbackFontFamily={["Times New Roman", "serif"]}
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.outerContainer}>
          {/* Branded Header */}
          <Section style={emailStyles.header}>
            <Img
              src={logoSrc}
              alt={businessName}
              style={emailStyles.logo}
            />
            <Text style={emailStyles.headerText}>
              {businessName}
            </Text>
          </Section>

          {/* Content */}
          <Section style={emailStyles.contentContainer}>
            {children}
          </Section>

          {/* Footer */}
          <Section style={emailStyles.footerContainer}>
            <Text style={emailStyles.footerText}>
              {businessName}
            </Text>
            <Text style={{ ...emailStyles.footerText, marginBottom: "8px" }}>
              Little Rock, AR &bull; (501) 454-7140
            </Text>
            <Text style={{ ...emailStyles.footerText, fontSize: "11px", color: "#6b6560" }}>
              &copy; {new Date().getFullYear()} {businessName}. All rights reserved.
            </Text>
            {footerNote ? (
              <Text
                style={{
                  ...emailStyles.footerText,
                  fontSize: "11px",
                  color: "#6b6560",
                  marginTop: "8px",
                }}
              >
                {footerNote}
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// --- Detail Field Helper ---
function DetailField({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <>
      <Text style={emailStyles.detailLabel}>{label}</Text>
      <Text style={emailStyles.detailValue}>{typeof value === "string" ? value : ""}</Text>
      {typeof value !== "string" && value}
    </>
  );
}

// --- Template Components ---

// Welcome Email
export interface WelcomeEmailProps {
  userName: string;
  businessName: string;
  dashboardUrl?: string;
  logoUrl?: string;
}

export function WelcomeEmail({ userName, businessName, dashboardUrl = "#", logoUrl }: WelcomeEmailProps) {
  return (
    <EmailLayout
      preview={`Welcome to ${businessName} — let's get your ride looking pristine.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Welcome, {userName}
      </Heading>
      <Text style={emailStyles.text}>
        Thank you for choosing {businessName} for your mobile detailing needs.
      </Text>

      <Hr style={emailStyles.hr} />

      <Text style={emailStyles.textBody}>
        We bring premium detailing services directly to your location —
        no drop-offs, no waiting. Our professional detailers handle everything
        on-site so you can get back to what matters.
      </Text>

      <Text style={{ ...emailStyles.text, fontWeight: "600", color: brand.textPrimary }}>
        Here&apos;s what you can do next:
      </Text>
      <ul style={emailStyles.serviceList}>
        <li>Add your vehicle information to your profile</li>
        <li>Book your first detailing appointment</li>
        <li>View your service history and invoices</li>
      </ul>

      <Section style={{ textAlign: "center", marginTop: "32px", marginBottom: "8px" }}>
        <Button href={dashboardUrl} style={emailStyles.primaryButton}>
          Book Your First Detail
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Appointment Confirmation Email
export interface AppointmentConfirmationProps {
  customerName: string;
  businessName: string;
  appointmentDate: string;
  appointmentTime: string;
  services: string[];
  location: string;
  totalPrice: number;
  appointmentId: string;
  dashboardUrl?: string;
  logoUrl?: string;
}

export function AppointmentConfirmationEmail(props: AppointmentConfirmationProps) {
  const {
    customerName,
    businessName,
    appointmentDate,
    appointmentTime,
    services,
    location,
    totalPrice,
    appointmentId,
    dashboardUrl = "#",
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`Your appointment on ${appointmentDate} at ${appointmentTime} is confirmed.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Appointment Confirmed
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, your detailing appointment has been confirmed.
        We&apos;ll see you soon.
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Date" value={appointmentDate} />
        <DetailField label="Time" value={appointmentTime} />
        <DetailField label="Location" value={location} />
        <DetailField label="Services" value="" />
        <ul style={{ ...emailStyles.serviceList, marginBottom: "14px" }}>
          {services.map((service, index) => (
            <li key={index}>{service}</li>
          ))}
        </ul>
        <Hr style={{ ...emailStyles.hr, margin: "16px 0" }} />
        <Text style={{ ...emailStyles.detailValue, fontSize: "18px", fontWeight: "600", marginBottom: "0" }}>
          Total: ${totalPrice.toFixed(2)}
        </Text>
      </Section>

      <Text style={emailStyles.text}>
        Our professional detailer will arrive at your location at the
        scheduled time. Please ensure your vehicle is accessible and ready.
      </Text>

      <Section style={{ textAlign: "center", marginTop: "28px", marginBottom: "8px" }}>
        <Button href={dashboardUrl} style={emailStyles.successButton}>
          View Appointment
        </Button>
      </Section>

      <Hr style={emailStyles.hr} />
      <Text style={{ ...emailStyles.footerText, textAlign: "center", color: brand.textMuted }}>
        Appointment ID: {appointmentId}
      </Text>
    </EmailLayout>
  );
}

// Appointment Reminder Email (24h before)
export interface AppointmentReminderProps {
  customerName: string;
  businessName: string;
  appointmentDate: string;
  appointmentTime: string;
  services: string[];
  location: string;
  dashboardUrl?: string;
  logoUrl?: string;
}

export function AppointmentReminderEmail(props: AppointmentReminderProps) {
  const {
    customerName,
    businessName,
    appointmentDate,
    appointmentTime,
    services,
    location,
    dashboardUrl = "#",
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`Reminder: Your detailing appointment is tomorrow at ${appointmentTime}.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Your Appointment is Tomorrow
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, this is a friendly reminder that your detailing
        appointment is coming up.
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Date" value={appointmentDate} />
        <DetailField label="Time" value={appointmentTime} />
        <DetailField label="Location" value={location} />
        <DetailField label="Services" value="" />
        <ul style={{ ...emailStyles.serviceList, marginBottom: "0" }}>
          {services.map((service, index) => (
            <li key={index}>{service}</li>
          ))}
        </ul>
      </Section>

      <Text style={emailStyles.text}>
        Please ensure your vehicle is accessible and ready for service.
        Our detailer will arrive at your location at the scheduled time.
      </Text>

      <Section style={{ textAlign: "center", marginTop: "28px", marginBottom: "8px" }}>
        <Button href={dashboardUrl} style={emailStyles.primaryButton}>
          View Appointment
        </Button>
      </Section>
    </EmailLayout>
  );
}

export interface BookingReceivedEmailProps {
  customerName: string;
  businessName: string;
  appointmentDate: string;
  appointmentTime: string;
  services: string[];
  location: string;
  totalPrice: number;
  dashboardUrl?: string;
  logoUrl?: string;
}

export function BookingReceivedEmail(props: BookingReceivedEmailProps) {
  const {
    customerName,
    businessName,
    appointmentDate,
    appointmentTime,
    services,
    location,
    totalPrice,
    dashboardUrl = "#",
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`We received your booking request for ${appointmentDate} at ${appointmentTime}.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Booking Received
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, we received your booking and payment details.
        Our team will review everything and send a confirmation once your
        appointment is approved.
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Requested Date" value={appointmentDate} />
        <DetailField label="Requested Time" value={appointmentTime} />
        <DetailField label="Location" value={location} />
        <DetailField label="Services" value="" />
        <ul style={{ ...emailStyles.serviceList, marginBottom: "14px" }}>
          {services.map((service, index) => (
            <li key={index}>{service}</li>
          ))}
        </ul>
        <Hr style={{ ...emailStyles.hr, margin: "16px 0" }} />
        <Text
          style={{
            ...emailStyles.detailValue,
            fontSize: "18px",
            fontWeight: "600",
            marginBottom: "0",
          }}
        >
          Estimated Total: ${totalPrice.toFixed(2)}
        </Text>
      </Section>

      <Text style={emailStyles.textBody}>
        You do not need to take any further action right now. We&apos;ll keep
        you posted if anything changes.
      </Text>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={dashboardUrl} style={emailStyles.primaryButton}>
          View Booking
        </Button>
      </Section>
    </EmailLayout>
  );
}

export interface AbandonedCheckoutRecoveryEmailProps {
  customerName: string;
  businessName: string;
  appointmentDate: string;
  appointmentTime: string;
  services: string[];
  resumeUrl: string;
  followUp?: boolean;
  membershipOffer?: {
    planName: string;
    includedServiceName: string;
    oneTimePrice?: number;
    monthlyPrice: number;
    savingsPerVisit?: number;
    annualSavings?: number;
    kind: "replacement" | "after_detail";
  };
  logoUrl?: string;
}

export function AbandonedCheckoutRecoveryEmail(
  props: AbandonedCheckoutRecoveryEmailProps,
) {
  const {
    customerName,
    businessName,
    appointmentDate,
    appointmentTime,
    services,
    resumeUrl,
    followUp = false,
    membershipOffer,
    logoUrl,
  } = props;

  const offerHeadline =
    membershipOffer?.kind === "replacement" &&
    membershipOffer.savingsPerVisit &&
    membershipOffer.savingsPerVisit > 0
      ? `Save $${membershipOffer.savingsPerVisit.toFixed(0)} every visit with ${membershipOffer.planName}`
      : membershipOffer
        ? `Keep it clean after your detail`
        : null;

  const offerBody =
    membershipOffer?.kind === "replacement" &&
    membershipOffer.oneTimePrice !== undefined &&
    membershipOffer.savingsPerVisit &&
    membershipOffer.savingsPerVisit > 0
      ? `Your ${membershipOffer.includedServiceName} is $${membershipOffer.oneTimePrice.toFixed(
          0,
        )} per visit. ${membershipOffer.planName} is $${membershipOffer.monthlyPrice.toFixed(
          0,
        )}/month — that's $${(membershipOffer.annualSavings ?? membershipOffer.savingsPerVisit * 12).toFixed(
          0,
        )} saved per year.`
      : membershipOffer
        ? `The ${membershipOffer.planName} includes one ${membershipOffer.includedServiceName} each month for $${membershipOffer.monthlyPrice.toFixed(
            0,
          )}/month. It's the easiest way to keep your vehicle on a recurring schedule.`
        : null;

  return (
    <EmailLayout
      preview={
        followUp
          ? `Your ${appointmentDate} booking is still saved.`
          : `Finish your booking for ${appointmentDate} at ${appointmentTime}.`
      }
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        {followUp ? "Your booking is still saved" : "Still thinking it over?"}
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, we saved your booking details, but checkout was not
        completed.{" "}
        {followUp
          ? "Your request is still available if you'd like to pick back up where you left off."
          : "Your original request is still available if you'd like to pick back up where you left off."}
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Requested Date" value={appointmentDate} />
        <DetailField label="Requested Time" value={appointmentTime} />
        <DetailField label="Services" value="" />
        <ul style={{ ...emailStyles.serviceList, marginBottom: "0" }}>
          {services.map((service, index) => (
            <li key={index}>{service}</li>
          ))}
        </ul>
      </Section>

      {membershipOffer ? (
        <Section
          style={{
            backgroundColor: "#f0f8fa",
            border: "1px solid #cfe8ee",
            borderRadius: "10px",
            padding: "20px",
            margin: "24px 0",
          }}
        >
          <Text
            style={{
              ...emailStyles.text,
              margin: "0 0 8px",
              fontWeight: "600",
              color: brand.textPrimary,
            }}
          >
            {offerHeadline}
          </Text>
          <Text style={{ ...emailStyles.textBody, margin: "0" }}>
            {offerBody}
          </Text>
          <Text
            style={{
              ...emailStyles.text,
              margin: "12px 0 0",
              fontSize: "12px",
              color: brand.textMuted,
            }}
          >
            Membership is optional. You can book your detail without it.
          </Text>
        </Section>
      ) : null}

      <Text style={emailStyles.textBody}>
        Use the link below to finish checkout. If that time is no longer open,
        we&apos;ll bring your details back and help you choose a new slot.
      </Text>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={resumeUrl} style={emailStyles.primaryButton}>
          {membershipOffer?.kind === "replacement"
            ? "Resume Booking & See Savings"
            : "Resume Booking"}
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Maintenance Club marketing campaign email
export interface MaintenanceClubCampaignEmailProps {
  customerName: string;
  businessName: string;
  planName: string;
  includedServiceName: string;
  vehicleLabel?: string;
  oneTimePrice?: number;
  monthlyPrice: number;
  savingsPerVisit?: number;
  annualSavings?: number;
  resumeUrl: string;
  unsubscribeUrl: string;
  logoUrl?: string;
}

export function MaintenanceClubCampaignEmail(
  props: MaintenanceClubCampaignEmailProps,
) {
  const {
    customerName,
    businessName,
    planName,
    includedServiceName,
    vehicleLabel,
    oneTimePrice,
    monthlyPrice,
    savingsPerVisit,
    annualSavings,
    resumeUrl,
    unsubscribeUrl,
    logoUrl,
  } = props;

  const hasComparison =
    oneTimePrice !== undefined &&
    savingsPerVisit !== undefined &&
    savingsPerVisit > 0;

  return (
    <EmailLayout
      preview={`Keep your vehicle clean for $${monthlyPrice.toFixed(0)}/month with ${planName}.`}
      logoUrl={logoUrl}
      businessName={businessName}
      footerNote={
        <>
          You&apos;re receiving this because you opted in to marketing emails.{" "}
          <Link href={unsubscribeUrl} style={{ color: brand.textMuted }}>
            Unsubscribe
          </Link>
          .
        </>
      }
    >
      <Heading style={emailStyles.heading}>
        Your vehicle stays clean. Your price stays lower.
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, you started a booking
        {vehicleLabel ? ` for your ${vehicleLabel}` : ""} but didn&apos;t finish.
        Before you rebook, here&apos;s a simpler way to keep it on a recurring
        schedule.
      </Text>

      <Section
        style={{
          backgroundColor: "#f0f8fa",
          border: "1px solid #cfe8ee",
          borderRadius: "12px",
          padding: "24px",
          margin: "24px 0",
          textAlign: "center",
        }}
      >
        <Text
          style={{
            ...emailStyles.text,
            margin: "0 0 4px",
            fontSize: "12px",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: brand.tealDark,
            fontWeight: "600",
          }}
        >
          {planName}
        </Text>
        <Text
          style={{
            ...emailStyles.heading,
            fontSize: "38px",
            margin: "0",
            lineHeight: "1.1",
          }}
        >
          ${monthlyPrice.toFixed(0)}
          <span style={{ fontSize: "16px", color: brand.textMuted }}>
            {" "}
            / month
          </span>
        </Text>
        <Text style={{ ...emailStyles.textBody, margin: "8px 0 0" }}>
          Includes one {includedServiceName} each month.
        </Text>
      </Section>

      {hasComparison ? (
        <Section style={emailStyles.detailBox}>
          <DetailField
            label="One-time price"
            value={`$${oneTimePrice.toFixed(0)} per visit`}
          />
          <DetailField
            label="Member price"
            value={`$${monthlyPrice.toFixed(0)} per month`}
          />
          <DetailField
            label="You save"
            value={`$${savingsPerVisit.toFixed(0)} per visit${
              annualSavings
                ? ` — $${annualSavings.toFixed(0)} per year`
                : ""
            }`}
          />
        </Section>
      ) : null}

      <Text style={emailStyles.textBody}>
        Member pricing, a recurring schedule you don&apos;t have to remember,
        and the same detail you already know. Cancel anytime.
      </Text>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={resumeUrl} style={emailStyles.primaryButton}>
          Resume Booking &amp; Join the Club
        </Button>
      </Section>

      <Text
        style={{
          ...emailStyles.text,
          textAlign: "center",
          fontSize: "12px",
          color: brand.textMuted,
        }}
      >
        Prefer to book one-time? You can still resume your original booking.
      </Text>
    </EmailLayout>
  );
}

// Win-back marketing email for older abandoned carts and lapsed customers
export interface WinBackEmailProps {
  customerName: string;
  businessName: string;
  planName: string;
  includedServiceName: string;
  monthlyPrice: number;
  vehicleLabel?: string;
  lastServiceName?: string;
  bookingUrl: string;
  unsubscribeUrl: string;
  logoUrl?: string;
}

export function WinBackEmail(props: WinBackEmailProps) {
  const {
    customerName,
    businessName,
    planName,
    includedServiceName,
    monthlyPrice,
    vehicleLabel,
    lastServiceName,
    bookingUrl,
    unsubscribeUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`It's been a while — your car deserves a reset.`}
      logoUrl={logoUrl}
      businessName={businessName}
      footerNote={
        <>
          You&apos;re receiving this because you opted in to marketing emails.{" "}
          <Link href={unsubscribeUrl} style={{ color: brand.textMuted }}>
            Unsubscribe
          </Link>
          .
        </>
      }
    >
      <Heading style={emailStyles.heading}>It&apos;s been a while.</Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, it&apos;s been a few months since{" "}
        {lastServiceName
          ? `your ${lastServiceName}`
          : "your last visit"}
        {vehicleLabel ? ` on your ${vehicleLabel}` : ""}. If your car is due
        for a reset, we&apos;d love to get you back on the schedule.
      </Text>

      <Section
        style={{
          backgroundColor: "#f0f8fa",
          border: "1px solid #cfe8ee",
          borderRadius: "12px",
          padding: "24px",
          margin: "24px 0",
          textAlign: "center",
        }}
      >
        <Text
          style={{
            ...emailStyles.text,
            margin: "0 0 4px",
            fontSize: "12px",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: brand.tealDark,
            fontWeight: "600",
          }}
        >
          {planName}
        </Text>
        <Text
          style={{
            ...emailStyles.heading,
            fontSize: "38px",
            margin: "0",
            lineHeight: "1.1",
          }}
        >
          ${monthlyPrice.toFixed(0)}
          <span style={{ fontSize: "16px", color: brand.textMuted }}>
            {" "}
            / month
          </span>
        </Text>
        <Text style={{ ...emailStyles.textBody, margin: "8px 0 0" }}>
          Includes one {includedServiceName} each month.
        </Text>
      </Section>

      <Text style={emailStyles.textBody}>
        Member pricing, a recurring schedule you don&apos;t have to remember,
        and the same detail you already know. Cancel anytime.
      </Text>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={bookingUrl} style={emailStyles.primaryButton}>
          See Available Times
        </Button>
      </Section>

      <Text
        style={{
          ...emailStyles.text,
          textAlign: "center",
          fontSize: "12px",
          color: brand.textMuted,
        }}
      >
        Prefer a one-time detail? You can book any service at the regular
        price.
      </Text>
    </EmailLayout>
  );
}

// Admin New Customer Notification Email
export interface AdminNewCustomerNotificationEmailProps {
  userName: string;
  userEmail: string;
  userPhone: string;
  userAddress?: string;
  vehicleCount: number;
  signupDate: string;
  businessName: string;
  adminUrl: string;
  logoUrl?: string;
}

export function AdminNewCustomerNotificationEmail(
  props: AdminNewCustomerNotificationEmailProps,
) {
  const {
    userName,
    userEmail,
    userPhone,
    userAddress,
    vehicleCount,
    signupDate,
    businessName,
    adminUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`New customer signed up: ${userName}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        New Customer Signed Up
      </Heading>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Name" value={userName} />
        <DetailField label="Email" value={userEmail} />
        <DetailField label="Phone" value={userPhone} />
        {userAddress ? <DetailField label="Address" value={userAddress} /> : null}
        <DetailField
          label="Vehicles"
          value={`${vehicleCount} vehicle${vehicleCount !== 1 ? "s" : ""}`}
        />
        <DetailField label="Signup Date" value={signupDate} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          View Customer
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Admin Review Submitted Notification Email
export interface AdminReviewSubmittedNotificationEmailProps {
  customerName: string;
  customerEmail: string;
  rating: number;
  stars: string;
  comment?: string;
  isPublic: boolean;
  appointmentDate: string;
  serviceNames: string[];
  businessName: string;
  adminUrl: string;
  logoUrl?: string;
}

export function AdminReviewSubmittedNotificationEmail(
  props: AdminReviewSubmittedNotificationEmailProps,
) {
  const {
    customerName,
    customerEmail,
    rating,
    stars,
    comment,
    isPublic,
    appointmentDate,
    serviceNames,
    businessName,
    adminUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`New ${rating}-star review from ${customerName}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        New Review Submitted
      </Heading>

      <Section style={{ textAlign: "center", marginBottom: "24px" }}>
        <Text style={{ fontSize: "32px", marginTop: "0", marginBottom: "4px" }}>{stars}</Text>
        <Text style={{ ...emailStyles.text, marginBottom: "0" }}>{rating} out of 5</Text>
      </Section>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Customer" value={`${customerName} (${customerEmail})`} />
        <DetailField label="Comment" value={comment || "No comment provided"} />
        <DetailField label="Visibility" value={isPublic ? "Public" : "Private"} />
        <DetailField label="Appointment Date" value={appointmentDate} />
        <DetailField label="Services" value={serviceNames.join(", ")} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          View Review
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Customer Review Request Email
export interface CustomerReviewRequestEmailProps {
  customerName: string;
  appointmentDate: string;
  serviceNames: string[];
  businessName: string;
  reviewUrl: string;
  logoUrl?: string;
}

export function CustomerReviewRequestEmailTemplate(
  props: CustomerReviewRequestEmailProps,
) {
  const { customerName, appointmentDate, serviceNames, businessName, reviewUrl, logoUrl } =
    props;

  return (
    <EmailLayout
      preview={`How was your recent detail? We'd love your feedback.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        How Was Your Detail?
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, we hope you loved your service on{" "}
        <strong>{appointmentDate}</strong>.
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Services" value={serviceNames.join(", ")} />
        <DetailField label="Date" value={appointmentDate} />
      </Section>

      <Text style={emailStyles.textBody}>
        Your feedback helps us keep our standards high and lets other
        customers know what to expect. It only takes a minute.
      </Text>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={reviewUrl} style={emailStyles.primaryButton}>
          Leave a Review
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Customer Appointment Status Email
export interface CustomerAppointmentStatusEmailProps {
  customerName: string;
  statusLabel: string;
  summaryLine: string;
  appointmentDate: string;
  appointmentTime: string;
  serviceNames: string[];
  location: string;
  businessName: string;
  dashboardUrl: string;
  logoUrl?: string;
}

export function CustomerAppointmentStatusEmailTemplate(
  props: CustomerAppointmentStatusEmailProps,
) {
  const {
    customerName,
    statusLabel,
    summaryLine,
    appointmentDate,
    appointmentTime,
    serviceNames,
    location,
    businessName,
    dashboardUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`Appointment ${statusLabel} — ${appointmentDate} at ${appointmentTime}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Appointment {statusLabel}
      </Heading>
      <Text style={emailStyles.text}>
        Hi {customerName}, {summaryLine}
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Date" value={appointmentDate} />
        <DetailField label="Time" value={appointmentTime} />
        <DetailField label="Services" value={serviceNames.join(", ")} />
        <DetailField label="Location" value={location} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={dashboardUrl} style={emailStyles.primaryButton}>
          View Appointments
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Admin Appointment Notification Email
export interface AdminAppointmentNotificationEmailProps {
  actionText: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  totalPrice: number;
  serviceNames: string[];
  location: string;
  status: string;
  notes?: string;
  beforePhotoCount?: number;
  businessName: string;
  adminUrl: string;
  logoUrl?: string;
}

export function AdminAppointmentNotificationEmailTemplate(
  props: AdminAppointmentNotificationEmailProps,
) {
  const {
    actionText,
    customerName,
    customerEmail,
    customerPhone,
    appointmentDate,
    appointmentTime,
    duration,
    totalPrice,
    serviceNames,
    location,
    status,
    notes,
    beforePhotoCount = 0,
    businessName,
    adminUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`${actionText}: ${customerName} — ${appointmentDate} ${appointmentTime}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        {actionText}
      </Heading>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Customer" value={`${customerName} (${customerEmail})`} />
        <DetailField label="Phone" value={customerPhone} />
        <DetailField label="Date" value={appointmentDate} />
        <DetailField label="Time" value={appointmentTime} />
        <DetailField label="Duration" value={`${duration} minutes`} />
        <DetailField label="Services" value={serviceNames.join(", ")} />
        <DetailField label="Location" value={location} />
        <DetailField label="Status" value={status.replace("_", " ").toUpperCase()} />
        {beforePhotoCount > 0 ? (
          <DetailField
            label="Before Photos"
            value={`${beforePhotoCount} uploaded - open the appointment to review`}
          />
        ) : null}
        {notes ? <DetailField label="Notes" value={notes} /> : null}
        <Hr style={{ ...emailStyles.hr, margin: "16px 0" }} />
        <Text style={{ ...emailStyles.detailValue, fontSize: "18px", fontWeight: "600", marginBottom: "0" }}>
          Total: ${totalPrice.toFixed(2)}
        </Text>
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          View in Dashboard
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Admin Mileage Log Required Notification Email
export interface AdminMileageLogRequiredNotificationEmailProps {
  logId: string;
  logDate: string;
  businessPurpose: string;
  destinationLabel: string;
  appointmentInfo?: string;
  customerInfo?: string;
  businessName: string;
  adminUrl: string;
  logoUrl?: string;
}

export function AdminMileageLogRequiredNotificationEmailTemplate(
  props: AdminMileageLogRequiredNotificationEmailProps,
) {
  const {
    logId,
    logDate,
    businessPurpose,
    destinationLabel,
    appointmentInfo,
    customerInfo,
    businessName,
    adminUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`Mileage log needed for ${logDate} — complete your trip record.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Mileage Log Required
      </Heading>
      <Text style={emailStyles.text}>
        A completed appointment needs a trip and expense log for tax records.
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Log ID" value={logId} />
        <DetailField label="Date" value={logDate} />
        <DetailField label="Business Purpose" value={businessPurpose} />
        <DetailField label="Destination" value={destinationLabel} />
        {appointmentInfo ? <DetailField label="Appointment" value={appointmentInfo} /> : null}
        {customerInfo ? <DetailField label="Customer" value={customerInfo} /> : null}
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          Complete Trip Log
        </Button>
      </Section>
    </EmailLayout>
  );
}

// Admin Deposit Paid Notification Email
export interface AdminDepositPaidNotificationEmailProps {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  appointmentDate: string;
  appointmentTime: string;
  serviceNames: string[];
  location: string;
  depositAmount: number;
  totalPrice: number;
  businessName: string;
  appointmentUrl: string;
  logoUrl?: string;
}

export function AdminDepositPaidNotificationEmail(
  props: AdminDepositPaidNotificationEmailProps,
) {
  const {
    customerName,
    customerEmail,
    customerPhone,
    appointmentDate,
    appointmentTime,
    serviceNames,
    location,
    depositAmount,
    totalPrice,
    businessName,
    appointmentUrl,
    logoUrl,
  } = props;

  return (
    <EmailLayout
      preview={`Deposit paid by ${customerName} — ready to confirm appointment.`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Deposit Paid &mdash; Ready to Confirm
      </Heading>
      <Text style={emailStyles.text}>
        A customer has paid their deposit. Review the appointment details
        below and confirm when ready.
      </Text>

      {/* Payment Summary */}
      <Section style={{
        ...emailStyles.detailBox,
        borderLeftColor: brand.successGreen,
      }}>
        <DetailField label="Deposit Paid" value={`$${depositAmount.toFixed(2)}`} />
        <DetailField label="Total Price" value={`$${totalPrice.toFixed(2)}`} />
        <DetailField label="Remaining Balance" value={`$${(totalPrice - depositAmount).toFixed(2)}`} />
      </Section>

      {/* Appointment Details */}
      <Section style={emailStyles.detailBox}>
        <DetailField label="Customer" value={customerName} />
        <DetailField label="Email" value={customerEmail} />
        <DetailField label="Phone" value={customerPhone} />
        <DetailField label="Date" value={appointmentDate} />
        <DetailField label="Time" value={appointmentTime} />
        <DetailField label="Services" value={serviceNames.join(", ")} />
        <DetailField label="Location" value={location} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={appointmentUrl} style={emailStyles.successButton}>
          Review &amp; Confirm Appointment
        </Button>
      </Section>
    </EmailLayout>
  );
}

// --- Subscription Checkout Link Email ---
export function SubscriptionCheckoutLinkEmail({
  customerName,
  businessName,
  serviceName,
  frequency,
  price,
  startDate,
  checkoutUrl,
  dateSelectionRequired,
  logoUrl,
}: {
  customerName: string;
  businessName: string;
  serviceName: string;
  frequency: string;
  price: number;
  startDate?: string;
  checkoutUrl: string;
  dateSelectionRequired?: boolean;
  logoUrl?: string;
}) {
  const frequencyLabel =
    frequency === "monthly" ? "Monthly" : "Every 2 Weeks";
  const cadence = frequency === "monthly" ? "month" : "2 weeks";
  return (
    <EmailLayout
      preview={`Complete your recurring ${frequency} service with ${businessName}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Set Up Your Recurring Service
      </Heading>
      <Text style={emailStyles.textBody}>
        Hi {customerName}, {businessName} has set up a recurring detailing
        subscription for you.{" "}
        {dateSelectionRequired
          ? "Choose the service day and time that work best for you, then complete your first payment to activate it."
          : `Complete the secure checkout below to activate your ${frequencyLabel} service.`}
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Service" value={serviceName} />
        <DetailField label="Frequency" value={frequencyLabel} />
        <DetailField label="Price" value={`$${price.toFixed(2)} / ${cadence}`} />
        {startDate && !dateSelectionRequired ? (
          <DetailField label="First service" value={startDate} />
        ) : null}
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "24px" }}>
        <Button href={checkoutUrl} style={emailStyles.primaryButton}>
          {dateSelectionRequired
            ? "Choose Date & Pay"
            : "Pay & Start Subscription"}
        </Button>
      </Section>

      <Hr style={emailStyles.hr} />
      <Text style={{ ...emailStyles.text, fontSize: "13px" }}>
        {dateSelectionRequired
          ? `The button takes you to your dashboard, where you pick from available time slots. Your card is charged $${price.toFixed(2)} the day you complete checkout and every ${cadence} after that.`
          : `This link will take you to a secure Stripe checkout page. Your card will be charged $${price.toFixed(2)} today when you complete checkout and every ${cadence} after that.${startDate ? ` Your first service is scheduled for ${startDate}.` : ""}`}
      </Text>
    </EmailLayout>
  );
}

export function AdminSubscriptionCheckoutLinkNotificationEmail({
  customerName,
  customerEmail,
  businessName,
  serviceNames,
  frequency,
  price,
  checkoutUrl,
  adminUrl,
  logoUrl,
}: {
  customerName: string;
  customerEmail: string;
  businessName: string;
  serviceNames: string[];
  frequency: string;
  price: number;
  checkoutUrl: string;
  adminUrl: string;
  logoUrl?: string;
}) {
  return (
    <EmailLayout
      preview={`Subscription checkout link sent to ${customerName}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Subscription Checkout Link Sent
      </Heading>
      <Text style={emailStyles.textBody}>
        A recurring service checkout link was sent to the customer below.
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Customer" value={`${customerName} (${customerEmail})`} />
        <DetailField label="Services" value={serviceNames.join(", ")} />
        <DetailField
          label="Frequency"
          value={frequency === "monthly" ? "Monthly" : "Every 2 Weeks"}
        />
        <DetailField
          label="Recurring Total"
          value={`$${price.toFixed(2)} / ${frequency === "monthly" ? "month" : "2 weeks"}`}
        />
        <DetailField label="Checkout Link" value={checkoutUrl} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          View Subscription
        </Button>
      </Section>
    </EmailLayout>
  );
}

// --- Subscription Appointment Created Email ---
export function SubscriptionAppointmentCreatedEmail({
  customerName,
  businessName,
  appointmentDate,
  appointmentTime,
  serviceNames,
  location,
  dashboardUrl,
  logoUrl,
}: {
  customerName: string;
  businessName: string;
  appointmentDate: string;
  appointmentTime: string;
  serviceNames: string[];
  location: string;
  dashboardUrl: string;
  logoUrl?: string;
}) {
  return (
    <EmailLayout
      preview={`Your upcoming service is scheduled for ${appointmentDate}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Your Upcoming Service is Scheduled
      </Heading>
      <Text style={emailStyles.textBody}>
        Hi {customerName}, your next recurring detail appointment has been
        automatically scheduled. Here are the details:
      </Text>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Date" value={appointmentDate} />
        <DetailField label="Time" value={appointmentTime} />
        <DetailField label="Services" value={serviceNames.join(", ")} />
        <DetailField label="Location" value={location} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={dashboardUrl} style={emailStyles.primaryButton}>
          View Appointment
        </Button>
      </Section>
    </EmailLayout>
  );
}

export function AdminPaymentFailedNotificationEmail({
  businessName,
  customerName,
  customerEmail,
  appointmentSummary,
  failureReason,
  paymentContext,
  adminUrl,
  logoUrl,
}: {
  businessName: string;
  customerName?: string;
  customerEmail?: string;
  appointmentSummary?: string;
  failureReason?: string;
  paymentContext: string;
  adminUrl: string;
  logoUrl?: string;
}) {
  return (
    <EmailLayout
      preview={`Payment failed for ${customerName || "a customer"}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        Payment Failed
      </Heading>
      <Text style={emailStyles.textBody}>
        A payment failed and may need manual follow-up from the admin team.
      </Text>

      <Section
        style={{
          ...emailStyles.detailBox,
          borderLeftColor: brand.warningAmber,
        }}
      >
        <DetailField label="Payment Context" value={paymentContext} />
        <DetailField
          label="Customer"
          value={
            customerName || customerEmail
              ? `${customerName || "Unknown"}${customerEmail ? ` (${customerEmail})` : ""}`
              : "Unknown"
          }
        />
        {appointmentSummary ? (
          <DetailField label="Appointment" value={appointmentSummary} />
        ) : null}
        <DetailField
          label="Failure Reason"
          value={failureReason || "Stripe reported a payment failure."}
        />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          Review in Admin
        </Button>
      </Section>
    </EmailLayout>
  );
}

// --- Gift Card Emails ---

const giftCardGold = "#c9a227";

function GiftCardFront({
  amount,
  logoUrl,
}: {
  amount: number;
  logoUrl?: string;
}) {
  return (
    <Section
      style={{
        backgroundColor: brand.charcoal,
        borderRadius: "16px",
        padding: "28px 24px",
        textAlign: "center",
        marginBottom: "24px",
        border: `1px solid ${giftCardGold}55`,
      }}
    >
      <Img
        src={logoUrl || "https://rivercitymd.com/BoldRiverCityMobileDetailingLogo.png"}
        alt="River City Mobile Detailing"
        style={{
          width: "96px",
          height: "96px",
          borderRadius: "50%",
          margin: "0 auto 16px",
          display: "block",
        }}
      />
      <Text
        style={{
          color: giftCardGold,
          fontSize: "13px",
          letterSpacing: "4px",
          fontWeight: 700,
          margin: "0 0 8px",
        }}
      >
        GIFT CARD
      </Text>
      <Text
        style={{
          color: brand.white,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: "42px",
          lineHeight: "1.1",
          margin: "0 0 6px",
        }}
      >
        ${amount.toFixed(0)}
      </Text>
      <Text
        style={{
          color: brand.textMuted,
          fontSize: "10px",
          letterSpacing: "2px",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        River City Mobile Detailing
      </Text>
    </Section>
  );
}

export function GiftCardRecipientEmail({
  purchaserName,
  recipientName,
  amount,
  code,
  message,
  claimUrl,
  printUrl,
  pinRequired,
  businessName,
  logoUrl,
}: {
  purchaserName: string;
  recipientName?: string;
  amount: number;
  code: string;
  message?: string;
  claimUrl: string;
  printUrl: string;
  pinRequired?: boolean;
  businessName: string;
  logoUrl?: string;
}) {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi there,";
  return (
    <EmailLayout
      preview={`${purchaserName} sent you a $${amount.toFixed(0)} gift card`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>
        {purchaserName} sent you a gift card
      </Heading>
      <Text style={emailStyles.textBody}>{greeting}</Text>
      <Text style={emailStyles.textBody}>
        {purchaserName} sent you a ${amount.toFixed(0)} gift card for{" "}
        {businessName}. Use it on any service or outstanding invoice.
      </Text>

      <GiftCardFront amount={amount} logoUrl={logoUrl} />

      {message ? (
        <Section
          style={{
            ...emailStyles.detailBox,
            borderLeftColor: giftCardGold,
          }}
        >
          <Text style={{ ...emailStyles.text, fontStyle: "italic", margin: 0 }}>
            &ldquo;{message}&rdquo;
          </Text>
        </Section>
      ) : null}

      <Section style={{ textAlign: "center", marginBottom: "16px" }}>
        <Button href={claimUrl} style={emailStyles.primaryButton}>
          Open Your Gift
        </Button>
      </Section>

      <Section style={emailStyles.detailBox}>
        <DetailField label="Gift card code" value={code} />
        <DetailField label="Balance" value={`$${amount.toFixed(2)}`} />
        <DetailField label="Expires" value="Never" />
      </Section>

      {pinRequired ? (
        <Text style={{ ...emailStyles.text, fontSize: "13px" }}>
          This card also has a 4-digit PIN. Ask {purchaserName} for it when you
          redeem the card.
        </Text>
      ) : null}

      <Text style={{ ...emailStyles.text, fontSize: "13px" }}>
        Prefer a printed card?{" "}
        <Link href={printUrl} style={{ color: brand.teal }}>
          Open the print-ready version
        </Link>
        .
      </Text>

      <Hr style={emailStyles.hr} />
      <Text style={{ ...emailStyles.text, fontSize: "12px" }}>
        Keep this email private. Anyone with the code can use the remaining
        balance. Gift cards never expire and have no cash value.
      </Text>
    </EmailLayout>
  );
}

export function GiftCardReceiptEmail({
  purchaserName,
  amount,
  deliveryMethod,
  recipientName,
  recipientEmail,
  code,
  cardUrl,
  printUrl,
  businessName,
  logoUrl,
}: {
  purchaserName: string;
  amount: number;
  deliveryMethod: "self" | "email" | "print";
  recipientName?: string;
  recipientEmail?: string;
  code: string;
  cardUrl: string;
  printUrl: string;
  businessName: string;
  logoUrl?: string;
}) {
  const deliveryCopy =
    deliveryMethod === "email"
      ? `We emailed the gift card to ${recipientEmail || recipientName || "the recipient"}.`
      : deliveryMethod === "print"
        ? `Print the card below and hand it to ${recipientName || "the recipient"}.`
        : "The gift card is stored in your account, ready to use or print.";

  return (
    <EmailLayout
      preview={`Your $${amount.toFixed(0)} ${businessName} gift card`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>Your gift card is ready</Heading>
      <Text style={emailStyles.textBody}>
        Thanks, {purchaserName}. {deliveryCopy}
      </Text>

      <GiftCardFront amount={amount} logoUrl={logoUrl} />

      <Section style={emailStyles.detailBox}>
        <DetailField label="Amount" value={`$${amount.toFixed(2)}`} />
        <DetailField
          label="Delivery"
          value={
            deliveryMethod === "email"
              ? "Email"
              : deliveryMethod === "print"
                ? "Print at home"
                : "My account"
          }
        />
        {recipientName ? (
          <DetailField label="Recipient" value={recipientName} />
        ) : null}
        <DetailField label="Code" value={code} />
        <DetailField label="Expires" value="Never" />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "16px" }}>
        <Button href={printUrl} style={emailStyles.primaryButton}>
          View &amp; Print Card
        </Button>
      </Section>

      <Text style={{ ...emailStyles.text, fontSize: "13px" }}>
        You can also view this card anytime at{" "}
        <Link href={cardUrl} style={{ color: brand.teal }}>
          your gift card page
        </Link>
        .
      </Text>
    </EmailLayout>
  );
}

export function AdminGiftCardNotificationEmail({
  purchaserName,
  purchaserEmail,
  recipientName,
  recipientEmail,
  amount,
  paymentMethod,
  deliveryMethod,
  adminUrl,
  businessName,
  logoUrl,
}: {
  purchaserName: string;
  purchaserEmail?: string;
  recipientName?: string;
  recipientEmail?: string;
  amount: number;
  paymentMethod: string;
  deliveryMethod: string;
  adminUrl: string;
  businessName: string;
  logoUrl?: string;
}) {
  return (
    <EmailLayout
      preview={`Gift card sold — $${amount.toFixed(0)}`}
      logoUrl={logoUrl}
      businessName={businessName}
    >
      <Heading style={emailStyles.heading}>Gift card sold</Heading>
      <Text style={emailStyles.textBody}>
        A new gift card has been issued. Review the details below.
      </Text>

      <Section style={{ ...emailStyles.detailBox, borderLeftColor: giftCardGold }}>
        <DetailField label="Amount" value={`$${amount.toFixed(2)}`} />
        <DetailField label="Purchaser" value={purchaserName} />
        {purchaserEmail ? <DetailField label="Purchaser email" value={purchaserEmail} /> : null}
        {recipientName ? <DetailField label="Recipient" value={recipientName} /> : null}
        {recipientEmail ? <DetailField label="Recipient email" value={recipientEmail} /> : null}
        <DetailField label="Payment" value={paymentMethod} />
        <DetailField label="Delivery" value={deliveryMethod} />
      </Section>

      <Section style={{ textAlign: "center", marginBottom: "8px" }}>
        <Button href={adminUrl} style={emailStyles.primaryButton}>
          Open Gift Cards
        </Button>
      </Section>
    </EmailLayout>
  );
}
