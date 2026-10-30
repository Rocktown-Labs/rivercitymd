import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { seedBookingSetup } from "./testUtils/bookingSetup";

async function createUser(
  t: ReturnType<typeof convexTest>,
  args: { name: string; email: string; role?: "admin" | "client" },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      role: args.role ?? "client",
    });
  });
}

describe("gift cards", () => {
  test("issues, reserves, captures, and leaves the remainder on the card", async () => {
    const t = convexTest(schema, modules);
    const recipientId = await createUser(t, {
      name: "Recipient",
      email: "recipient@example.com",
    });
    const created = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 100,
      deliveryMethod: "email",
      source: "admin_sale",
      paymentMethod: "cash",
      purchaserName: "Sender",
      purchaserEmail: "sender@example.com",
      recipientName: "Recipient",
      recipientEmail: "recipient@example.com",
      pin: "1234",
    });

    const issued = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(issued?.status).toBe("active");
    expect(issued?.balance).toBe(100);
    expect(issued?.claimedByUserId).toBe(recipientId);

    const reservationId = await t.mutation(
      internal.giftCards.reserveForOrder,
      {
        giftCardId: created._id,
        amount: 40,
        orderType: "booking",
        orderId: "draft_1",
      },
    );

    const reserved = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(reserved?.balance).toBe(100);
    expect(reserved?.reservedBalance).toBe(40);

    await t.mutation(internal.giftCards.captureReservation, {
      reservationId,
    });

    const captured = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(captured?.balance).toBe(60);
    expect(captured?.reservedBalance).toBe(0);
    expect(captured?.status).toBe("active");

    const transactions = await t.run(async (ctx) =>
      ctx.db
        .query("giftCardTransactions")
        .withIndex("by_gift_card", (q) => q.eq("giftCardId", created._id))
        .collect(),
    );
    expect(transactions.map((tx) => tx.type).sort()).toEqual([
      "issue",
      "redeem",
    ]);
  });

  test("releases a reservation without spending the balance", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 200,
      deliveryMethod: "print",
      source: "admin_sale",
      paymentMethod: "cash",
      purchaserName: "Buyer",
    });

    const reservationId = await t.mutation(
      internal.giftCards.reserveForOrder,
      {
        giftCardId: created._id,
        amount: 75,
        orderType: "invoice",
        orderId: "invoice_1",
      },
    );
    await t.mutation(internal.giftCards.releaseReservation, {
      reservationId,
      reason: "Checkout cancelled",
    });

    const card = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(card?.balance).toBe(200);
    expect(card?.reservedBalance).toBe(0);
  });

  test("claims a token card only with the matching email", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 100,
      deliveryMethod: "email",
      source: "admin_sale",
      paymentMethod: "cash",
      purchaserName: "Sender",
      recipientEmail: "new-recipient@example.com",
      pin: "4321",
    });
    const recipientId = await createUser(t, {
      name: "New Recipient",
      email: "new-recipient@example.com",
    });
    const asRecipient = t.withIdentity({
      subject: recipientId,
      email: "new-recipient@example.com",
    });

    const claim = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(claim?.claimToken).toBeTruthy();

    await asRecipient.mutation(api.giftCards.claimByToken, {
      token: claim!.claimToken!,
    });

    const claimed = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(claimed?.claimedByUserId).toBe(recipientId);
    expect(claimed?.claimToken).toBeUndefined();
  });

  test("verifies a PIN when claiming by code", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUser(t, {
      name: "PIN Recipient",
      email: "pin@example.com",
    });
    const created = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 100,
      deliveryMethod: "print",
      source: "admin_sale",
      paymentMethod: "cash",
      purchaserName: "Buyer",
      pin: "9876",
    });
    const asUser = t.withIdentity({
      subject: userId,
      email: "pin@example.com",
    });

    await expect(
      asUser.mutation(api.giftCards.claimByCode, {
        code: created.code,
        pin: "0000",
      }),
    ).rejects.toThrow(/PIN/);

    await asUser.mutation(api.giftCards.claimByCode, {
      code: created.code,
      pin: "9876",
    });

    const claimed = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(claimed?.claimedByUserId).toBe(userId);
  });

  test("adjusts and voids a card with an audit trail", async () => {
    const t = convexTest(schema, modules);
    const adminId = await createUser(t, {
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin@example.com",
    });
    const created = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 100,
      deliveryMethod: "print",
      source: "admin_credit",
      paymentMethod: "comp",
      purchaserName: "Admin",
      createdByUserId: adminId,
    });

    const adjusted = await asAdmin.mutation(
      api.giftCards.adjustGiftCardBalance,
      {
        giftCardId: created._id,
        amount: 25,
        note: "Service recovery",
      },
    );
    expect(adjusted).toBe(125);

    await asAdmin.mutation(api.giftCards.voidGiftCard, {
      giftCardId: created._id,
      reason: "Issued in error",
    });

    const voided = await t.run(async (ctx) => ctx.db.get(created._id));
    expect(voided?.status).toBe("voided");
    expect(voided?.balance).toBe(0);

    const transactions = await t.run(async (ctx) =>
      ctx.db
        .query("giftCardTransactions")
        .withIndex("by_gift_card", (q) => q.eq("giftCardId", created._id))
        .collect(),
    );
    expect(transactions.map((tx) => tx.type).sort()).toEqual([
      "adjust",
      "issue",
      "void",
    ]);
  });
});

describe("gift card booking conversion", () => {
  test("captures a reservation and records the credit on the invoice", async () => {
    const t = convexTest(schema, modules);
    const { serviceId } = await seedBookingSetup(t);
    const userId = await createUser(t, {
      name: "Booking Customer",
      email: "booking@example.com",
    });
    const vehicleId = await t.run(async (ctx) => {
      return await ctx.db.insert("vehicles", {
        userId,
        year: 2021,
        make: "Toyota",
        model: "Camry",
        size: "medium",
      });
    });

    const card = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 100,
      deliveryMethod: "self",
      source: "admin_sale",
      paymentMethod: "cash",
      purchaserUserId: userId,
      purchaserName: "Booking Customer",
      purchaserEmail: "booking@example.com",
    });
    const reservationId = await t.mutation(
      internal.giftCards.reserveForOrder,
      {
        giftCardId: card._id,
        amount: 40,
        orderType: "booking",
        orderId: "draft_gift_card",
      },
    );

    const draftId = await t.run(async (ctx) => {
      return await ctx.db.insert("bookingDrafts", {
        sourceUserId: userId,
        customerName: "Booking Customer",
        customerEmail: "booking@example.com",
        customerPhone: "5015550100",
        address: {
          street: "123 Main St",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
        existingVehicleIds: [vehicleId],
        draftVehicles: [],
        serviceIds: [serviceId!],
        scheduledDate: "2026-11-10",
        scheduledTime: "10:00",
        duration: 60,
        vehicleCount: 1,
        vehicleSize: "medium",
        totalPrice: 100,
        depositAmount: 100,
        remainingBalance: 0,
        paymentOption: "full",
        priceSnapshot: [
          {
            itemType: "service",
            serviceId: serviceId!,
            vehicleId,
            vehicleLabel: "2021 Toyota Camry",
            serviceName: "Setup Baseline Service",
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
        ],
        status: "checkout_open",
        resumeToken: "gift-card-booking-token",
        giftCardId: card._id,
        giftCardAppliedAmount: 40,
        giftCardReservationId: reservationId,
        lastActivityAt: Date.now(),
      });
    });

    const converted = await t.mutation(
      internal.bookingDrafts.convertSuccessfulCheckout,
      {
        draftId,
        giftCardReservationId: reservationId,
      },
    );

    expect(converted?.isFullPayment).toBe(true);
    const invoice = await t.run(async (ctx) => ctx.db.get(converted!.invoiceId));
    expect(invoice?.status).toBe("paid");
    expect(invoice?.total).toBe(100);
    expect(invoice?.giftCardApplied).toBe(40);
    expect(invoice?.giftCardIds).toEqual([card._id]);

    const updatedCard = await t.run(async (ctx) => ctx.db.get(card._id));
    expect(updatedCard?.balance).toBe(60);
    expect(updatedCard?.reservedBalance).toBe(0);
  });
});

describe("gift card invoice application", () => {
  test("captures the reservation and reduces the invoice balance atomically", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUser(t, {
      name: "Invoice Customer",
      email: "invoice@example.com",
    });
    const adminId = await createUser(t, {
      name: "Admin",
      email: "invoice-admin@example.com",
      role: "admin",
    });
    const appointmentId = await t.run(async (ctx) => {
      return await ctx.db.insert("appointments", {
        userId,
        vehicleIds: [],
        serviceIds: [],
        scheduledDate: "2026-11-12",
        scheduledTime: "09:00",
        duration: 60,
        location: {
          street: "123 Main St",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
        status: "pending",
        totalPrice: 100,
        createdBy: adminId,
        paymentOption: "deposit",
      });
    });
    const invoiceId = await t.run(async (ctx) => {
      return await ctx.db.insert("invoices", {
        appointmentId,
        userId,
        invoiceNumber: "INV-TEST-GC",
        items: [],
        subtotal: 100,
        tax: 0,
        total: 100,
        status: "draft",
        dueDate: "2026-11-12",
        depositAmount: 0,
        depositPaid: true,
        remainingBalance: 100,
        paymentOption: "deposit",
      });
    });

    const card = await t.mutation(internal.giftCards.createGiftCard, {
      amount: 100,
      deliveryMethod: "self",
      source: "admin_sale",
      paymentMethod: "cash",
      purchaserUserId: userId,
      purchaserName: "Invoice Customer",
      purchaserEmail: "invoice@example.com",
    });
    const reservationId = await t.mutation(
      internal.giftCards.reserveForOrder,
      {
        giftCardId: card._id,
        amount: 40,
        orderType: "invoice",
        orderId: String(invoiceId),
      },
    );

    const result = await t.mutation(
      internal.giftCards.captureReservationToInvoice,
      {
        reservationId,
        invoiceId,
        note: "Applied to invoice",
      },
    );

    expect(result.remainingBalance).toBe(60);
    expect(result.status).toBe("draft");
    const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId));
    expect(invoice?.giftCardApplied).toBe(40);
    expect(invoice?.remainingBalance).toBe(60);
    expect(invoice?.giftCardIds).toEqual([card._id]);

    const updatedCard = await t.run(async (ctx) => ctx.db.get(card._id));
    expect(updatedCard?.balance).toBe(60);
    expect(updatedCard?.reservedBalance).toBe(0);
  });
});
