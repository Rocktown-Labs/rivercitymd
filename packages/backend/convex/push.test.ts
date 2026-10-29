import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

describe("push tokens", () => {
  test("registers, dedupes, and removes a push token", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Push User",
        email: "push@example.com",
        clerkUserId: "user_push_1",
        role: "client",
      });
    });
    const asUser = t.withIdentity({ subject: "user_push_1" });

    await asUser.mutation(api.push.registerPushToken, {
      token: "ExponentPushToken[test]",
      platform: "ios",
    });
    await asUser.mutation(api.push.registerPushToken, {
      token: "ExponentPushToken[test]",
      platform: "android",
    });

    const registered = await t.run(async (ctx) => ctx.db.get(userId));
    expect(registered?.pushTokens).toHaveLength(1);
    expect(registered?.pushTokens?.[0]).toMatchObject({
      token: "ExponentPushToken[test]",
      platform: "android",
    });

    await asUser.mutation(api.push.removePushToken, {
      token: "ExponentPushToken[test]",
    });
    const removed = await t.run(async (ctx) => ctx.db.get(userId));
    expect(removed?.pushTokens).toEqual([]);
  });
});
