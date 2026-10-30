import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import { resend } from "./emails";
import { registerTwilioRoutes } from "./sms";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";
import { registerRoutes } from "@convex-dev/stripe";
import type Stripe from "stripe";
import type { Id } from "./_generated/dataModel";
import { formatTime12h } from "./lib/time";
import {
  getDefaultAdminEmailRecipients,
  getDefaultAdminSmsRecipients,
  normalizeBusinessNotificationSettings,
} from "./lib/notificationSettings";

const http = httpRouter();
const CONFIG_ONLY_STRIPE_EVENT_PREFIXES = ["product.", "price.", "payout."] as const;

async function recordWebhookEvent(
  ctx: {
    runMutation: (typeof Function.prototype);
  },
  args: {
    source: "stripe" | "clerk" | "auth";
    level: "info" | "warn" | "error";
    eventType: string;
    eventId?: string;
    message: string;
    stripeObjectId?: string;
    checkoutSessionId?: string;
    invoiceId?: Id<"invoices">;
    appointmentId?: Id<"appointments">;
    userId?: Id<"users">;
    clerkUserId?: string;
    actionResult?: "linked" | "invited" | "skipped" | "failed" | "ignored";
    details?: string;
  },
) {
  try {
    await (ctx as any).runMutation(internal.webhookDiagnostics.record, args);
  } catch (error) {
    console.error("[webhook-diagnostics] failed to persist webhook event", error);
  }
}

async function getAdminSmsRecipients(ctx: any): Promise<string[]> {
  const business = await ctx.runQuery(api.business.get);
  const settings = normalizeBusinessNotificationSettings(
  business?.notificationSettings,
  );
  const recipients =
    settings?.adminSmsRecipients?.length
      ? settings.adminSmsRecipients
      : getDefaultAdminSmsRecipients();

  return Array.from(new Set(recipients.filter(Boolean)));
}

async function getAdminEmailRecipients(ctx: any): Promise<string[]> {
  const business = await ctx.runQuery(api.business.get);
  const settings = normalizeBusinessNotificationSettings(
    business?.notificationSettings,
  );
  const recipients =
    settings?.adminEmailRecipients?.length
      ? settings.adminEmailRecipients
      : getDefaultAdminEmailRecipients();

  return Array.from(new Set(recipients.filter(Boolean)));
}

async function notifyAdminDepositPaid(ctx: any, args: {
  appointmentId: Id<"appointments">;
  invoiceId: Id<"invoices">;
}) {
  const emailRecipients = await getAdminEmailRecipients(ctx);
  for (const recipient of emailRecipients) {
    await ctx.scheduler.runAfter(0, internal.emails.sendAdminDepositPaidNotification, {
      appointmentId: args.appointmentId,
      invoiceId: args.invoiceId,
      recipientOverride: recipient,
    });
  }

  const appointment = await ctx.runQuery(internal.appointments.getByIdInternal, {
    appointmentId: args.appointmentId,
  });
  if (!appointment) return;

  const user = await ctx.runQuery(internal.users.getByIdInternal, {
    userId: appointment.userId,
  });
  const recipients = await getAdminSmsRecipients(ctx);
  const body = `River City MD: Deposit paid by ${user?.name || user?.email || "customer"} for ${appointment.scheduledDate} at ${formatTime12h(appointment.scheduledTime)}.`;

  for (const recipient of recipients) {
    await ctx.scheduler.runAfter(0, internal.sms.sendSms, {
      to: recipient,
      body,
    });
  }
}

async function fulfillBookingDraftCheckout(
  ctx: any,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
) {
  const bookingDraftId = session.metadata?.draftId;
  if (!bookingDraftId) return;

  if (session.payment_status !== "paid") {
    console.info(
      `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=booking_checkout_pending_payment sessionId=${session.id} paymentStatus=${session.payment_status}`,
    );
    return;
  }

  const converted = await ctx.runMutation(
    internal.bookingDrafts.convertSuccessfulCheckout,
    {
      draftId: bookingDraftId as Id<"bookingDrafts">,
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : undefined,
      paymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : undefined,
    },
  );

  if (!converted) return;

  await ctx.scheduler.runAfter(0, internal.notifications.queueBookingReceived, {
    appointmentId: converted.appointmentId,
    invoiceId: converted.invoiceId,
    transition:
      event.type === "checkout.session.async_payment_succeeded"
        ? "checkout.session.async_payment_succeeded"
        : converted.isFullPayment
          ? "checkout.session.completed:full"
          : "checkout.session.completed:deposit",
  });

  if (converted.isFullPayment) {
    const paidUser = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: converted.userId,
    });
    if (paidUser) {
      await ctx.runMutation(internal.users.updateStats, {
        userId: converted.userId,
        timesServiced: (paidUser.timesServiced || 0) + 1,
        totalSpent: (paidUser.totalSpent || 0) + converted.total,
      });
    }
  }

  await notifyAdminDepositPaid(ctx, {
    appointmentId: converted.appointmentId,
    invoiceId: converted.invoiceId,
  });
}

registerTwilioRoutes(http);

// Register Stripe component webhook handler (handles data sync to component tables)
// The component verifies webhook signatures and syncs data automatically
// We add custom event handlers for our business logic
registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  onEvent: async (ctx, event: Stripe.Event) => {
    if (
      CONFIG_ONLY_STRIPE_EVENT_PREFIXES.some((prefix) =>
        event.type.startsWith(prefix),
      )
    ) {
      const object = event.data.object as { id?: string };
      console.info(
        `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=ignored_by_config stripeObjectId=${object?.id || "none"}`,
      );
      await recordWebhookEvent(ctx, {
        source: "stripe",
        level: "info",
        eventType: event.type,
        eventId: event.id,
        message:
          "Received a Stripe event that should be removed from the webhook subscription configuration",
        stripeObjectId: object?.id,
        actionResult: "ignored",
      });
    }
  },
  events: {
    // Delayed payment methods emit this after checkout.session.completed.
    "checkout.session.async_payment_succeeded": async (
      ctx,
      event: Stripe.CheckoutSessionAsyncPaymentSucceededEvent,
    ) => {
      const session = event.data.object;
      if (session.metadata?.type === "gift_card") {
        await ctx.runMutation(internal.giftCards.activateFromCheckout, {
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : undefined,
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : undefined,
        });
        return;
      }
      if (session.mode === "subscription" && session.metadata?.subscriptionId) {
        const subscriptionId = session.metadata.subscriptionId as Id<"subscriptions">;
        const stripeSubscriptionId = session.subscription as string;
        await ctx.runAction(internal.subscriptions.handleCheckoutCompleted, {
          subscriptionId,
          stripeSubscriptionId,
          paymentStatus: "paid",
        });
        return;
      }
      await fulfillBookingDraftCheckout(ctx, event, session);
    },

    // Handle deposit payment completion
    "checkout.session.completed": async (
      ctx,
      event: Stripe.CheckoutSessionCompletedEvent,
    ) => {
      const session = event.data.object;

      // --- Handle gift card purchase checkout ---
      if (session.metadata?.type === "gift_card") {
        if (
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required"
        ) {
          return;
        }
        await ctx.runMutation(internal.giftCards.activateFromCheckout, {
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : undefined,
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : undefined,
        });
        return;
      }

      // --- Handle subscription checkout ---
      if (session.mode === "setup" && session.metadata?.subscriptionId) {
        const subscriptionId = session.metadata.subscriptionId as Id<"subscriptions">;
        const setupIntentId = session.setup_intent as string;
        await ctx.runAction(internal.subscriptions.completeSetup, {
          subscriptionId,
          setupIntentId,
        });
        return;
      }

      if (session.mode === "subscription" && session.metadata?.subscriptionId) {
        const subscriptionId = session.metadata.subscriptionId as Id<"subscriptions">;
        const stripeSubscriptionId = session.subscription as string;
        await ctx.runAction(internal.subscriptions.handleCheckoutCompleted, {
          subscriptionId,
          stripeSubscriptionId,
          paymentStatus: session.payment_status,
        });
        return;
      }

      const bookingDraftId = session.metadata?.draftId;
      if (bookingDraftId) {
        await fulfillBookingDraftCheckout(ctx, event, session);
        return;
      }

      const invoiceIdString = session.metadata?.invoiceId;
      const paymentType = session.metadata?.type; // "deposit", "full", or undefined

      if (invoiceIdString && (paymentType === "deposit" || paymentType === "full")) {
        const invoiceId = invoiceIdString as Id<"invoices">;
        console.log(
          `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=checkout_completed sessionId=${session.id} invoiceId=${invoiceId} paymentType=${paymentType}`,
        );
        const invoice = await ctx.runQuery(
          internal.invoices.getByIdInternal,
          {
            invoiceId,
          },
        );

        if (!invoice) {
          console.warn(
            `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=invoice_not_found invoiceId=${invoiceId} sessionId=${session.id}`,
          );
          await recordWebhookEvent(ctx, {
            source: "stripe",
            level: "warn",
            eventType: event.type,
            eventId: event.id,
            message: "Stripe checkout completed event referenced an invoice that does not exist",
            stripeObjectId: session.payment_intent as string | undefined,
            checkoutSessionId: session.id,
            invoiceId,
          });
          return;
        }

        // Get the appointment and user to log guest bookings for reconciliation.
        const appointment = await ctx.runQuery(
            internal.appointments.getByIdInternal,
            { appointmentId: invoice.appointmentId }
        );

        if (appointment) {
            const user = await ctx.runQuery(internal.users.getByIdInternal, {
                userId: appointment.userId,
            });

            if (user && !user.clerkUserId) {
                console.log(
                  `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=guest_checkout_recorded sessionId=${session.id} invoiceId=${invoiceId} appointmentId=${invoice.appointmentId} userId=${user._id}`,
                );
                await recordWebhookEvent(ctx, {
                  source: "stripe",
                  level: "info",
                  eventType: event.type,
                  eventId: event.id,
                  message:
                    "Guest checkout recorded without sending a Clerk invitation",
                  checkoutSessionId: session.id,
                  invoiceId,
                  appointmentId: invoice.appointmentId,
                  userId: user._id,
                  actionResult: "skipped",
                  details: user.email,
                });
            } else if (!user) {
                console.warn(
                  `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=guest_account_sync_missing_user sessionId=${session.id} invoiceId=${invoiceId} appointmentId=${invoice.appointmentId}`,
                );
                await recordWebhookEvent(ctx, {
                  source: "stripe",
                  level: "warn",
                  eventType: event.type,
                  eventId: event.id,
                  message: "Stripe checkout completed event referenced a user that does not exist",
                  checkoutSessionId: session.id,
                  invoiceId,
                  appointmentId: invoice.appointmentId,
                });
            } else {
                await recordWebhookEvent(ctx, {
                  source: "stripe",
                  level: "info",
                  eventType: event.type,
                  eventId: event.id,
                  message: "Authenticated checkout completed with an existing Clerk-linked user",
                  checkoutSessionId: session.id,
                  invoiceId,
                  appointmentId: invoice.appointmentId,
                  userId: user._id,
                  clerkUserId: user.clerkUserId,
                });
            }
        } else {
          await recordWebhookEvent(ctx, {
            source: "stripe",
            level: "warn",
            eventType: event.type,
            eventId: event.id,
            message: "Stripe checkout completed event referenced an appointment that does not exist",
            checkoutSessionId: session.id,
            invoiceId,
            appointmentId: invoice.appointmentId,
          });
        }
        if (paymentType === "full") {
          // Full payment — mark invoice as completely paid
          if (invoice.status === "paid") {
            console.log(
              `[stripe-webhook] full payment already processed invoiceId=${invoiceId}`,
            );
            return;
          }

          const paymentIntentId = session.payment_intent as string | undefined;
          const today = new Date().toISOString().split("T")[0];

          await ctx.runMutation(
            internal.invoices.updateStatusInternal,
            {
              invoiceId,
              status: "paid",
              paidDate: today,
            },
          );

          // Also mark deposit as paid and set remaining balance to 0
          await ctx.runMutation(
            internal.invoices.updateDepositStatusInternal,
            {
              invoiceId,
              depositPaid: true,
              depositPaymentIntentId: paymentIntentId,
            },
          );

          console.log(
            `[stripe-webhook] full payment captured invoiceId=${invoiceId} paymentIntentId=${paymentIntentId || "none"}`,
          );

          await ctx.scheduler.runAfter(
            0,
            internal.notifications.queueBookingReceived,
            {
              appointmentId: invoice.appointmentId,
              invoiceId,
              transition: "checkout.session.completed:full",
            },
          );

          // Update user stats immediately since invoice is fully paid
          if (appointment) {
            const paidUser = await ctx.runQuery(internal.users.getByIdInternal, {
              userId: appointment.userId,
            });
            if (paidUser) {
              await ctx.runMutation(internal.users.updateStats, {
                userId: appointment.userId,
                timesServiced: (paidUser.timesServiced || 0) + 1,
                totalSpent: (paidUser.totalSpent || 0) + invoice.total,
              });
            }
          }

          await notifyAdminDepositPaid(ctx, {
            appointmentId: invoice.appointmentId,
            invoiceId,
          });
        } else {
          // Deposit payment flow (existing behavior)
          if (invoice.depositPaid) {
            console.log(
              `[stripe-webhook] deposit already marked paid invoiceId=${invoiceId}`,
            );
            return;
          }

          if (invoice && !invoice.depositPaid) {
            const paymentIntentId = session.payment_intent as
              | string
              | undefined;

            // Mark deposit as paid
            await ctx.runMutation(
              internal.invoices.updateDepositStatusInternal,
              {
                invoiceId,
                depositPaid: true,
                depositPaymentIntentId: paymentIntentId,
                status: "draft", // Will be updated to "sent" after Stripe invoice is created
              },
            );
            console.log(
              `[stripe-webhook] deposit captured invoiceId=${invoiceId} paymentIntentId=${paymentIntentId || "none"}`,
            );

            await ctx.scheduler.runAfter(
              0,
              internal.notifications.queueBookingReceived,
              {
                appointmentId: invoice.appointmentId,
                invoiceId,
                transition: "checkout.session.completed:deposit",
              },
            );

            // Deposit paid — appointment stays "pending" for admin review.
            // Admin confirms manually, which triggers Stripe invoice generation.
            console.log(
              `[stripe-webhook] deposit paid, appointment stays pending for admin review appointmentId=${invoice.appointmentId}`,
            );

            await notifyAdminDepositPaid(ctx, {
              appointmentId: invoice.appointmentId,
              invoiceId,
            });
          }
        }
      }
    },

    "checkout.session.expired": async (
      ctx,
      event: Stripe.CheckoutSessionExpiredEvent,
    ) => {
      const session = event.data.object;
      if (session.metadata?.type === "gift_card") {
        await ctx.runMutation(internal.giftCards.markCheckoutExpired, {
          stripeCheckoutSessionId: session.id,
        });
        return;
      }
      const bookingDraftId = session.metadata?.draftId;
      if (!bookingDraftId) {
        return;
      }

      await ctx.runMutation(internal.bookingDrafts.markExpiredInternal, {
        draftId: bookingDraftId as Id<"bookingDrafts">,
      });
    },

    // Handle payment intent success (backup for deposit payments)
    "payment_intent.succeeded": async (
      ctx,
      event: Stripe.PaymentIntentSucceededEvent,
    ) => {
      const paymentIntent = event.data.object;
      const invoiceIdString = paymentIntent.metadata?.invoiceId;
      const paymentType = paymentIntent.metadata?.type;

      // Handle deposit and full payments here (final payments are handled via invoice.paid)
      if (invoiceIdString && (paymentType === "deposit" || paymentType === "full")) {
        const invoiceId = invoiceIdString as Id<"invoices">;
        console.log(
          `[stripe-webhook] deposit payment_intent.succeeded invoiceId=${invoiceId} paymentIntentId=${paymentIntent.id}`,
        );
        const invoice = await ctx.runQuery(
          internal.invoices.getByIdInternal,
          {
            invoiceId,
          },
        );

        if (!invoice) {
          console.warn(
            `[stripe-webhook] eventId=${event.id} eventType=${event.type} action=invoice_not_found invoiceId=${invoiceId} paymentIntentId=${paymentIntent.id}`,
          );
          await recordWebhookEvent(ctx, {
            source: "stripe",
            level: "warn",
            eventType: event.type,
            eventId: event.id,
            message: "Stripe payment intent succeeded event referenced an invoice that does not exist",
            stripeObjectId: paymentIntent.id,
            invoiceId,
          });
          return;
        }

        if (paymentType === "full") {
          // Full payment backup handler
          if (invoice.status === "paid") {
            console.log(
              `[stripe-webhook] full payment already processed invoiceId=${invoiceId}`,
            );
            return;
          }

          const today = new Date().toISOString().split("T")[0];
          await ctx.runMutation(internal.invoices.updateStatusInternal, {
            invoiceId,
            status: "paid",
            paidDate: today,
          });
          await ctx.runMutation(internal.invoices.updateDepositStatusInternal, {
            invoiceId,
            depositPaid: true,
            depositPaymentIntentId: paymentIntent.id,
          });
          console.log(
            `[stripe-webhook] full payment captured via payment intent invoiceId=${invoiceId}`,
          );

          await ctx.scheduler.runAfter(
            0,
            internal.notifications.queueBookingReceived,
            {
              appointmentId: invoice.appointmentId,
              invoiceId,
              transition: "payment_intent.succeeded:full",
            },
          );

          // Update user stats
          const appointment = await ctx.runQuery(
            internal.appointments.getByIdInternal,
            { appointmentId: invoice.appointmentId },
          );
          if (appointment) {
            const paidUser = await ctx.runQuery(internal.users.getByIdInternal, {
              userId: appointment.userId,
            });
            if (paidUser) {
              await ctx.runMutation(internal.users.updateStats, {
                userId: appointment.userId,
                timesServiced: (paidUser.timesServiced || 0) + 1,
                totalSpent: (paidUser.totalSpent || 0) + invoice.total,
              });
            }
          }

          await notifyAdminDepositPaid(ctx, {
            appointmentId: invoice.appointmentId,
            invoiceId,
          });
        } else {
          // Deposit payment backup handler (existing behavior)
          if (invoice.depositPaid) {
            console.log(
              `[stripe-webhook] deposit payment already processed invoiceId=${invoiceId}`,
            );
            return;
          }

          if (invoice && !invoice.depositPaid) {
            await ctx.runMutation(
              internal.invoices.updateDepositStatusInternal,
              {
                invoiceId,
                depositPaid: true,
                depositPaymentIntentId: paymentIntent.id,
                status: "draft",
              },
            );
            console.log(
              `[stripe-webhook] deposit captured via payment intent invoiceId=${invoiceId}`,
            );

            await ctx.scheduler.runAfter(
              0,
              internal.notifications.queueBookingReceived,
              {
                appointmentId: invoice.appointmentId,
                invoiceId,
                transition: "payment_intent.succeeded:deposit",
              },
            );

            console.log(
              `[stripe-webhook] deposit paid via payment intent; appointment remains pending for admin review appointmentId=${invoice.appointmentId}`,
            );

            await notifyAdminDepositPaid(ctx, {
              appointmentId: invoice.appointmentId,
              invoiceId,
            });
          }
        }
      }
    },

    // Handle invoice payment
    "invoice.paid": async (ctx, event: Stripe.InvoicePaidEvent) => {
      const stripeInvoice = event.data.object;

      // --- Handle subscription renewal invoices ---
      // The first subscription invoice (billing_reason "subscription_create")
      // is handled by checkout.session.completed; only cycle invoices book
      // the next appointment.
      const stripeSubId = (stripeInvoice as any).subscription as string | null;
      const subscriptionBillingReason = (stripeInvoice as any)
        .billing_reason as string | undefined;
      if (stripeSubId && subscriptionBillingReason !== "subscription_create") {
        const ourSub = await ctx.runQuery(
          internal.subscriptions.getByStripeSubscriptionId,
          { stripeSubscriptionId: stripeSubId },
        );
        if (ourSub && ourSub.lastAppointmentId) {
          // Not the first payment (first is handled via checkout.session.completed)
          console.log(
            `[stripe-webhook] subscription renewal invoice.paid subscriptionId=${ourSub._id}`,
          );
          await ctx.scheduler.runAfter(0, internal.subscriptions.handleRenewalInvoicePaid, {
            subscriptionId: ourSub._id,
            stripeInvoiceId: stripeInvoice.id,
          });
          return;
        }
      }

      // Find our invoice by Stripe invoice ID
      const ourInvoice = await ctx.runQuery(
        internal.invoices.getByStripeIdInternal,
        {
          stripeInvoiceId: stripeInvoice.id,
        },
      );

      if (ourInvoice && ourInvoice.status !== "paid") {
        // Update invoice status to paid
        await ctx.runMutation(internal.invoices.updateStatusInternal, {
          invoiceId: ourInvoice._id,
          status: "paid",
          paidDate: new Date().toISOString().split("T")[0],
        });

        // Update user stats when invoice is fully paid
        const appointment = await ctx.runQuery(
          internal.appointments.getByIdInternal,
          {
            appointmentId: ourInvoice.appointmentId,
          },
        );
        if (appointment) {
          const user = await ctx.runQuery(internal.users.getByIdInternal, {
            userId: appointment.userId,
          });
          if (user) {
            await ctx.runMutation(internal.users.updateStats, {
              userId: appointment.userId,
              timesServiced: (user.timesServiced || 0) + 1,
              totalSpent: (user.totalSpent || 0) + ourInvoice.total,
            });
          }
        }
      }
    },

    // Handle invoice payment failure
    "invoice.payment_failed": async (
      ctx,
      event: Stripe.InvoicePaymentFailedEvent,
    ) => {
      const invoice = event.data.object;

      // --- Handle subscription payment failure ---
      const stripeSubId = (invoice as any).subscription as string | null;
      if (stripeSubId) {
        const ourSub = await ctx.runQuery(
          internal.subscriptions.getByStripeSubscriptionId,
          { stripeSubscriptionId: stripeSubId },
        );
        if (ourSub) {
          console.log(
            `[stripe-webhook] subscription payment failed subscriptionId=${ourSub._id}`,
          );
          await ctx.runMutation(internal.subscriptions.updateStatus, {
            subscriptionId: ourSub._id,
            status: "past_due",
          });
          await ctx.runMutation(internal.notifications.queuePaymentFailed, {
            subscriptionId: ourSub._id,
            userId: ourSub.userId,
            failureReason:
              invoice.attempt_count && invoice.attempt_count > 1
                ? `Stripe invoice payment failed after ${invoice.attempt_count} attempts`
                : "Stripe invoice payment failed",
            transition: "invoice.payment_failed:subscription",
          });
          return;
        }
      }

      // Find our invoice by Stripe invoice ID
      const ourInvoice = await ctx.runQuery(
        internal.invoices.getByStripeIdInternal,
        {
          stripeInvoiceId: invoice.id,
        },
      );

      if (ourInvoice) {
        console.log(`Payment failed for our invoice ${ourInvoice._id}`);
        await ctx.runMutation(internal.notifications.queuePaymentFailed, {
          appointmentId: ourInvoice.appointmentId,
          invoiceId: ourInvoice._id,
          userId: ourInvoice.userId,
          failureReason:
            invoice.attempt_count && invoice.attempt_count > 1
              ? `Stripe invoice payment failed after ${invoice.attempt_count} attempts`
              : "Stripe invoice payment failed",
          transition: "invoice.payment_failed:invoice",
        });
      }
    },

    // Handle Stripe subscription status changes
    "customer.subscription.updated": async (
      ctx,
      event: Stripe.CustomerSubscriptionUpdatedEvent,
    ) => {
      const stripeSub = event.data.object;
      const ourSub = await ctx.runQuery(
        internal.subscriptions.getByStripeSubscriptionId,
        { stripeSubscriptionId: stripeSub.id },
      );
      if (!ourSub) return;

      if (stripeSub.status === "canceled") {
        await ctx.runMutation(internal.subscriptions.updateStatus, {
          subscriptionId: ourSub._id,
          status: "cancelled",
        });
      } else if (
        stripeSub.status === "active" &&
        ourSub.status === "past_due"
      ) {
        await ctx.runMutation(internal.subscriptions.updateStatus, {
          subscriptionId: ourSub._id,
          status: "active",
        });
      }
    },

    // Handle Stripe subscription deletion
    "customer.subscription.deleted": async (
      ctx,
      event: Stripe.CustomerSubscriptionDeletedEvent,
    ) => {
      const stripeSub = event.data.object;
      const ourSub = await ctx.runQuery(
        internal.subscriptions.getByStripeSubscriptionId,
        { stripeSubscriptionId: stripeSub.id },
      );
      if (!ourSub) return;

      await ctx.runMutation(internal.subscriptions.updateStatus, {
        subscriptionId: ourSub._id,
        status: "cancelled",
      });
    },

    // Handle invoice voided
    "invoice.voided": async (ctx, event: Stripe.InvoiceVoidedEvent) => {
      const invoice = event.data.object;

      // Find our invoice by Stripe invoice ID
      const ourInvoice = await ctx.runQuery(
        internal.invoices.getByStripeIdInternal,
        {
          stripeInvoiceId: invoice.id,
        },
      );

      if (ourInvoice) {
        // Mark as voided/overdue
        await ctx.runMutation(internal.invoices.updateStatusInternal, {
          invoiceId: ourInvoice._id,
          status: "overdue",
        });
      }
    },

    "charge.refunded": async (ctx, event: Stripe.ChargeRefundedEvent) => {
      const charge = event.data.object;
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : undefined;
      if (!paymentIntentId) return;
      await ctx.runMutation(internal.giftCards.handlePurchaseRefund, {
        stripePaymentIntentId: paymentIntentId,
        refundAmount: charge.amount_refunded / 100,
      });
    },
  },
});

// Resend webhook endpoint for email status tracking
http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await resend.handleResendEventWebhook(ctx, req);
  }),
});

// Clerk webhook endpoint for user sync
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const event = await validateClerkWebhook(ctx, req);
    if (!event) {
      return new Response("Error occurred", { status: 400 });
    }

    switch (event.type) {
      case "user.created": // Intentional fallthrough
      case "user.updated":
        await ctx.runMutation(internal.users.upsertFromClerk, {
          data: event.data,
        });
        break;

      case "user.deleted": {
        const clerkUserId = event.data.id!;
        const deactivatedUserId = await ctx.runMutation(internal.users.deleteFromClerk, {
          clerkUserId,
        });
        await recordWebhookEvent(ctx, {
          source: "clerk",
          level: "warn",
          eventType: event.type,
          message: deactivatedUserId
            ? "Clerk user deletion removed auth access and preserved business data"
            : "Clerk user deletion did not match an existing Convex user",
          clerkUserId,
          userId: deactivatedUserId || undefined,
          actionResult: deactivatedUserId ? "skipped" : "ignored",
        });
        break;
      }

      default:
        console.log(`Ignored Clerk webhook event: ${event.type}`);
        await recordWebhookEvent(ctx, {
          source: "clerk",
          level: "info",
          eventType: event.type,
          message: "Ignored Clerk webhook event because this app only syncs user lifecycle events",
          actionResult: "ignored",
        });
    }

    return new Response(null, { status: 200 });
  }),
});

async function validateClerkWebhook(
  ctx: {
    runMutation: (typeof Function.prototype);
  },
  req: Request,
): Promise<WebhookEvent | null> {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET is not set");
    await recordWebhookEvent(ctx, {
      source: "clerk",
      level: "error",
      eventType: "clerk.webhook.validation",
      message: "CLERK_WEBHOOK_SECRET is not set",
    });
    return null;
  }

  const payloadString = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id")!,
    "svix-timestamp": req.headers.get("svix-timestamp")!,
    "svix-signature": req.headers.get("svix-signature")!,
  };

  const wh = new Webhook(webhookSecret);
  try {
    return wh.verify(payloadString, svixHeaders) as unknown as WebhookEvent;
  } catch (error) {
    console.error("Error verifying Clerk webhook event:", error);
    await recordWebhookEvent(ctx, {
      source: "clerk",
      level: "error",
      eventType: "clerk.webhook.validation",
      message: "Clerk webhook signature verification failed",
      details: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default http;
