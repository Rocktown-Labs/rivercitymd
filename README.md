# River City Mobile Detailing

<div align="center">
  <h3>Mobile vehicle detailing, booked around the customer</h3>
  <p>A shared web, mobile, and real-time backend for service discovery, appointment booking, vehicle care, payments, and day-to-day business operations.</p>
</div>

[rivercitymd.com](https://rivercitymd.com)

---

## 1. Product Overview

**River City Mobile Detailing** brings professional detailing to a customer's location. The application supports the customer journey from choosing a service and adding vehicle details through booking, payment, appointment tracking, and post-service feedback. Business staff use a separate admin workspace to manage the service catalog, schedule, customers, payments, and operating settings.

The service catalog includes Quick Clean, Full Detail, Interior Detail, Paint Correction, Ceramic Coating, and subscription plans. Pricing can account for vehicle size, and the booking flow is built around mobile service appointments rather than shop drop-offs.

## 2. Applications & Architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | Next.js customer website, booking, account dashboard, and admin console |
| `apps/native` | Expo / React Native mobile application for customer and business workflows |
| `packages/backend` | Shared Convex schema, queries, mutations, actions, and scheduled work |
| `packages/config` | Shared TypeScript configuration |
| `packages/env` | Validated web and native environment configuration |

The web and native clients use the same typed Convex backend. Clerk provides account authentication, Convex handles application data and real-time updates, and Stripe supports payment flows. This shared backend keeps appointments, vehicles, invoices, reviews, and business configuration consistent across clients.

### Technology

| Layer | Technologies |
| --- | --- |
| Web | Next.js 16, React, TypeScript, Tailwind CSS, shadcn/ui |
| Mobile | Expo, React Native, Expo Router, React Native Reusables |
| Backend | Convex real-time database and server functions |
| Authentication | Clerk with role-aware customer and admin access |
| Payments | Stripe |
| Workspace | pnpm, Turborepo |

## 3. Product Capabilities

### Customer experience

- Browse detailing services, descriptions, pricing, and subscription options.
- Book a mobile service appointment for a selected vehicle and location.
- Save multiple vehicles with year, make, model, plate, and notes.
- Review upcoming and past appointments, invoices, and payment records.
- Manage profile details, subscriptions, gift cards, and service reviews.
- Follow appointment status and review service updates. The backend includes chat endpoints, but the web and native apps do not currently expose a customer chat screen.

### Business operations

- Review, confirm, reschedule, and complete appointments.
- Manage customer profiles and service history.
- Maintain the service catalog, vehicle-size pricing, gift cards, and subscriptions. Coupon discounts are managed through Stripe rather than a Convex coupon table.
- Track invoices, payments, reviews, appointment activity, and business analytics.
- Configure operating hours, availability, blocked time slots, notifications, and business information.
- Review out-of-area requests and business activity logs.

## 4. Data Model

Convex stores the application records used by the web and mobile experiences:

- **Users and business information** for customer identity, roles, and company settings.
- **Vehicles and services** for customer vehicles, the service catalog, and pricing.
- **Appointments and availability** for booking requests, calendar slots, and service status.
- **Invoices, payments, subscriptions, and gift cards** for billing and promotions.
- **Reviews** for customer feedback. Chat query and send endpoints exist in the backend, but are not currently connected to a shipped web or native interface.

Convex file storage is used for business and customer imagery. Clerk identity is synchronized with the backend so protected operations can apply the right customer or admin permissions.

## 5. Local Development

### Prerequisites

- Node.js 22.13 or newer
- pnpm 11 or newer
- A Convex deployment for backend development
- Xcode or Android Studio for native builds (optional)

Install dependencies from the repository root:

```bash
pnpm install
```

Configure the web app from its example environment:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Set the Clerk and Convex public configuration in the web and native app environments. For native development on a physical device, use a reachable development host for the Convex URL rather than `localhost`.

Start the backend and web application in separate terminals:

```bash
pnpm dev:backend
pnpm dev:web
```

For the Expo app, copy `apps/native/.env.example` to `apps/native/.env`, configure its public Clerk and Convex values, and run:

```bash
pnpm dev:native
pnpm --filter native ios
# or
pnpm --filter native android
```


### Authentication, environment, and webhooks

Clerk handles sign-in and synchronizes users with Convex. Configure the following values in the indicated deployment or local environment; obtain credentials from the relevant provider dashboard and keep secrets out of source control.

| Environment | Variables | Purpose |
| --- | --- | --- |
| Convex | `CONVEX_SITE_URL`, `STRIPE_SECRET_KEY` | Convex site URL and server-side Stripe operations |
| Web | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `NEXT_PUBLIC_CONVEX_URL` | Canonical site metadata, Clerk sign-in and user sync, and Convex client access |
| Native | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CONVEX_URL` | Clerk sign-in and Convex access; use the computer's LAN IP for physical-device development, not `localhost` |

The Clerk native sign-in UI uses `AuthView` from `@clerk/expo/native`, which requires `expo-dev-client` and an iOS or Android development build; it does not run in Expo Go. Enable Clerk's Native API and register the app's bundle ID or package name in the Clerk Dashboard.

Configure these production webhook endpoints:

- Stripe: `/stripe/webhook`
- Clerk: `/clerk-users-webhook`
- Resend: `/resend-webhook`

Subscribe the Stripe endpoint to `checkout.session.completed`, `customer.created`, `customer.updated`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `payment_intent.succeeded`, and `payment_intent.payment_failed`. Subscribe the Clerk endpoint to `user.created`, `user.updated`, and `user.deleted`.

## 6. Workspace Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start workspace development tasks |
| `pnpm dev:web` | Start the web app |
| `pnpm dev:native` | Start the Expo app |
| `pnpm dev:backend` | Start the Convex backend |
| `pnpm build` | Build configured workspaces |
| `pnpm check` | Run workspace lint tasks |
| `pnpm typecheck` | Type-check configured workspaces |
| `pnpm test` | Run configured tests |

## 7. Repository Layout

```text
rivercitymd/
├── apps/
│   ├── web/                 # Next.js website, customer portal, and admin console
│   └── native/              # Expo / React Native application
├── packages/
│   ├── backend/             # Convex functions, schema, and generated API
│   ├── config/              # Shared TypeScript configuration
│   └── env/                 # Web and native environment validation
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 8. Quality Checks

Before proposing code changes, run the relevant repository checks:

```bash
pnpm check
pnpm typecheck
pnpm test
```

For a production build, run `pnpm build`. Environment files contain local credentials and must not be committed.

## Contributing and License

Follow the guidance in [AGENTS.md](AGENTS.md), and run the relevant checks before submitting changes. This private project is proprietary to River City Mobile Detailing.

<div align="center">
  <sub>Built for convenient, on-location vehicle care in Central Arkansas.</sub>
</div>
