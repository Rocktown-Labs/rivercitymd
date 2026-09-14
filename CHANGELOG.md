# Changelog

All notable changes to the River City Mobile Detailing project are documented in this file, structured by releases and version numbers derived from the repository's git commit history.

## [v1.2.7] - 2026-09-14
### Changed
- **Homepage Services Section**: Updated the "Professional services for every need" section to reflect the latest 6-service offerings layout: Maintenance, Signature, Deep Reset, Interior Reset, Decon + Protect, and 18 mo Ceramic, with updated checkmark features and top-aligned check icons.

## [v1.2.6] - 2026-09-02
### Fixed
- **Convex Production Deployment**: Run the backend package's Convex production deployment from the monorepo Vercel build before publishing the web app.
- **Service Presentation Repair**: Seed missing service categories and correct legacy ceramic packages to optional upgrade booking roles with a dry-run-first admin mutation.

## [v1.2.5] - 2026-09-02
### Fixed
- **Landing Pricing Category Fallbacks**: Keep valid uncategorized Full Detail products on the homepage and classify decontamination/protection packages under Exterior when explicit category records are unavailable.

## [v1.2.4] - 2026-08-31
### Added
- **Profile Portal Navigation**: Moved invoices and subscriptions under the Profile route with shared back navigation and Profile, Invoices, and Plans tabs.
- **Admin View Switching**: Added an admin-only switch between the mobile Admin Portal and Customer Portal views for the `cg@rocktownlabs.com` test account when its Convex role is `admin`.

### Fixed
- **Native Portal Routing**: Added nested Profile routes and removed dead root-level portal pages so customer portal destinations resolve as real navigable screens.

## [v1.2.3] - 2026-08-31
### Fixed
- **Expo Web Browser Compatibility**: Lazily load `expo-web-browser` and fall back to React Native `Linking` so existing development clients without the newly added native module no longer crash at route discovery.

## [v1.2.2] - 2026-08-31
### Added
- **Native Stripe Checkout Return & Customer Portal**: Return authenticated mobile customers to a booking confirmation route, reconcile paid Checkout Sessions to their existing account, display appointment IDs/status badges, and expose appointment, invoice, balance-payment, and subscription management links.

### Fixed
- **Native Booking Visibility**: Refresh and classify pending/rescheduled appointments consistently with the web portal, while guarding checkout confirmation and preventing unpaid delayed-payment sessions from being fulfilled.
- **Stripe Test Mock URL Validation**: Restrict Stripe test interception to the exact `api.stripe.com` hostname.

## [v1.2.1] - 2026-08-30
### Added
- **Native In-App Accordion Booking Flow (`apps/native/app/book.tsx`)**: Replaced external browser reliance with a complete native 4-step wizard:
  - Step 1: Radar-backed address search with Arkansas service territory verification and live travel fee calculation.
  - Step 2: Live availability schedule and duration-aware time slot picker (`TimeSlotPicker`).
  - Step 3: Saved garage vehicle selector + NHTSA vehicle lookup with vehicle condition toggles (Pet Hair Extraction +$40, Heavy Soil / Mud).
  - Step 4: Per-vehicle collapsible accordion for detailing packages (Full Detail, Interior, Exterior) with live vehicle-type pricing, wax & ceramic upgrades, and add-on enhancements.
  - Review & Checkout: Summary breakdown with 3 payment methods (Pay Deposit Now via Stripe with post-service invoice, Pay Full Price Upfront via Stripe, or Pay Remaining Balance in Person).
- **Vehicle & Appointment Detail ID Pages**: Added `apps/native/app/vehicles/[id].tsx` and `apps/native/app/appointments/[id].tsx` with vehicle service histories, Stripe hosted invoice access, in-app reschedule modal, and cancellation.

### Fixed
- **Navigation Context Render Error**: Unified route structure in `apps/native/app/_layout.tsx` into a single root `<Stack>` tree observed by `AuthGuard`, eliminating conditional stack rendering errors on booking modals.
- **Brand Consistency**: Styled all company name references as `RiverCityMD`.

## [v1.2.0] - 2026-08-30
### Added
- **Mobile Customer Onboarding**: Added a 2-step native onboarding flow (`app/(onboarding)/index.tsx`) collecting user contact info, phone number with formatting, service address with Arkansas service area validation, and multi-vehicle garage entries with NHTSA/VPIC vehicle search and auto-classification.
- **Mobile Multi-Step Booking Wizard**: Added a 4-step streamlined booking wizard (`app/book.tsx`) that pre-loads onboarding data (saved address and garage vehicles), supports adding ad-hoc vehicles, calculates real-time travel fees, verifies duration-aware time slot availability, supports per-vehicle service package selection (required base package, add-ons, subscriptions), calculates pet fees, and creates Stripe online checkout or in-person bookings.
- **Mobile Admin Experience**: Added complete mobile admin portal navigation and screens mirroring the web admin portal:
  - Overview dashboard (`(admin)/index.tsx`) with monthly KPIs (revenue, appointments, active customers, deposits), upcoming schedule, and pending trip log alerts.
  - Appointments management (`(admin)/appointments.tsx`) with status filters (Pending, Confirmed, In Progress, Completed, Cancelled), customer search, contact shortcuts (Call, SMS), and quick status update actions.
  - Customers directory (`(admin)/customers.tsx`) with customer search, contact shortcuts, garage vehicles, lifetime visits, and total spent.
  - Services management (`(admin)/services.tsx`) with category tabs, size-based pricing breakdown (Small, Medium, Large), and online availability toggles.
  - Financials & Invoices (`(admin)/payments.tsx`) with invoice search and payment statuses.
  - Out-of-Area request review (`(admin)/out-of-area.tsx`) with customer details and status approval actions.
  - Customer reviews (`(admin)/reviews.tsx`) with star rating visualization and testimonials.
  - Fleet trip logs (`(admin)/logs.tsx`) with mileage and fuel expense tracking.
  - Business settings (`(admin)/settings.tsx`) showing deposit rates, pet fee tiers, travel fee origin hub, and business info.
- **Shared Mobile UI Components**: Added native Input, Badge, Switch, Modal, VehicleLookup, AddressSearch, and TimeSlotPicker primitives built on Tailwind / NativeWind.
- **Role-Based Auth & Onboarding Routing**: Configured root navigation (`app/_layout.tsx`) to route admins to the Admin portal, incomplete customer profiles to Onboarding, and complete customer profiles to the Customer Portal.

### Changed
- **Customer Portal Features**: Enhanced Customer Overview with instant "Book Detail Now" CTA, added vehicle addition modal with VPIC search to Garage (`(tabs)/vehicles.tsx`), added upcoming/past tabs with live rescheduling to Appointments (`(tabs)/appointments.tsx`), and added SMS notification preference toggles to Profile (`(tabs)/profile.tsx`).

## [v1.1.2] - 2026-08-28
### Added
- **Mobile App Foundation**: Added a pnpm/Turborepo workspace with an Expo native-bare app, shared Convex backend package, shared environment package, and React Native Reusables configuration.
- **Customer Mobile Shell**: Added native Overview, Appointments, Vehicles, Reviews, and Profile tabs backed by the existing Convex API.
- **Native Clerk Authentication**: Added Clerk Expo provider/token caching and Clerk's native `AuthView` sign-in/sign-up flows.

### Fixed
- **Customer Mobile Navigation**: Corrected the web dashboard's primary mobile tab to link to `/dashboard/appointments` and use the same label as the native app.
- **CI Workspace Setup**: Updated the test workflow to use pnpm 11, Node.js 22.13+, and the new Turborepo quality-gate scripts.
- **Vercel Monorepo Build**: Configured Vercel to detect the Next.js web package and run its workspace build from the repository root, including the root framework marker required by the existing project configuration.

### Changed
- **Web App Package**: Moved the existing Next.js application into `apps/web` while preserving its routes, components, tests, and Convex integrations.
- **Backend Package**: Moved Convex functions and generated types into `packages/backend` for web and native reuse.

## [v1.1.1] - 2026-08-14
### Fixed
- **Multi-Vehicle Appointment Edit Duration & Availability**: Fixed `appointments.update`, `create`, `previewWorkAdjustment`, and `applyWorkAdjustment` in `convex/appointments.ts` to pass per-vehicle service mappings (`vehicleServices`) to `buildVehicleServiceItems` and `buildAdjustmentPricing`. This prevents service duplication across vehicles (e.g. 290 minutes doubling to 580 minutes) that triggered false "Outside business hours" / `TIME_SLOT_UNAVAILABLE` errors when updating services on multi-vehicle appointments.
- **Single and Multi-Vehicle Service Retention**: Refined `buildUpdatedVehicleServices` to correctly assign all services for single-vehicle updates while preserving individualized service allocations for multi-vehicle appointments.

### Added
- **Modernized Service Selection Dialog & UX**: Revamped appointment service editing in `components/admin/appointment-detail-client.tsx`. Replaced lengthy 25+ service lists with a focused per-vehicle "Manage Services" dialog featuring instant search filtering, category tabs (All, Standard Packages, Add-ons), individual checkboxes, and live price/duration summaries.
- **Transparent Duration & Timing Breakdown**: Added a schedule and duration breakdown card to the appointment edit and view views showing services duration (e.g. 290 min), pet fee time, travel buffer (e.g. 15 min for 6.2 miles), and total blocked booking window (e.g. 305 min), making time calculations explicit and transparent to administrators.
- **Per-Vehicle Service Chips**: Each selected vehicle card now displays its chosen services with compact category badges, duration indicators, vehicle-specific prices, and quick 1-click removal buttons.

---

## [v1.1.0] - 2026-08-10
### Added
- **Per-Vehicle Service Accordion in Admin Edit**: Added a mobile-friendly per-vehicle service accordion selector to `components/admin/appointment-detail-client.tsx`. Admins editing single or multi-vehicle appointments can now expand an accordion under each vehicle to toggle and individualize services scoped specifically to that vehicle's size and type.

---

## [v1.0.9] - 2026-08-10
### Fixed
- **Invoice Discount Preservation on Edit**: Updated `appointments.update` and `appointments.applyWorkAdjustment` in `convex/appointments.ts` to compute invoice totals via `getInvoiceTotalAfterDiscount`. This ensures existing coupon discounts (e.g. 20% biweekly client discounts) are preserved and subtracted when admins edit appointment details, add pet hair fees, or update travel distance.

---

## [v1.0.8] - 2026-08-10
### Fixed
- **Client Error Toast Handling**: Added `getErrorMessage` helper to extract structured error payloads (`error.data.message` or `error.data`) from Convex `ConvexError` instances, preventing generic `"Server Error Called by client"` internal wrapper messages from displaying on client error toasts.
- **Per-Vehicle Service Pricing on Edit**: Updated `buildVehicleServiceItems` in `convex/appointments.ts` to respect `vehicleServices` mapping, isolating per-vehicle pricing and preventing cross-vehicle availability errors during appointment updates.

---

## [v1.0.7] - 2026-08-10
### Fixed
- **Multi-Vehicle Scheduling Duration**: Fixed `getSchedulingDurationInternal` draft duration calculation so service durations are evaluated per vehicle instead of applying all draft service durations to every vehicle. This resolves false "Outside business hours" errors when checking out multi-vehicle bookings.
- **Checkout Slot Availability Error Handling**: Updated `createCheckoutSessionForDraft` to throw structured `ConvexError` instead of generic `Error` on slot availability failure, enabling clean customer error messages on booking checkout.

---

## [v1.0.6] - 2026-07-18
### Changed
- **Invoice Due Dates**: Shortened default remaining-balance invoice due dates from 30 days to 3 days for booked, admin-created, supplemental, and legacy Stripe invoice creation flows.
- **Service Copy**: Renamed the landing page "Quick Clean" service label to "Express Detail".

---

## [v1.0.5] - 2026-07-18
### Added
- **Booking Checkout Promo Codes**: Added a promo code input to the booking checkout order summary with live red/green validation feedback. Codes resolve against Stripe promotion codes first, then coupon IDs, enforcing usage rules (active status, expiration, redemption caps, minimum order value). Full-payment checkouts apply the coupon via Stripe `discounts`; deposit bookings apply the discount to the remaining balance invoice.
- **Discounts on Active Appointments**: Admins can now apply, replace, or remove coupons on pending, confirmed, and in-progress appointments whenever the invoice still has a collectible balance — including invoices marked paid with a remaining balance (e.g. after manual mark-paid). Applying re-opens the invoice and reissues the Stripe invoice for the reduced balance.

### Fixed
- **Appointment Service Prices by Vehicle Type**: Appointment detail pricing now reflects per-vehicle-type service pricing.
- **Mobile Appointment Actions**: The appointment detail page CTAs now stack below the back button on mobile instead of crowding the same row.

---

## [v1.0.4] - 2026-06-18
### Added
- **Editable Customer Vehicles (Admin)**: Expanded the admin Customer Detail page to allow inline editing of customer vehicles (Year, Make, Model, Color, License Plate, Notes). This triggers auto-classification on save to update sizes and types without needing deletion.
- **Service Descriptions at Checkout (Dashboard)**: Made services in the customer dashboard appointment booking summary clickable, revealing a Dialog containing complete service descriptions, matching the public booking flow behavior.

### Fixed
- **Active Appointment Service Edits**: Allowed admins to add services to already-started pending appointments without rebooking the active time slot.
- **In-Progress Work Adjustments**: Allowed admins to add or remove services on in-progress appointments without failing availability checks for the already-started time slot.
- **Service Deletion Guidance**: Added a clear hide path for services with appointment history so admins can remove them from new bookings without breaking existing appointment records.
- **HEIC Image Upload Fallbacks**: Fixed HEIC/HEIF photo uploads being rejected with a "client error" when browser MIME types fallback to `application/octet-stream`. Falls back to parsing filename extensions and maps them to `image/heic`/`image/heif` or relaxes backend verification to match.
- **Editable Vehicle Mutation**: Expanded `updateVehicle` mutation in `convex/vehicles.ts` to accept optional `year`, `make`, `model`, and `classification` arguments to support fully updating vehicle profiles rather than forcing delete/recreate.

---

## [v1.0.3] - 2026-06-16
### Added
- **Multi-Vehicle Customer Management**: Added a dialog/form to the admin Customer Detail page to register new vehicles directly to a customer's profile.
- **Inline Vehicle Creation in Edit Appointment**: Added a sub-form to add new vehicles directly when editing an appointment, automatically selecting the newly created vehicle for the appointment and updating the pricing breakdown.

---

## [v1.0.2] - 2026-06-15
### Fixed
- **Relay Upload CORS**: Configured the `/api/r2-upload-relay` route as a public route in Clerk middleware (`proxy.ts`). This resolves the CORS issue when unauthenticated guest users try to upload booking photos.

---

## [v1.0.1] - 2026-06-15
### Added
- **R2 Upload Relay Route**: Added `/api/r2-upload-relay` to relay photo uploads to R2 to avoid client CORS/connection errors.
- **UTV/Side-by-side Classification**: Implemented classification rule for UTV/side-by-side vehicle models (e.g., Can-Am Defender, Maverick) and added unit tests.

### Fixed
- **Upload Failover**: Configured `VehicleLookupCard` to fall back to the relay upload route if direct signed URL upload fails.
- **Booking Flow State Cleanup**: Fully reset forms (including active services, expanded index settings) and cleared local storage keys (`booking-storage`, `selectedAddress`, `appointmentFormData`) when resetting/cancelling the booking flow.

---

## [v1.0.0] - 2026-06-13
### Added
- **Coupon Dashboard**: Built a coupons administration panel (`/admin/coupons`) with stats summaries (total coupons, active coupons, and total redemptions) and a dialog to create/delete coupons on Stripe.
- **On-the-Fly Coupon Creation**: Added a "Quick Discount" selector in Invoice/Appointment details, supporting automatic creation of Stripe coupons on application if they don't exist.
- **Navigation Integration**: Linked the Coupons dashboard in both desktop and mobile sidebars (using Lucide's ticket icon).
- **Contiguous Travel Sliders**: Integrated interactive double-thumb range sliders directly inside Tier 1 and Tier 2 travel fee cards.
- **Smart Range Validation**: Added real-time contiguous validation checks inside travel rules to prevent saving if gaps or overlaps exist between tiers.
- **Appointments Pricing Sync**: Updated appointments list view to show invoice-specific discounted totals and render cancelled appointments as `$0.00` in red alongside crossed-out original prices.
- **Test Coverage**: Added comprehensive integration test suites for coupon voiding, reissuing, and db updates.

---

## [v0.8.0] - 2026-05-15 to 2026-06-12
### Added
- **In-Progress Adjustments**: Supported adjusting services, vehicles, and prices on appointments already marked "in-progress" before invoicing.
- **Booking Photo Previews**: Surfaced vehicle "before" photos and counts directly inside the admin appointment list rows.
- **Trip Log Automation**: Added automated backfills of required trip logs for completed appointments.
- **Isolated Service Editing**: Moved service editing panels to dedicated sub-routes instead of inline modals.

---

## [v0.7.0] - 2026-04-10 to 2026-05-14
### Added
- **Configurable Travel Origin**: Allowed admins to change coordinates and starting addresses for travel calculations.
- **Configurable Travel Rates**: Enabled per-mile rate configuration fields for travel pricing.
- **Travel Buffers**: Added travel buffer times dynamically for long-distance bookings.
- **Out-of-Area Workflow**: Built review workflows and deposit detail reviews for booking drafts outside the service radius.

---

## [v0.6.0] - 2026-03-01 to 2026-04-09
### Added
- **Booking Flow Relocation**: Moved scheduling flow to a clean, public `/book` route.
- **Clerk Public Routes**: Configured middleware to allow unauthenticated access to the booking funnel.
- **Accordion Selection**: Redesigned the vehicles and services selection step into collapsible accordions.
- **Vehicle Suggestion Cleanup**: Removed redundant EPA/NHTSA classification tags from vehicle search suggestions.

---

## [v0.5.0] - 2026-01-24 to 2026-02-28
### Added
- **Vehicle-Size Pricing**: Implemented SUV/Truck/Car pricing tiers for detailing packages and add-ons.
- **Vehicle Filtering**: Filtered available booking products based on selected vehicle types.
- **UI Polish**: Clamped service description lengths in admin lists and resolved duration sync issues.

---

## [v0.4.0] - 2026-01-01 to 2026-01-23
### Added
- **Clerk Auth Migration**: Migrated from custom `@convex-dev/auth` schema to Clerk authentication.
- **Clerk Onboarding**: Set up onboarding redirect layouts and mapped user role permissions to Clerk `publicMetadata`.
- **Role Assignment**: Created organization-based role checking middleware to redirect authenticated users.
- **Webhook Sync**: Added Clerk webhook handlers to create, update, and delete corresponding Convex user records.

---

## [v0.3.0] - 2025-12-08 to 2025-12-31
### Added
- **Radar address autocomplete**: Integrated Radar SDK address selection inside booking modals.
- **Post-Deposit Stripe Invoices**: Automated Stripe invoice creation after deposit payment completes.
- **Integration Test Setup**: Added compatibility mocks for Response objects and fetch endpoints in vitest suites.
- **Unified Address Fields**: Standardized address forms across customer dashboard.

---

## [v0.2.0] - 2025-11-07 to 2025-12-07
### Added
- **Resend Email Integration**: Configured Resend email infrastructure for customer confirmations.
- **Email Testing**: Created localhost mock email delivery tools.
- **Time Slot Blocking**: Implemented 2-hour slot blocking rules for 90-minute services.
- **Business Hours Setup**: Created admin configuration pages for business availability settings.

---

## [v0.1.0] - 2025-10-09 to 2025-11-06
### Added
- **Platform Base**: Initial repository setup and Convex table structures.
- **Booking Funnel**: Developed multi-step booking forms (replacing external cal.com embedding).
- **Stripe Mappings**: Mapped user sign-ups to Stripe customer registration profiles.
- **Admin CRUD**: Built initial user and service management views.
