import { v } from "convex/values";
import { internalAction, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getUserIdFromIdentity } from "./auth";

const platformValidator = v.union(
  v.literal("ios"),
  v.literal("android"),
  v.literal("web"),
);

export const registerPushToken = mutation({
  args: {
    token: v.string(),
    platform: platformValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const now = Date.now();
    const existing = user.pushTokens ?? [];
    const next = existing.filter((entry) => entry.token !== args.token);
    next.push({
      token: args.token,
      platform: args.platform,
      updatedAt: now,
    });
    await ctx.db.patch(userId, { pushTokens: next });
    return userId;
  },
});

export const removePushToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user) return;
    await ctx.db.patch(userId, {
      pushTokens: (user.pushTokens ?? []).filter(
        (entry) => entry.token !== args.token,
      ),
    });
  },
});

export const getTokensForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.pushTokens ?? [];
  },
});

export const sendPushToUser = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens: Array<{
      token: string;
      platform: "ios" | "android" | "web";
      updatedAt: number;
    }> = await ctx.runQuery(internal.push.getTokensForUser, {
      userId: args.userId,
    });
    if (tokens.length === 0) return { sent: 0 };

    const messages: Array<{
      to: string;
      sound: "default";
      title: string;
      body: string;
      data: Record<string, string>;
    }> = tokens.map((token) => ({
      to: token.token,
      sound: "default",
      title: args.title,
      body: args.body,
      data: args.data ?? {},
    }));

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[push] send failed", response.status, text);
      return { sent: 0 };
    }

    return { sent: messages.length };
  },
});

export const sendAppointmentStatusPush = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("rescheduled"),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const appointment = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );
    if (!appointment) return;

    const copy: Record<string, { title: string; body: string }> = {
      pending: {
        title: "Booking received",
        body: `We received your request for ${appointment.scheduledDate} at ${appointment.scheduledTime}.`,
      },
      confirmed: {
        title: "Appointment confirmed",
        body: `You're confirmed for ${appointment.scheduledDate} at ${appointment.scheduledTime}.`,
      },
      in_progress: {
        title: "Your detail has started",
        body: "Your technician is working on your vehicle now.",
      },
      completed: {
        title: "Your detail is complete",
        body: "Thanks for choosing River City Mobile Detailing.",
      },
      cancelled: {
        title: "Appointment cancelled",
        body: `Your ${appointment.scheduledDate} appointment was cancelled.`,
      },
      rescheduled: {
        title: "Appointment rescheduled",
        body: `Your appointment is now ${appointment.scheduledDate} at ${appointment.scheduledTime}.`,
      },
    };
    const message = copy[args.status];
    if (!message) return;

    await ctx.runAction(internal.push.sendPushToUser, {
      userId: appointment.userId,
      title: message.title,
      body: message.body,
      data: { appointmentId: String(appointment._id) },
    });
  },
});
