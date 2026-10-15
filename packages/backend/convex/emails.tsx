// IMPORTANT: this is a Convex Node Action
"use node";

/*
Email Setup Instructions:
1. Create a Resend account at https://resend.com
2. Add domain: rivercitymd.com
3. Verify DNS records (SPF, DKIM, DMARC) in your domain registrar
4. Configure webhook in Resend dashboard:
   - URL: https://your-convex-url.convex.site/resend-webhook
   - Events: email.sent, email.delivered, email.bounced, email.complained
5. Set environment variables in Vercel (Production):
   - RESEND_API_KEY=your_resend_api_key
   - RESEND_WEBHOOK_SECRET=your_webhook_secret
   - CONVEX_SITE_URL=https://your-app-url

 Email Functions:
 - sendWelcomeEmail: Sent when users complete onboarding
 - sendAppointmentConfirmationEmail: Sent when appointments are created
 - sendAppointmentReminderEmail: Sent 24h before appointment
 - sendAdminDepositPaidNotification: Sent when deposit is paid
 - sendAdminAppointmentNotification: Sent to admin for appointment changes

All emails are sent from: no-reply@notifications.rivercitymd.com
All emails use professional templates with business branding.
*/

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { render } from "@react-email/render";
import { components, api, internal } from "./_generated/api";
import { Resend } from "@convex-dev/resend";
import type { Id } from "./_generated/dataModel";
import { isArkansasState } from "./lib/address";
import { formatTime12h } from "./lib/time";
import {
  getDefaultAdminEmailRecipients,
  normalizeBusinessNotificationSettings,
} from "./lib/notificationSettings";

// Import all template components from the shared file
import {
  WelcomeEmail,
  AppointmentConfirmationEmail,
  AppointmentReminderEmail,
  BookingReceivedEmail,
  AbandonedCheckoutRecoveryEmail,
  AdminNewCustomerNotificationEmail,
  AdminReviewSubmittedNotificationEmail,
  CustomerReviewRequestEmailTemplate,
  CustomerAppointmentStatusEmailTemplate,
  AdminAppointmentNotificationEmailTemplate,
  AdminMileageLogRequiredNotificationEmailTemplate,
  AdminDepositPaidNotificationEmail,
  SubscriptionCheckoutLinkEmail,
  SubscriptionAppointmentCreatedEmail,
  AdminSubscriptionCheckoutLinkNotificationEmail,
  AdminPaymentFailedNotificationEmail,
} from "./emailTemplates";

// Initialize Resend component
// testMode defaults to true in the component, which silently drops emails
// to non-test addresses. Set to false so real emails deliver in production.
export const resend: Resend = new Resend(components.resend, {
  testMode: false,
});

function shouldSkipEmails(): boolean {
  return process.env.CONVEX_TEST === "true" || process.env.NODE_ENV === "test";
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://rivercitymd.vercel.app"
  ).replace(/\/$/, "");
}

function logoUrl(): string {
  return `${siteUrl()}/BoldRiverCityMobileDetailingLogo.png`;
}

type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
};

async function sendEmailMessage(
  ctx: any,
  args: {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
  },
): Promise<void> {
  if (!args.attachments?.length) {
    await resend.sendEmail(ctx, args);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to send emails with attachments");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
      html: args.html,
      attachments: args.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content, "utf8").toString("base64"),
        content_type: attachment.contentType || "text/calendar; charset=utf-8",
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend attachment send failed (${response.status}): ${body}`);
  }
}

function formatIcsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatFloatingIcsDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(/:/g, "")}00`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addMinutesToDate(date: string, time: string, minutes: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, mins] = time.split(":").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, hours, mins));
  dt.setUTCMinutes(dt.getUTCMinutes() + minutes);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const min = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}00`;
}

function buildAppointmentIcs(args: {
  appointmentId: Id<"appointments">;
  businessName: string;
  action: "created" | "confirmed" | "cancelled" | "rescheduled";
  customerName: string;
  appointmentDate: string;
  appointmentTime: string;
  location: string;
  serviceNames: string[];
  duration: number;
}): EmailAttachment {
  const uid = `${args.appointmentId}@rivercitymd.com`;
  const now = formatIcsTimestamp(new Date());
  const status = args.action === "cancelled" ? "CANCELLED" : "CONFIRMED";
  const method = args.action === "cancelled" ? "CANCEL" : "REQUEST";
  const summaryPrefix =
    args.action === "created"
      ? "New Booking"
      : args.action === "rescheduled"
        ? "Rescheduled Appointment"
        : args.action === "confirmed"
          ? "Confirmed Appointment"
          : "Cancelled Appointment";
  const description = escapeIcsText(
    [
      `${summaryPrefix} for ${args.customerName}`,
      `Services: ${args.serviceNames.join(", ")}`,
      `Location: ${args.location}`,
    ].join("\n"),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//River City Mobile Detailing//Notifications//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=America/Chicago:${formatFloatingIcsDateTime(args.appointmentDate, args.appointmentTime)}`,
    `DTEND;TZID=America/Chicago:${addMinutesToDate(args.appointmentDate, args.appointmentTime, args.duration || 120)}`,
    `SUMMARY:${escapeIcsText(`${summaryPrefix}: ${args.customerName}`)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeIcsText(args.location)}`,
    `STATUS:${status}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return {
    filename: `river-city-md-${args.action}-${args.appointmentDate}-${args.appointmentId}.ics`,
    content: `${lines.join("\r\n")}\r\n`,
    contentType: `text/calendar; method=${method}; charset=utf-8`,
  };
}

async function getBusinessAndFromName(ctx: any) {
  const business = await ctx.runQuery(api.business.get);
  if (!business) return null;

  return {
    business,
    from: `${business.name} <no-reply@notifications.rivercitymd.com>`,
  };
}

async function getPrimaryAdminRecipient(ctx: any): Promise<string> {
  const business = await ctx.runQuery(api.business.get);
  const settings = normalizeBusinessNotificationSettings(
    business?.notificationSettings,
  );
  return (
    settings?.adminEmailRecipients?.[0] ||
    getDefaultAdminEmailRecipients()[0] ||
    "dustin@rivercitymd.com"
  );
}

// --- Helper to get service names for an appointment ---
async function getServiceNames(ctx: any, serviceIds: any[]): Promise<string[]> {
  const services = await Promise.all(
    serviceIds.map((id: any) =>
      ctx.runQuery(internal.services.getServiceById, { serviceId: id }),
    ),
  );
  return services
    .filter((s: any) => s !== null)
    .map((s: any) => s.name);
}

function formatLocation(location: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): string {
  return `${location.street}, ${location.city}, ${location.state} ${location.zip}`;
}

// --- Action Handlers ---

// Send Welcome Email
export const sendWelcomeEmail = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: args.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const html = await render(
      WelcomeEmail({
        userName: user.name || "Valued Customer",
        businessName: businessInfo.business.name,
        dashboardUrl: `${siteUrl()}/dashboard`,
        logoUrl: businessInfo.business.logoUrl || logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Welcome to ${businessInfo.business.name}!`,
      html,
    });
  },
});

// Send Appointment Confirmation Email
export const sendAppointmentConfirmationEmail = internalAction({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    const html = await render(
      AppointmentConfirmationEmail({
        customerName: user.name || "Valued Customer",
        businessName: businessInfo.business.name,
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formatTime12h(appointment.scheduledTime),
        services: serviceNames,
        location: formatLocation(appointment.location),
        totalPrice: appointment.totalPrice,
        appointmentId: args.appointmentId,
        dashboardUrl: `${siteUrl()}/dashboard/appointments`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Appointment Confirmed - ${appointment.scheduledDate}`,
      html,
    });
  },
});

// Send Invoice Email

// Send Appointment Reminder Email (24h before)
export const sendAppointmentReminderEmail = internalAction({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    // Defensive: skip if appointment is no longer active
    if (
      appointment.status === "cancelled" ||
      appointment.status === "rescheduled"
    ) {
      return;
    }

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    const html = await render(
      AppointmentReminderEmail({
        customerName: user.name || "Valued Customer",
        businessName: businessInfo.business.name,
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formatTime12h(appointment.scheduledTime),
        services: serviceNames,
        location: formatLocation(appointment.location),
        dashboardUrl: `${siteUrl()}/dashboard/appointments`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Reminder: Your appointment is tomorrow - ${appointment.scheduledDate}`,
      html,
    });
  },
});

export const sendCustomerBookingReceivedEmail = internalAction({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);
    const html = await render(
      BookingReceivedEmail({
        customerName: user.name || "Valued Customer",
        businessName: businessInfo.business.name,
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formatTime12h(appointment.scheduledTime),
        services: serviceNames,
        location: formatLocation(appointment.location),
        totalPrice: appointment.totalPrice,
        dashboardUrl: `${siteUrl()}/dashboard/appointments`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Booking Received - ${appointment.scheduledDate}`,
      html,
    });
  },
});

export const sendAbandonedCheckoutRecoveryEmail = internalAction({
  args: {
    customerName: v.string(),
    to: v.string(),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    serviceNames: v.array(v.string()),
    resumeUrl: v.string(),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const html = await render(
      AbandonedCheckoutRecoveryEmail({
        customerName: args.customerName || "there",
        businessName: businessInfo.business.name,
        appointmentDate: args.scheduledDate,
        appointmentTime: formatTime12h(args.scheduledTime),
        services: args.serviceNames,
        resumeUrl: args.resumeUrl,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.to,
      subject: `Finish your booking for ${args.scheduledDate}`,
      html,
    });
  },
});

// Send Admin Notification for Deposit Paid
export const sendAdminDepositPaidNotification = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    invoiceId: v.id("invoices"),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const invoice = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });
    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    const html = await render(
      AdminDepositPaidNotificationEmail({
        customerName: user?.name || "N/A",
        customerEmail: user?.email || "N/A",
        customerPhone: user?.phone || "N/A",
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formatTime12h(appointment.scheduledTime),
        serviceNames,
        location: formatLocation(appointment.location),
        depositAmount: invoice?.depositAmount || 0,
        totalPrice: appointment.totalPrice,
        businessName: businessInfo.business.name,
        appointmentUrl: `${siteUrl()}/admin/appointments/${args.appointmentId}`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `Deposit Paid - ${user?.name || user?.email || "Customer"} - ${appointment.scheduledDate}`,
      html,
    });
  },
});

// Send Admin Notification for New Customer (after onboarding complete)
export const sendAdminNewCustomerNotification = internalAction({
  args: {
    userId: v.id("users"),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: args.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const vehicles = await ctx.runQuery(internal.vehicles.listByUserInternal, {
      userId: args.userId,
    });

    const html = await render(
      AdminNewCustomerNotificationEmail({
        userName: user.name || "N/A",
        userEmail: user.email || "N/A",
        userPhone: user.phone || "N/A",
        userAddress: user.address
          ? `${user.address.street}, ${user.address.city}, ${user.address.state} ${user.address.zip}`
          : undefined,
        vehicleCount: vehicles.length,
        signupDate: new Date().toLocaleDateString(),
        businessName: businessInfo.business.name,
        adminUrl: `${siteUrl()}/admin/customers`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `New Customer: ${user.name || user.email}`,
      html,
    });
  },
});

// Send Admin Notification for Review Submitted
export const sendAdminReviewSubmittedNotification = internalAction({
  args: {
    reviewId: v.id("reviews"),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const review = await ctx.runQuery(internal.reviews.getByIdInternal, {
      reviewId: args.reviewId,
    });
    if (!review) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: review.userId,
    });
    if (!user) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: review.appointmentId },
    );
    if (!appointment) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);
    const stars = "\u2B50".repeat(review.rating);

    const html = await render(
      AdminReviewSubmittedNotificationEmail({
        customerName: user.name || "N/A",
        customerEmail: user.email || "N/A",
        rating: review.rating,
        stars,
        comment: review.comment,
        isPublic: review.isPublic,
        appointmentDate: appointment.scheduledDate,
        serviceNames,
        businessName: businessInfo.business.name,
        adminUrl: `${siteUrl()}/admin/reviews`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `New Review: ${stars} from ${user.name || user.email}`,
      html,
    });
  },
});

// Send Customer Review Request Email (after appointment completed)
export const sendCustomerReviewRequestEmail = internalAction({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    const html = await render(
      CustomerReviewRequestEmailTemplate({
        customerName: user.name || "Valued Customer",
        appointmentDate: appointment.scheduledDate,
        serviceNames,
        businessName: businessInfo.business.name,
        reviewUrl: `${siteUrl()}/dashboard/reviews`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `How was your service? - ${businessInfo.business.name}`,
      html,
    });
  },
});

export const sendCustomerAppointmentStatusEmail = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    status: v.union(
      v.literal("confirmed"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("rescheduled"),
    ),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    const statusLabel =
      args.status === "in_progress"
        ? "In Progress"
        : args.status === "rescheduled"
          ? "Rescheduled"
          : args.status === "cancelled"
            ? "Cancelled"
            : args.status === "confirmed"
              ? "Confirmed"
              : "Completed";

    const summaryLine =
      args.status === "cancelled"
        ? "Your appointment has been cancelled."
        : args.status === "rescheduled"
          ? "Your appointment has been rescheduled."
          : args.status === "in_progress"
            ? "Your detail appointment is now in progress."
            : args.status === "completed"
              ? "Your appointment has been completed."
              : "Your appointment has been confirmed.";

    const html = await render(
      CustomerAppointmentStatusEmailTemplate({
        customerName: user.name || "Valued Customer",
        statusLabel,
        summaryLine,
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formatTime12h(appointment.scheduledTime),
        serviceNames,
        location: formatLocation(appointment.location),
        businessName: businessInfo.business.name,
        dashboardUrl: `${siteUrl()}/dashboard/appointments`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Appointment ${statusLabel} - ${appointment.scheduledDate}`,
      html,
    });
  },
});

// Send Admin Notification for New Appointment
export const sendAdminAppointmentNotification = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    action: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("cancelled"),
      v.literal("confirmed"),
      v.literal("rescheduled"),
      v.literal("started"),
      v.literal("completed"),
    ),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: appointment.userId,
    });

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    let actionText =
      args.action === "created"
        ? "New Appointment Booked"
        : args.action === "confirmed"
          ? "Appointment Confirmed"
          : args.action === "updated"
            ? "Appointment Updated"
            : args.action === "cancelled"
              ? "Appointment Cancelled"
              : args.action === "rescheduled"
                ? "Appointment Rescheduled"
                : args.action === "started"
                  ? "Appointment Started"
                  : "Appointment Completed";

    if (!isArkansasState(appointment.location.state) && args.action === "created") {
      actionText = "⚠️ OUT-OF-STATE Booking (Review Required)";
    }

    const formattedTime = formatTime12h(appointment.scheduledTime);

    const html = await render(
      AdminAppointmentNotificationEmailTemplate({
        actionText,
        customerName: user?.name || "N/A",
        customerEmail: user?.email || "N/A",
        customerPhone: user?.phone || "N/A",
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formattedTime,
        duration: appointment.duration,
        totalPrice: appointment.totalPrice,
        serviceNames,
        location: formatLocation(appointment.location),
        status: appointment.status,
        notes: appointment.notes,
        beforePhotoCount: appointment.beforePhotos?.length ?? 0,
        businessName: businessInfo.business.name,
        adminUrl: `${siteUrl()}/admin/appointments/${args.appointmentId}`,
        logoUrl: logoUrl(),
      }),
    );

    const attachment =
      args.action === "created" ||
      args.action === "confirmed" ||
      args.action === "rescheduled" ||
      args.action === "cancelled"
        ? [
            buildAppointmentIcs({
              appointmentId: args.appointmentId,
              businessName: businessInfo.business.name,
              action: args.action,
              customerName: user?.name || user?.email || "Customer",
              appointmentDate: appointment.scheduledDate,
              appointmentTime: appointment.scheduledTime,
              location: formatLocation(appointment.location),
              serviceNames,
              duration: appointment.duration,
            }),
          ]
        : undefined;

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `${actionText} - ${appointment.scheduledDate} ${formattedTime}`,
      html,
      attachments: attachment,
    });
  },
});

export const sendAdminOutOfAreaRequestNotification = internalAction({
  args: {
    requestId: v.id("outOfAreaRequests"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const request = await ctx.runQuery(
      internal.bookingDrafts.getOutOfAreaRequestInternal,
      { requestId: args.requestId },
    );
    if (!request) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const formattedTime = request.scheduledTime
      ? formatTime12h(request.scheduledTime)
      : "No time selected";
    const vehicleLabel = request.vehicle
      ? [
          request.vehicle.year,
          request.vehicle.make,
          request.vehicle.model,
        ]
          .filter(Boolean)
          .join(" ") || "Vehicle details pending"
      : "Vehicle details pending";
    const location = formatLocation(request.address);
    const estimatedTravelFee =
      request.estimatedTravelFee !== undefined
        ? `$${request.estimatedTravelFee.toFixed(2)}`
        : "Unavailable";
    const estimatedDistance =
      request.estimatedDistanceMiles !== undefined
        ? `${request.estimatedDistanceMiles.toFixed(1)} miles`
        : "Unavailable";

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Out-of-area review request</h2>
        <p style="margin: 0 0 16px;">A customer requested manual review for service outside the regular area.</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 680px;">
          <tbody>
            <tr><td style="padding: 8px; font-weight: 700;">Customer</td><td style="padding: 8px;">${escapeHtml(request.customerName)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Email</td><td style="padding: 8px;">${escapeHtml(request.customerEmail)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Phone</td><td style="padding: 8px;">${escapeHtml(request.customerPhone)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Requested date</td><td style="padding: 8px;">${escapeHtml(request.scheduledDate || "No date selected")} ${escapeHtml(formattedTime)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Location</td><td style="padding: 8px;">${escapeHtml(location)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Vehicle</td><td style="padding: 8px;">${escapeHtml(vehicleLabel)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Distance</td><td style="padding: 8px;">${escapeHtml(estimatedDistance)}</td></tr>
            <tr><td style="padding: 8px; font-weight: 700;">Travel fee</td><td style="padding: 8px;">${escapeHtml(estimatedTravelFee)}</td></tr>
          </tbody>
        </table>
        <p style="margin-top: 16px;">
          <a href="${siteUrl()}/admin/out-of-area" style="color: #0f766e; font-weight: 700;">Review requests in admin</a>
        </p>
      </div>
    `;

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: await getPrimaryAdminRecipient(ctx),
      subject: `Out-of-area request - ${request.customerName}`,
      html,
    });
  },
});

// Generic internal action to send a raw email (used by test flows to forward admin emails)
export const sendRawEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;
    const business = await ctx.runQuery(api.business.get);
    const fromName = business?.name || "River City MD";
    await sendEmailMessage(ctx, {
      from: `${fromName} <no-reply@notifications.rivercitymd.com>`,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
  },
});

export const sendAdminMileageLogRequiredNotification = internalAction({
  args: {
    tripLogId: v.id("tripLogs"),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const tripLog = await ctx.runQuery(internal.tripLogs.getByIdInternal, {
      tripLogId: args.tripLogId,
    });
    if (!tripLog) return;

    const appointment = tripLog.appointmentId
      ? await ctx.runQuery(internal.appointments.getByIdInternal, {
          appointmentId: tripLog.appointmentId,
        })
      : null;
    const customer = appointment
      ? await ctx.runQuery(internal.users.getByIdInternal, {
          userId: appointment.userId,
        })
      : null;
    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const destination = tripLog.stops[0];
    const destinationLabel =
      destination?.addressLabel ||
      [
        destination?.street,
        destination?.city,
        destination?.state,
        destination?.postalCode,
      ]
        .filter(Boolean)
        .join(", ") ||
      "Not set";

    const appointmentInfo = appointment
      ? `${appointment.scheduledDate} ${formatTime12h(appointment.scheduledTime)}`
      : undefined;

    const customerInfo = customer
      ? `${customer.name || "Unknown"} (${customer.email || "no email"})`
      : undefined;

    const html = await render(
      AdminMileageLogRequiredNotificationEmailTemplate({
        logId: tripLog._id,
        logDate: tripLog.logDate,
        businessPurpose: tripLog.businessPurpose || "Not set",
        destinationLabel,
        appointmentInfo,
        customerInfo,
        businessName: businessInfo.business.name,
        adminUrl: `${siteUrl()}/admin/logs`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `Mileage log required - ${tripLog.logDate}`,
      html,
    });
  },
});

// Send Subscription Checkout Link Email
export const sendSubscriptionCheckoutLink = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    checkoutUrl: v.string(),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, sub.serviceIds);

    const html = await render(
      SubscriptionCheckoutLinkEmail({
        customerName: user.name || "Valued Customer",
        businessName: businessInfo.business.name,
        serviceName: serviceNames.join(", "),
        frequency: sub.frequency,
        price: sub.totalPrice,
        startDate: sub.startDate || sub.nextScheduledDate,
        checkoutUrl: args.checkoutUrl,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Set Up Your Recurring Service — ${businessInfo.business.name}`,
      html,
    });
  },
});

// Send Subscription Appointment Created Email
export const sendSubscriptionAppointmentCreated = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) return;

    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    if (!user || !user.email) return;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, appointment.serviceIds);

    const html = await render(
      SubscriptionAppointmentCreatedEmail({
        customerName: user.name || "Valued Customer",
        businessName: businessInfo.business.name,
        appointmentDate: appointment.scheduledDate,
        appointmentTime: formatTime12h(appointment.scheduledTime),
        serviceNames,
        location: formatLocation(appointment.location),
        dashboardUrl: `${siteUrl()}/dashboard/appointments`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: user.email,
      subject: `Your Upcoming Service is Scheduled — ${appointment.scheduledDate}`,
      html,
    });
  },
});

export const sendAdminSubscriptionCheckoutLinkNotification = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    checkoutUrl: v.string(),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const serviceNames = await getServiceNames(ctx, sub.serviceIds);
    const html = await render(
      AdminSubscriptionCheckoutLinkNotificationEmail({
        customerName: user?.name || user?.email || "Customer",
        customerEmail: user?.email || "N/A",
        businessName: businessInfo.business.name,
        serviceNames,
        frequency: sub.frequency,
        price: sub.totalPrice,
        checkoutUrl: args.checkoutUrl,
        adminUrl: `${siteUrl()}/admin/subscriptions`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `Subscription Checkout Link Sent - ${user?.name || user?.email || "Customer"}`,
      html,
    });
  },
});

export const sendAdminPaymentFailedNotification = internalAction({
  args: {
    appointmentId: v.optional(v.id("appointments")),
    invoiceId: v.optional(v.id("invoices")),
    subscriptionId: v.optional(v.id("subscriptions")),
    failureReason: v.optional(v.string()),
    recipientOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (shouldSkipEmails()) return;

    const appointment = args.appointmentId
      ? await ctx.runQuery(internal.appointments.getByIdInternal, {
          appointmentId: args.appointmentId,
        })
      : null;
    const invoice = args.invoiceId
      ? await ctx.runQuery(internal.invoices.getByIdInternal, {
          invoiceId: args.invoiceId,
        })
      : null;
    const subscription = args.subscriptionId
      ? await ctx.runQuery(internal.subscriptions.getByIdInternal, {
          subscriptionId: args.subscriptionId,
        })
      : null;

    const userId =
      appointment?.userId || invoice?.userId || subscription?.userId;
    const user = userId
      ? await ctx.runQuery(internal.users.getByIdInternal, { userId })
      : null;

    const businessInfo = await getBusinessAndFromName(ctx);
    if (!businessInfo) return;

    const paymentContext = args.subscriptionId
      ? `Subscription payment${subscription?.frequency ? ` (${subscription.frequency})` : ""}`
      : args.invoiceId
        ? `Invoice payment${invoice?.stripeInvoiceId ? ` (${invoice.stripeInvoiceId})` : ""}`
        : "Payment attempt";

    const appointmentSummary = appointment
      ? `${appointment.scheduledDate} at ${formatTime12h(appointment.scheduledTime)}`
      : undefined;

    const html = await render(
      AdminPaymentFailedNotificationEmail({
        businessName: businessInfo.business.name,
        customerName: user?.name,
        customerEmail: user?.email,
        appointmentSummary,
        failureReason: args.failureReason,
        paymentContext,
        adminUrl: `${siteUrl()}/admin/invoices`,
        logoUrl: logoUrl(),
      }),
    );

    await sendEmailMessage(ctx, {
      from: businessInfo.from,
      to: args.recipientOverride || (await getPrimaryAdminRecipient(ctx)),
      subject: `Payment Failed - ${user?.name || user?.email || "Customer"}`,
      html,
    });
  },
});
