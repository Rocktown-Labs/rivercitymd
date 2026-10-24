import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { seedBookingSetup } from "./testUtils/bookingSetup";

const clerkMocks = vi.hoisted(() => ({
  getUserList: vi.fn(async () => ({ data: [] })),
  createInvitation: vi.fn(async () => ({ id: "inv_test_123" })),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: {
      getUserList: clerkMocks.getUserList,
    },
    invitations: {
      createInvitation: clerkMocks.createInvitation,
    },
  }),
}));

const BOOKING_TEST_DATE = "2024-12-02"; // Monday (dayOfWeek 1)

async function expectConvexErrorCode(
  promise: Promise<unknown>,
  expectedCode: string,
) {
  try {
    await promise;
    throw new Error("Expected mutation to throw");
  } catch (error: any) {
    const errorCode = error?.data?.code ?? String(error?.message ?? "");
    expect(String(errorCode)).toContain(expectedCode);
  }
}

describe("users", () => {
  beforeEach(() => {
    clerkMocks.getUserList.mockReset();
    clerkMocks.createInvitation.mockReset();
    clerkMocks.getUserList.mockResolvedValue({ data: [] });
    clerkMocks.createInvitation.mockResolvedValue({ id: "inv_test_123" });
  });

  test("create onboarding profile with Clerk subject-only identity", async () => {
    const t = convexTest(schema, modules);

    const clerkUserId = "user_subject_only_123";
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "subject-only@example.com",
        clerkUserId,
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asUser = t.withIdentity({ subject: clerkUserId });

    await asUser.mutation(api.users.createUserProfile, {
      name: "Subject Only User",
      phone: "555-0100",
      marketingEmails: true,
      address: {
        street: "100 Subject St",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      vehicles: [
        {
          year: 2020,
          make: "Toyota",
          model: "Camry",
          color: "Gray",
        },
      ],
    });

    const updatedUser = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(updatedUser).toMatchObject({
      name: "Subject Only User",
      phone: "555-0100",
      clerkUserId,
      role: "client",
    });
    expect(
      updatedUser?.notificationPreferences?.marketingEmails,
    ).toBe(true);
    expect(updatedUser?.address).toMatchObject({
      street: "100 Subject St",
      city: "Little Rock",
      state: "AR",
      zip: "72201",
    });

    const vehicles = await t.run(async (ctx) => {
      return await ctx.db
        .query("vehicles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    });
    expect(vehicles.length).toBe(1);
    expect(vehicles[0]).toMatchObject({
      make: "Toyota",
      model: "Camry",
      color: "Gray",
    });
  });

  test("onboarding profile completion preserves dashboard role routing", async () => {
    const t = convexTest(schema, modules);

    const clerkClientId = "clerk_onboarding_client";
    const clientUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "route-client@example.com",
        clerkUserId: clerkClientId,
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asClient = t.withIdentity({
      subject: clerkClientId,
      email: "route-client@example.com",
    });
    await asClient.mutation(api.users.createUserProfile, {
      name: "Routing Client",
      phone: "555-1010",
      address: {
        street: "10 Route St",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      vehicles: [
        {
          year: 2022,
          make: "Toyota",
          model: "Corolla",
          color: "Blue",
        },
      ],
    });

    const clientRole = await asClient.query(api.auth.getUserRole, {});
    expect(clientRole).toMatchObject({
      type: "client",
      userId: clientUserId,
    });

    const clerkAdminId = "clerk_onboarding_admin";
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "route-admin@example.com",
        clerkUserId: clerkAdminId,
        role: "admin",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asAdmin = t.withIdentity({
      subject: clerkAdminId,
      email: "route-admin@example.com",
    });
    const adminRole = await asAdmin.query(api.auth.getUserRole, {});
    expect(adminRole).toMatchObject({
      type: "admin",
    });
  });

  test("create user profile during onboarding", async () => {
    const t = convexTest(schema, modules);

    // Create a user with minimal info
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "newuser@example.com",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: "newuser@example.com",
    });

    // Update profile during onboarding
    await asUser.mutation(api.users.updateUserProfile, {
      name: "New User",
      phone: "555-0000",
      address: {
        street: "123 New St",
        city: "Springfield",
        state: "IL",
        zip: "62701",
      },
    });

    // Verify profile was updated
    const user = await asUser.query(api.users.getCurrentUser, {});
    expect(user).toMatchObject({
      name: "New User",
      phone: "555-0000",
      email: "newuser@example.com",
    });
  });

  test("get current user", async () => {
    const t = convexTest(schema, modules);

    // Create a user
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Test User",
        email: "test@example.com",
        phone: "555-1234",
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: "test@example.com",
    });

    // Get current user
    const currentUser = await asUser.query(api.users.getCurrentUser, {});

    expect(currentUser).toMatchObject({
      name: "Test User",
      email: "test@example.com",
      phone: "555-1234",
      role: "client",
    });
  });

  test("onboarding status", async () => {
    const t = convexTest(schema, modules);

    // Test user with no profile info
    const incompleteUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: undefined,
        email: "incomplete@example.com",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asIncompleteUser = t.withIdentity({
      subject: incompleteUserId,
      email: "incomplete@example.com",
    });

    const incompleteStatus = await asIncompleteUser.query(
      api.users.getOnboardingStatus,
      {},
    );
    expect(incompleteStatus.isComplete).toBe(false);
    expect(incompleteStatus.missingSteps).toEqual([
      "personal",
      "address",
      "vehicles",
    ]);

    // Test user with complete profile
    const completeUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Complete User",
        email: "complete@example.com",
        phone: "555-1111",
        address: {
          street: "123 Complete St",
          city: "Springfield",
          state: "IL",
          zip: "62701",
        },
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });

      // Add vehicle
      await ctx.db.insert("vehicles", {
        userId,
        year: 2020,
        make: "Nissan",
        model: "Altima",
        color: "Blue",
      });

      return userId;
    });

    const asCompleteUser = t.withIdentity({
      subject: completeUserId,
      email: "complete@example.com",
    });

    const completeStatus = await asCompleteUser.query(
      api.users.getOnboardingStatus,
      {},
    );
    expect(completeStatus.isComplete).toBe(true);
    expect(completeStatus.missingSteps).toEqual([]);
  });

  test("get current user with profile data", async () => {
    const t = convexTest(schema, modules);

    // Create a user
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Current User",
        email: "current@example.com",
        phone: "555-9999",
        role: "client",
        timesServiced: 2,
        totalSpent: 150,
        status: "active",
      });
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: "current@example.com",
    });

    // Get current user
    const currentUser = await asUser.query(api.users.getCurrentUser, {});

    expect(currentUser).toMatchObject({
      name: "Current User",
      email: "current@example.com",
      phone: "555-9999",
      role: "client",
      timesServiced: 2,
      totalSpent: 150,
      status: "active",
    });
  });

  test("add and remove vehicles", async () => {
    const t = convexTest(schema, modules);

    // Create a user
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Vehicle User",
        email: "vehicle@example.com",
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: "vehicle@example.com",
    });

    // Add a vehicle
    const vehicleId = await asUser.mutation(api.users.addVehicle, {
      year: 2018,
      make: "BMW",
      model: "X3",
      color: "Black",
      licensePlate: "ABC123",
    });

    expect(vehicleId).toBeDefined();

    // Verify vehicle was added
    const vehicles = await asUser.query(api.users.getUserVehicles, {});
    expect(vehicles.length).toBe(1);
    expect(vehicles[0]).toMatchObject({
      year: 2018,
      make: "BMW",
      model: "X3",
      color: "Black",
      licensePlate: "ABC123",
    });

    // Remove vehicle
    await asUser.mutation(api.users.removeVehicle, {
      vehicleId,
    });

    // Verify vehicle was removed
    const vehiclesAfterRemoval = await asUser.query(
      api.users.getUserVehicles,
      {},
    );
    expect(vehiclesAfterRemoval.length).toBe(0);
  });

  test("admin can manage users", async () => {
    const t = convexTest(schema, modules);

    // Create admin user
    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Admin User",
        email: "admin@example.com",
        role: "admin",
      });
    });

    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin@example.com",
    });

    // Create a client user
    const clientId = await asAdmin.mutation(api.users.create, {
      name: "Client User",
      email: "client@example.com",
      phone: "555-2222",
      role: "client",
      address: {
        street: "789 Client St",
        city: "Springfield",
        state: "IL",
        zip: "62703",
      },
      vehicles: [
        {
          year: 2022,
          make: "Honda",
          model: "Civic",
          color: "Blue",
          size: "small",
        },
        {
          year: 2024,
          make: "Ford",
          model: "Explorer",
          color: "Black",
          size: "large",
        },
      ],
    });

    expect(clientId).toBeDefined();

    // List all users (admin only)
    const users = await asAdmin.query(api.users.list, {});
    expect(users.length).toBeGreaterThanOrEqual(2); // admin + client

    // Get user by ID
    const clientUser = await asAdmin.query(api.users.getById, {
      userId: clientId,
    });
    expect(clientUser).toMatchObject({
      name: "Client User",
      email: "client@example.com",
      phone: "555-2222",
      role: "client",
    });

    const clientVehicles = await t.run(async (ctx) => {
      return await ctx.db
        .query("vehicles")
        .withIndex("by_user", (q) => q.eq("userId", clientId))
        .collect();
    });

    expect(clientVehicles).toHaveLength(2);
    expect(clientVehicles.map((vehicle) => vehicle.model).sort()).toEqual([
      "Civic",
      "Explorer",
    ]);
  });

  test("admin can create a vehicle for an existing client", async () => {
    const t = convexTest(schema, modules);

    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Admin User",
        email: "admin-create-vehicle@example.com",
        role: "admin",
      });
    });

    const clientId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Vehicle Client",
        email: "vehicle-client@example.com",
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-create-vehicle@example.com",
    });

    const vehicleId = await asAdmin.mutation(api.vehicles.create, {
      userId: clientId,
      year: 2023,
      make: "Toyota",
      model: "RAV4",
      color: "White",
      size: "medium",
      licensePlate: "ABC123",
    });

    const vehicle = await t.run(async (ctx) => {
      return await ctx.db.get(vehicleId);
    });

    expect(vehicle).toMatchObject({
      userId: clientId,
      make: "Toyota",
      model: "RAV4",
      color: "White",
      size: "medium",
      licensePlate: "ABC123",
    });
  });

  test("sendInvitation links existing Clerk account by email without sending invite", async () => {
    const t = convexTest(schema, modules);
    clerkMocks.getUserList.mockResolvedValue({
      data: [{ id: "user_clerk_existing_123" }],
    } as any);

    const clientId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Linked Client",
        email: "linked-client@example.com",
        role: "client",
      });
    });

    await t.action((internal.users as any).sendInvitation, {
      userId: clientId,
      email: "linked-client@example.com",
    });

    const clientUser = await t.run(async (ctx) => ctx.db.get(clientId));
    expect(clientUser?.clerkUserId).toBe("user_clerk_existing_123");
    expect(clerkMocks.createInvitation).not.toHaveBeenCalled();
  });

  test("sendInvitation creates an invite when Clerk account does not exist", async () => {
    const t = convexTest(schema, modules);
    clerkMocks.getUserList.mockResolvedValue({ data: [] });

    const clientId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Invited Client",
        email: "invited-client@example.com",
        role: "client",
      });
    });

    await t.action((internal.users as any).sendInvitation, {
      userId: clientId,
      email: "invited-client@example.com",
    });

    const clientUser = await t.run(async (ctx) => ctx.db.get(clientId));
    expect(clientUser?.clerkUserId).toBeUndefined();
    expect(clerkMocks.createInvitation).toHaveBeenCalledTimes(1);
  });

  test("upsertFromClerk preserves business-owned fields", async () => {
    const t = convexTest(schema, modules);

    const clientId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Existing Name",
        email: "existing-client@example.com",
        phone: "555-1111",
        role: "client",
        status: "active",
        clerkUserId: undefined,
        stripeCustomerId: "cus_existing_123",
        address: {
          street: "12 Existing St",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
        notes: "Preserve me",
      });
    });

    const result = await t.mutation((internal.users as any).upsertFromClerk, {
      data: {
        id: "user_clerk_sync_123",
        first_name: "Updated",
        last_name: "Profile",
        email_addresses: [{ email_address: "existing-client@example.com" }],
        image_url: "https://example.com/avatar.png",
        public_metadata: {},
      },
    });

    expect(result).toBe(clientId);

    const updatedUser = await t.run(async (ctx) => ctx.db.get(clientId));
    expect(updatedUser).toMatchObject({
      name: "Updated Profile",
      email: "existing-client@example.com",
      phone: "555-1111",
      role: "client",
      stripeCustomerId: "cus_existing_123",
      notes: "Preserve me",
      clerkUserId: "user_clerk_sync_123",
    });
    expect(updatedUser?.address).toMatchObject({
      street: "12 Existing St",
      city: "Little Rock",
      state: "AR",
      zip: "72201",
    });
  });

  test("deleteFromClerk deactivates auth without deleting business records", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Deactivated Client",
        email: "deactivate@example.com",
        clerkUserId: "user_delete_123",
        role: "client",
        status: "active",
      });
    });

    const vehicleId = await t.run(async (ctx) => {
      return await ctx.db.insert("vehicles", {
        userId,
        year: 2022,
        make: "Honda",
        model: "Civic",
        color: "Black",
      });
    });

    const serviceCategoryId = await t.run(async (ctx) => {
      return await ctx.db.insert("serviceCategories", {
        name: "Standard",
        type: "standard",
      });
    });

    const serviceId = await t.run(async (ctx) => {
      return await ctx.db.insert("services", {
        name: "Exterior Detail",
        description: "Full exterior wash",
        basePrice: 100,
        duration: 60,
        categoryId: serviceCategoryId,
        isActive: true,
      });
    });

    const appointmentId = await t.run(async (ctx) => {
      return await ctx.db.insert("appointments", {
        userId,
        vehicleIds: [vehicleId],
        serviceIds: [serviceId],
        scheduledDate: BOOKING_TEST_DATE,
        scheduledTime: "09:00",
        duration: 60,
        location: {
          street: "123 Main St",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
        status: "confirmed",
        totalPrice: 100,
        createdBy: userId,
      });
    });

    const invoiceId = await t.run(async (ctx) => {
      return await ctx.db.insert("invoices", {
        appointmentId,
        userId,
        invoiceNumber: "INV-DELETE-001",
        items: [
          {
            serviceId,
            serviceName: "Exterior Detail",
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
        ],
        subtotal: 100,
        tax: 0,
        total: 100,
        status: "sent",
        dueDate: BOOKING_TEST_DATE,
      });
    });

    const result = await t.mutation((internal.users as any).deleteFromClerk, {
      clerkUserId: "user_delete_123",
    });

    expect(result).toBe(userId);

    const [user, vehicle, appointment, invoice] = await Promise.all([
      t.run(async (ctx) => ctx.db.get(userId)),
      t.run(async (ctx) => ctx.db.get(vehicleId)),
      t.run(async (ctx) => ctx.db.get(appointmentId)),
      t.run(async (ctx) => ctx.db.get(invoiceId)),
    ]);

    expect(user?.status).toBe("inactive");
    expect(user?.clerkUserId).toBeUndefined();
    expect(vehicle?._id).toBe(vehicleId);
    expect(appointment?._id).toBe(appointmentId);
    expect(invoice?._id).toBe(invoiceId);
  });

  test("createUserProfile and retry action sync Stripe customer", async () => {
    const t = convexTest(schema, modules);

    const clerkUserId = "user_profile_sync_123";
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "profilesync@example.com",
        clerkUserId,
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    const asUser = t.withIdentity({
      subject: clerkUserId,
      email: "profilesync@example.com",
    });

    await asUser.mutation(api.users.createUserProfile, {
      name: "Profile Sync",
      phone: "555-0199",
      address: {
        street: "1 Sync St",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      vehicles: [
        {
          year: 2022,
          make: "Honda",
          model: "Civic",
          color: "Silver",
        },
      ],
    });

    // Validate the same internal retry action used by scheduler can sync the ID.
    await t.action((internal.users as any).ensureStripeCustomerWithRetry, {
      userId,
      attempt: 0,
    });

    const updatedUser = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(updatedUser?.stripeCustomerId).toBe(`cus_test_${userId}`);
  });

  test("ensureStripeCustomerWithRetry does not throw for deleted user", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "deleted-user@example.com",
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.delete(userId);
    });

    await expect(
      t.action((internal.users as any).ensureStripeCustomerWithRetry, {
        userId,
        attempt: 0,
      }),
    ).resolves.toBeNull();
  });

  test("backfillMissingStripeCustomers dry run and limit", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-backfill@example.com",
        role: "admin",
      });
    });

    const activeClientA = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "active-client-a@example.com",
        role: "client",
        status: "active",
      });
    });
    const activeClientB = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "active-client-b@example.com",
        role: "client",
        status: "active",
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "inactive-client@example.com",
        role: "client",
        status: "inactive",
      });
      await ctx.db.insert("users", {
        email: "already-synced@example.com",
        role: "client",
        status: "active",
        stripeCustomerId: "cus_existing_123",
      });
    });

    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-backfill@example.com",
    });

    const backfillMutation = (api.users as any).backfillMissingStripeCustomers;
    const dryRunResult = await asAdmin.mutation(backfillMutation, {
      dryRun: true,
      limit: 10,
    });
    expect(dryRunResult).toMatchObject({
      scanned: 5,
      eligible: 2,
      scheduled: 0,
      dryRun: true,
    });

    const backfillResult = await asAdmin.mutation(backfillMutation, {
      dryRun: false,
      limit: 1,
    });
    expect(backfillResult).toMatchObject({
      eligible: 2,
      scheduled: 1,
      dryRun: false,
    });

    const userA = await t.run(async (ctx) => ctx.db.get(activeClientA));
    const userB = await t.run(async (ctx) => ctx.db.get(activeClientB));
    // Backfill schedules async work; IDs are not patched synchronously in this mutation.
    expect(userA?.stripeCustomerId).toBeUndefined();
    expect(userB?.stripeCustomerId).toBeUndefined();
  });

  test("createUserWithAppointment rejects when setup is incomplete", async () => {
    const t = convexTest(schema, modules);

    const serviceId = await t.run(async (ctx) => {
      return await ctx.db.insert("services", {
        name: "Exterior Detail",
        description: "Service",
        basePrice: 95,
        basePriceMedium: 95,
        duration: 60,
        serviceType: "standard",
        isActive: true,
      });
    });

    await expectConvexErrorCode(
      t.mutation(api.users.createUserWithAppointment, {
        name: "New Customer",
        email: "new-customer@example.com",
        phone: "555-2000",
        address: {
          street: "123 Main St",
          city: "Springfield",
          state: "IL",
          zip: "62701",
        },
        vehicles: [
          {
            year: 2021,
            make: "Toyota",
            model: "Camry",
            size: "medium",
            color: "Gray",
          },
        ],
        serviceIds: [serviceId],
        scheduledDate: BOOKING_TEST_DATE,
        scheduledTime: "10:00",
      }),
      "BOOKING_SETUP_INCOMPLETE",
    );
  });

  test("createUserWithAppointment rejects when selected service is missing pricing", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t);

    // Keep setup readiness true with one valid standard service.
    await t.run(async (ctx) => {
      await ctx.db.insert("services", {
        name: "Baseline Service",
        description: "Ready service",
        basePrice: 70,
        basePriceMedium: 70,
        duration: 60,
        serviceType: "standard",
        isActive: true,
      });
    });

    const invalidServiceId = await t.run(async (ctx) => {
      return await ctx.db.insert("services", {
        name: "Broken Service",
        description: "Zero-price service",
        basePrice: 0,
        basePriceSmall: 0,
        basePriceMedium: 0,
        basePriceLarge: 0,
        duration: 60,
        serviceType: "standard",
        isActive: true,
      });
    });

    await expectConvexErrorCode(
      t.mutation(api.users.createUserWithAppointment, {
        name: "Pricing Failure",
        email: "pricing-failure@example.com",
        phone: "555-2001",
        address: {
          street: "321 Main St",
          city: "Springfield",
          state: "IL",
          zip: "62701",
        },
        vehicles: [
          {
            year: 2022,
            make: "Honda",
            model: "Accord",
            size: "medium",
            color: "Blue",
          },
        ],
        serviceIds: [invalidServiceId],
        scheduledDate: BOOKING_TEST_DATE,
        scheduledTime: "10:00",
      }),
      "SERVICE_NOT_BOOKABLE",
    );
  });

  test("createUserWithAppointment rejects when selected slot is unavailable", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t);

    const blockingUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Blocking User",
        email: "blocking-user@example.com",
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
      });
    });
    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-slot-block@example.com",
        role: "admin",
      });
    });

    const serviceId = await t.run(async (ctx) => {
      return await ctx.db.insert("services", {
        name: "Interior Detail",
        description: "Service",
        basePrice: 110,
        basePriceMedium: 110,
        duration: 60,
        serviceType: "standard",
        isActive: true,
      });
    });

    const blockingVehicleId = await t.run(async (ctx) => {
      return await ctx.db.insert("vehicles", {
        userId: blockingUserId,
        year: 2020,
        make: "Ford",
        model: "Escape",
        size: "medium",
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        userId: blockingUserId,
        vehicleIds: [blockingVehicleId],
        serviceIds: [serviceId],
        scheduledDate: BOOKING_TEST_DATE,
        scheduledTime: "10:00",
        duration: 60,
        location: {
          street: "100 Blocked St",
          city: "Springfield",
          state: "IL",
          zip: "62701",
        },
        status: "confirmed",
        totalPrice: 110,
        createdBy: adminId,
      });
    });

    await expectConvexErrorCode(
      t.mutation(api.users.createUserWithAppointment, {
        name: "Blocked Slot",
        email: "blocked-slot@example.com",
        phone: "555-2002",
        address: {
          street: "555 Main St",
          city: "Springfield",
          state: "IL",
          zip: "62701",
        },
        vehicles: [
          {
            year: 2024,
            make: "Chevrolet",
            model: "Tahoe",
            size: "medium",
            color: "Black",
          },
        ],
        serviceIds: [serviceId],
        scheduledDate: BOOKING_TEST_DATE,
        scheduledTime: "11:00", // overlaps with 10:00 start + 2-hour policy
      }),
      "TIME_SLOT_UNAVAILABLE",
    );
  });

  test("createUserWithAppointment correctly calculates duration and price with pet fees", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, {
      includeBookableService: false,
      includeDepositSettings: true,
    });

    const serviceId = await t.run(async (ctx) => {
      await ctx.db.insert("petFeeSettings", {
        basePriceSmall: 25,
        basePriceMedium: 50,
        basePriceLarge: 75,
        timeAddMinutes: 30,
        isActive: true,
      });
      return await ctx.db.insert("services", {
        name: "Marketing Pet Detail",
        description: "Detail with pet fee",
        basePrice: 100,
        basePriceSmall: 100,
        basePriceMedium: 100,
        basePriceLarge: 100,
        duration: 120,
        serviceType: "standard",
        isActive: true,
      });
    });

    const result = await t.mutation(api.users.createUserWithAppointment, {
      name: "Pet Owner",
      email: "pet@example.com",
      phone: "555-0000",
      address: {
        street: "123 Pet Lane",
        city: "Springfield",
        state: "IL",
        zip: "62701",
      },
      vehicles: [
        {
          year: 2022,
          make: "Honda",
          model: "CR-V",
          size: "medium",
          hasPet: true,
        },
      ],
      serviceIds: [serviceId],
      scheduledDate: BOOKING_TEST_DATE,
      scheduledTime: "14:00",
    });

    const appointment = await t.run(async (ctx) => ctx.db.get(result.appointmentId));
    const invoice = await t.run(async (ctx) => ctx.db.get(result.invoiceId));

    // Duration: 120 (service) + 30 (pet) = 150
    expect(appointment?.duration).toBe(150);
    // Price: 100 (service) + 50 (medium pet fee) = 150
    expect(appointment?.totalPrice).toBe(150);
    expect(appointment?.petFeeVehicleIds).toHaveLength(1);

    expect(invoice?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemType: "service",
          serviceName: "Marketing Pet Detail",
          totalPrice: 100,
        }),
        expect.objectContaining({
          itemType: "pet_fee",
          serviceName: "Pet fee - Medium vehicle",
          totalPrice: 50,
        }),
      ]),
    );
    expect(invoice?.dueDate).toBe("2024-12-05");
  });
});
