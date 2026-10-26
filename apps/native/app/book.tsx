import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Doc, Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  CreditCard,
  Dog,
  Info,
  MapPin,
  Palette,
  Plus,
  Shield,
  Sparkles,
  Sun,
  Sunrise,
  Trash2,
  User,
  X,
} from "lucide-react-native";

import { BrandMark } from "@/components/brand-mark";
import { Screen, ScreenHeader } from "@/components/screen";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import {
  AddressSearch,
  type AddressValue,
  type TravelQuoteValue,
} from "@/components/forms/address-search";
import { VehicleLookup, type VehicleLookupValue } from "@/components/forms/vehicle-lookup";
import { TimeSlotPicker } from "@/components/forms/time-slot-picker";
import { THEME } from "@/lib/theme";
import { openAuthSession } from "@/lib/browser";

import {
  getEffectiveServicePricingForVehicle,
  getServiceBookingRole,
  inferServiceCategorySlug,
  isServiceAllowedForCondition,
  isServiceAvailableForVehicle,
  normalizeServiceType,
  type VehicleSize,
} from "@rivercitymd/backend/convex/lib/pricing";

const PACKAGE_CATEGORY_ORDER = ["full-detail", "interior", "exterior"] as const;
const PACKAGE_CATEGORY_LABELS: Record<(typeof PACKAGE_CATEGORY_ORDER)[number], string> = {
  "full-detail": "Full Detail Packages",
  interior: "Interior Only Packages",
  exterior: "Exterior Only Packages",
};

const ADDON_CATEGORY_ORDER = ["interior", "exterior"] as const;
const ADDON_CATEGORY_LABELS: Record<(typeof ADDON_CATEGORY_ORDER)[number], string> = {
  interior: "Interior Add-ons",
  exterior: "Exterior Add-ons",
};

function getPackageCategorySlug(service: any): (typeof PACKAGE_CATEGORY_ORDER)[number] {
  const slug = service.categorySlug || inferServiceCategorySlug(service);
  if (slug === "full-detail" || slug === "interior" || slug === "exterior") {
    return slug;
  }
  return "full-detail";
}

function getAddonCategorySlug(service: any): (typeof ADDON_CATEGORY_ORDER)[number] {
  const slug = service.categorySlug || inferServiceCategorySlug(service);
  return slug === "interior" ? "interior" : "exterior";
}

function formatTime12h(timeStr: string) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hourNum = parseInt(h, 10);
  if (isNaN(hourNum)) return timeStr;
  const ampm = hourNum >= 12 ? "PM" : "AM";
  const hour12 = hourNum % 12 || 12;
  return `${hour12}:${m || "00"} ${ampm}`;
}

interface VehicleSelection {
  key: string;
  existingId?: Id<"vehicles">;
  label: string;
  vehicleTypeId?: Id<"vehicleTypes">;
  vehicleTypeName?: string;
  size: "small" | "medium" | "large";
  hasPet: boolean;
  hasHeavySoil: boolean;
  details?: VehicleLookupValue;
}

export default function BookScreen() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const myVehicles = useQuery(
    api.vehicles.getByUser,
    currentUser ? { userId: currentUser._id } : "skip",
  );
  const allServices = useQuery(api.services.list);
  const depositSettings = useQuery(api.depositSettings.get);
  const petFeeSettings = useQuery(api.petFeeSettings.get);

  const createOrUpdateDraft = useAction(api.bookingDrafts.createOrUpdate);
  const createBookingCheckout = useAction(api.payments.createBookingCheckout);
  const confirmBookingCheckout = useAction(api.payments.confirmBookingCheckout);
  const validateBookingPromoCode = useAction(
    api.payments.validateBookingPromoCode,
  );

  const [step, setStep] = React.useState<1 | 2 | 3 | 4 | 5>(1);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Step 1: Location & Travel
  const [address, setAddress] = React.useState<AddressValue>({
    street: currentUser?.address?.street || "",
    city: currentUser?.address?.city || "",
    state: currentUser?.address?.state || "AR",
    zip: currentUser?.address?.zip || "",
  });
  const [travelQuote, setTravelQuote] = React.useState<TravelQuoteValue | null>(null);

  // Step 2: Date & Time
  const [scheduledDate, setScheduledDate] = React.useState<string>("");
  const [scheduledTime, setScheduledTime] = React.useState<string>("");

  // Step 3: Vehicles & Condition
  const [selectedVehicles, setSelectedVehicles] = React.useState<VehicleSelection[]>([]);
  const [adHocVehicles, setAdHocVehicles] = React.useState<
    Array<VehicleLookupValue & { hasPet?: boolean; hasHeavySoil?: boolean }>
  >([]);

  // Dynamic Pet Fee helper from DB
  const getPetFeeForVehicle = React.useCallback(
    (size: "small" | "medium" | "large") => {
      if (petFeeSettings?.isActive === false) return 0;
      if (size === "small") return petFeeSettings?.basePriceSmall ?? petFeeSettings?.basePriceMedium ?? 40;
      if (size === "large") return petFeeSettings?.basePriceLarge ?? petFeeSettings?.basePriceMedium ?? 40;
      return petFeeSettings?.basePriceMedium ?? 40;
    },
    [petFeeSettings],
  );

  // Step 4: Services selected per vehicle: Record<vehicleKey, serviceId[]>
  const [vehicleServices, setVehicleServices] = React.useState<Record<string, string[]>>({});
  const [expandedServiceVehicle, setExpandedServiceVehicle] = React.useState<string>("");
  const [activeVehicleSection, setActiveVehicleSection] = React.useState<
    Record<string, "packages" | "upgrades" | "addons" | "">
  >({});
  // Track nested category accordion state: Record<`${vehicleKey}-pkg` | `${vehicleKey}-addon`, string>
  const [activeNestedCategory, setActiveNestedCategory] = React.useState<Record<string, string>>({});

  const [paymentOption, setPaymentOption] = React.useState<"deposit" | "full" | "in_person">("deposit");
  const [smsOptIn, setSmsOptIn] = React.useState(
    currentUser?.notificationPreferences?.operationalSmsConsent?.optedIn ?? false,
  );
  const [marketingEmails, setMarketingEmails] = React.useState(
    currentUser?.notificationPreferences?.marketingEmails ?? false,
  );
  const [promoCodeInput, setPromoCodeInput] = React.useState("");
  const [appliedCoupon, setAppliedCoupon] = React.useState<{
    code: string;
    discountType: "percent" | "amount";
    discountValue: number;
    discountAmount: number;
  } | null>(null);
  const [promoStatus, setPromoStatus] = React.useState<
    "idle" | "checking" | "valid" | "invalid"
  >("idle");
  const [promoError, setPromoError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const optedIn =
      currentUser?.notificationPreferences?.operationalSmsConsent?.optedIn;
    if (optedIn !== undefined) {
      setSmsOptIn(optedIn);
    }
  }, [currentUser?.notificationPreferences?.operationalSmsConsent?.optedIn]);

  React.useEffect(() => {
    const optedIn = currentUser?.notificationPreferences?.marketingEmails;
    if (optedIn !== undefined) {
      setMarketingEmails(optedIn);
    }
  }, [currentUser?.notificationPreferences?.marketingEmails]);

  const scrollRef = React.useRef<ScrollView>(null);

  // Auto-scroll to top whenever step changes
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  // Initialize selected vehicles when user profile / garage loads
  React.useEffect(() => {
    if (myVehicles && myVehicles.length > 0 && selectedVehicles.length === 0 && adHocVehicles.length === 0) {
      const initial: VehicleSelection = {
        key: `existing-${myVehicles[0]._id}`,
        existingId: myVehicles[0]._id,
        label: `${myVehicles[0].year} ${myVehicles[0].make} ${myVehicles[0].model}`,
        vehicleTypeId: myVehicles[0].vehicleTypeId,
        vehicleTypeName: myVehicles[0].vehicleType?.name,
        size: myVehicles[0].size || "medium",
        hasPet: false,
        hasHeavySoil: false,
      };
      setSelectedVehicles([initial]);
      setExpandedServiceVehicle(initial.key);
      setActiveVehicleSection({ [initial.key]: "packages" });
    }
  }, [myVehicles]);

  // Combine saved vehicles + ad-hoc vehicles into final target vehicle list
  const targetVehicles: VehicleSelection[] = React.useMemo(() => {
    const list: VehicleSelection[] = [...selectedVehicles];

    adHocVehicles.forEach((adhoc, idx) => {
      if (adhoc.year && adhoc.make && adhoc.model) {
        list.push({
          key: `adhoc-${idx}`,
          label: `${adhoc.year} ${adhoc.make} ${adhoc.model}`,
          vehicleTypeId: adhoc.vehicleTypeId as Id<"vehicleTypes"> | undefined,
          vehicleTypeName: adhoc.vehicleTypeName,
          size: adhoc.size || "medium",
          hasPet: Boolean(adhoc.hasPet),
          hasHeavySoil: Boolean(adhoc.hasHeavySoil),
          details: adhoc,
        });
      }
    });

    return list;
  }, [selectedVehicles, adHocVehicles]);

  const maintenancePlan = React.useMemo(() => {
    return (
      (allServices ?? []).find(
        (service) =>
          service.isActive &&
          service.serviceType === "subscription" &&
          (service.includedServiceIds?.length ?? 0) > 0 &&
          (service.subscriptionFrequencies?.length ?? 0) > 0,
      ) ?? null
    );
  }, [allServices]);
  const maintenancePlanIncludedServiceIds =
    maintenancePlan?.includedServiceIds ?? [];
  const maintenanceIncludedServiceNames = maintenancePlanIncludedServiceIds
    .map((id) => (allServices ?? []).find((service) => service._id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const availableFrequencies = maintenancePlan?.subscriptionFrequencies ?? [];
  const [subscriptionSelections, setSubscriptionSelections] = React.useState<
    Record<string, boolean>
  >({});
  const [subscriptionFrequency, setSubscriptionFrequency] = React.useState<
    "monthly" | "biweekly"
  >("monthly");
  const effectiveSubscriptionFrequency = availableFrequencies.includes(
    subscriptionFrequency,
  )
    ? subscriptionFrequency
    : (availableFrequencies[0] ?? "monthly");

  const maintenanceEligibleVehicles = React.useMemo(() => {
    if (!maintenancePlan || maintenancePlanIncludedServiceIds.length === 0) {
      return [];
    }

    return targetVehicles
      .map((vehicle, index) => {
        const selectedIds = vehicleServices[vehicle.key] || [];
        const selectedServices = (allServices ?? []).filter((service) =>
          selectedIds.includes(service._id),
        );
        const hasAllIncluded = maintenancePlanIncludedServiceIds.every((id) =>
          selectedIds.includes(id),
        );
        const hasOtherCoreOrUpgrade = selectedServices.some(
          (service) =>
            !maintenancePlanIncludedServiceIds.includes(service._id) &&
            service.serviceType !== "addon" &&
            service.bookingRole !== "addon",
        );
        const context = {
          vehicleSize: vehicle.size,
          vehicleTypeId: vehicle.vehicleTypeId ?? null,
        };
        const planPricing = getEffectiveServicePricingForVehicle(
          maintenancePlan,
          context,
        );
        const includedService = selectedServices.find((service) =>
          maintenancePlanIncludedServiceIds.includes(service._id),
        );
        const includedPricing = includedService
          ? getEffectiveServicePricingForVehicle(includedService, context)
          : null;

        return {
          index,
          vehicle,
          eligible:
            hasAllIncluded &&
            !hasOtherCoreOrUpgrade &&
            planPricing.isAvailable &&
            planPricing.price > 0,
          planPrice: planPricing.price,
          savings: Math.max(
            0,
            (includedPricing?.price ?? 0) - planPricing.price,
          ),
        };
      })
      .filter((candidate) => candidate.eligible);
  }, [
    maintenancePlan,
    maintenancePlanIncludedServiceIds,
    targetVehicles,
    vehicleServices,
    allServices,
  ]);

  const enrolledMaintenanceVehicles = maintenanceEligibleVehicles.filter(
    (candidate) => subscriptionSelections[candidate.vehicle.key],
  );
  const maintenanceSelected = enrolledMaintenanceVehicles.length > 0;
  const maintenanceTotalPerCycle =
    enrolledMaintenanceVehicles.reduce(
      (sum, candidate) => sum + candidate.planPrice,
      0,
    ) +
    enrolledMaintenanceVehicles.reduce(
      (sum, candidate) =>
        sum +
        (candidate.vehicle.hasPet
          ? getPetFeeForVehicle(candidate.vehicle.size)
          : 0),
      0,
    ) +
    (maintenanceSelected ? travelQuote?.fee ?? 0 : 0);

  // Helper to toggle vehicle selection from saved garage
  const toggleSavedVehicle = (v: Doc<"vehicles"> & { vehicleType?: Doc<"vehicleTypes"> | null }) => {
    const key = `existing-${v._id}`;
    const exists = selectedVehicles.some((item) => item.key === key);
    if (exists) {
      setSelectedVehicles((prev) => prev.filter((item) => item.key !== key));
      setVehicleServices((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      const added: VehicleSelection = {
        key,
        existingId: v._id,
        label: `${v.year} ${v.make} ${v.model}`,
        vehicleTypeId: v.vehicleTypeId,
        vehicleTypeName: v.vehicleType?.name,
        size: v.size || "medium",
        hasPet: false,
        hasHeavySoil: false,
      };
      setSelectedVehicles((prev) => [...prev, added]);
      if (!expandedServiceVehicle) setExpandedServiceVehicle(key);
      setActiveVehicleSection((prev) => ({ ...prev, [key]: "packages" }));
    }
  };

  const updateVehicleCondition = (key: string, patch: Partial<VehicleSelection>) => {
    setSelectedVehicles((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const handleSelectPackage = (vehicleKey: string, serviceId: string, coreIds: Set<string>) => {
    const existing = vehicleServices[vehicleKey] || [];
    const nonCore = existing.filter((id) => !coreIds.has(id));
    setVehicleServices({
      ...vehicleServices,
      [vehicleKey]: [...nonCore, serviceId],
    });
  };

  const handleToggleAddon = (vehicleKey: string, serviceId: string) => {
    const existing = vehicleServices[vehicleKey] || [];
    const hasIt = existing.includes(serviceId);
    const next = hasIt ? existing.filter((id) => id !== serviceId) : [...existing, serviceId];
    setVehicleServices({
      ...vehicleServices,
      [vehicleKey]: next,
    });
  };

  // Duration & Pricing Calculations
  const { totalServicePrice, totalDurationMinutes, petFeeTotal, grandTotal, depositTotal, dueNow } =
    React.useMemo(() => {
      let serviceSubtotal = 0;
      let duration = 0;
      let petFees = 0;
      const enrolledKeys = new Set(
        enrolledMaintenanceVehicles.map(
          (candidate) => candidate.vehicle.key,
        ),
      );

      targetVehicles.forEach((v) => {
        const sIds = vehicleServices[v.key] || [];
        const pricingCtx = { vehicleSize: v.size, vehicleTypeId: v.vehicleTypeId };
        const isEnrolled = enrolledKeys.has(v.key);

        sIds.forEach((sid) => {
          const s = allServices?.find((x: Doc<"services">) => x._id === sid);
          if (s) {
            if (
              isEnrolled &&
              maintenancePlanIncludedServiceIds.includes(
                sid as Id<"services">,
              )
            ) {
              return;
            }
            const pricing = getEffectiveServicePricingForVehicle(s, pricingCtx);
            serviceSubtotal += pricing.price;
            duration += pricing.duration;
          }
        });

        if (isEnrolled) {
          const candidate = maintenanceEligibleVehicles.find(
            (item) => item.vehicle.key === v.key,
          );
          if (candidate) {
            serviceSubtotal += candidate.planPrice;
            duration += maintenancePlan?.duration ?? 0;
          }
        }

        if (v.hasPet && petFeeSettings?.isActive !== false) {
          const fee = getPetFeeForVehicle(v.size);
          petFees += fee;
          duration += petFeeSettings?.timeAddMinutes ?? 30;
        }
      });

      const travelFee = travelQuote?.fee ?? 0;
      const travelBuffer = travelQuote?.bufferMinutes ?? 0;
      const total = serviceSubtotal + petFees + travelFee;
      const depositPerVehicle = depositSettings?.amountPerVehicle ?? 50;
      const calculatedDeposit = maintenanceSelected
        ? 0
        : Math.min(depositPerVehicle * Math.max(1, targetVehicles.length), total);
      const due =
        maintenanceSelected || paymentOption === "full"
          ? total
          : calculatedDeposit;

      return {
        totalServicePrice: serviceSubtotal,
        totalDurationMinutes: duration + travelBuffer,
        petFeeTotal: petFees,
        grandTotal: total,
        depositTotal: calculatedDeposit,
        dueNow: due,
      };
    }, [
      targetVehicles,
      vehicleServices,
      allServices,
      travelQuote,
      depositSettings,
      petFeeSettings,
      paymentOption,
      getPetFeeForVehicle,
      enrolledMaintenanceVehicles,
      maintenanceEligibleVehicles,
      maintenancePlan,
      maintenancePlanIncludedServiceIds,
      maintenanceSelected,
    ]);

  React.useEffect(() => {
    if (maintenanceSelected) {
      setPaymentOption("full");
    }
  }, [maintenanceSelected]);

  const discountAmount = appliedCoupon?.discountAmount ?? 0;
  const finalTotal = Math.max(0, grandTotal - discountAmount);

  React.useEffect(() => {
    setAppliedCoupon(null);
    setPromoStatus("idle");
    setPromoError(null);
  }, [grandTotal]);

  const handleApplyPromoCode = async () => {
    const code = promoCodeInput.trim();
    if (!code) return;
    setPromoStatus("checking");
    setPromoError(null);
    try {
      const result = await validateBookingPromoCode({
        code,
        orderTotal: grandTotal,
      });
      setAppliedCoupon(result);
      setPromoStatus("valid");
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      setAppliedCoupon(null);
      setPromoStatus("invalid");
      setPromoError(
        error instanceof Error ? error.message : "That promo code is not valid.",
      );
    }
  };

  const canProceedToNext = () => {
    if (step === 1) {
      return Boolean(address.street.trim() && address.city.trim() && address.state.trim());
    }
    if (step === 2) {
      return Boolean(scheduledDate && scheduledTime);
    }
    if (step === 3) {
      return targetVehicles.length > 0;
    }
    if (step === 4) {
      // Must have a core package selected for each vehicle
      return targetVehicles.every((v) => {
        const ids = vehicleServices[v.key] || [];
        const pricingCtx = { vehicleSize: v.size, vehicleTypeId: v.vehicleTypeId };
        const availableCoreIds = new Set(
          (allServices || [])
            .filter(
              (s) =>
                s.isActive !== false &&
                normalizeServiceType(s.serviceType) === "standard" &&
                getServiceBookingRole(s) === "core" &&
                isServiceAvailableForVehicle(s, pricingCtx),
            )
            .map((s) => String(s._id)),
        );
        return ids.some((id) => availableCoreIds.has(String(id)));
      });
    }
    return true;
  };

  const handleNext = () => {
    setError(null);
    if (!canProceedToNext()) {
      if (step === 1) setError("Please enter your complete service address.");
      if (step === 2) setError("Please select an available date and arrival window.");
      if (step === 3) setError("Please select or add at least one vehicle.");
      if (step === 4) setError("Please select a base detailing package for each vehicle.");
      return;
    }
    setStep((prev) => Math.min(5, prev + 1) as any);
  };

  const handleSubmitBooking = async () => {
    if (!currentUser) return;
    setError(null);
    setIsLoading(true);

    try {
      const existingVehicleIds = targetVehicles
        .map((v) => v.existingId)
        .filter(Boolean) as Id<"vehicles">[];

      const newVehiclesList = targetVehicles
        .filter((v) => !v.existingId && v.details)
        .map((v) => ({
          year: Number(v.details!.year),
          make: v.details!.make,
          model: v.details!.model,
          color: v.details!.color,
          size: v.size,
          vehicleTypeId: v.vehicleTypeId,
          classification: v.details!.classification,
        }));

      const existingVehicleServices = existingVehicleIds.map((id) => {
        const key = `existing-${id}`;
        return {
          vehicleId: id,
          serviceIds: (vehicleServices[key] || []) as Id<"services">[],
        };
      });

      const petFeeIds = targetVehicles
        .filter((v) => v.existingId && v.hasPet)
        .map((v) => v.existingId!) as Id<"vehicles">[];

      const allServiceIds = Array.from(
        new Set(Object.values(vehicleServices).flat()),
      ) as Id<"services">[];

      const { draftId, resumeToken } = await createOrUpdateDraft({
        name: currentUser.name || "Customer",
        email: currentUser.email || "",
        phone: currentUser.phone || "",
        smsOptIn,
        marketingEmails,
        address: {
          street: address.street.trim(),
          city: address.city.trim(),
          state: address.state.trim().toUpperCase(),
          zip: address.zip.trim(),
          notes: address.notes?.trim() || undefined,
        },
        existingVehicleIds,
        existingVehicleServices:
          existingVehicleServices.length > 0 ? existingVehicleServices : undefined,
        vehicles: newVehiclesList.length > 0 ? newVehiclesList : undefined,
        petFeeExistingVehicleIds: petFeeIds,
        serviceIds: allServiceIds,
        scheduledDate,
        scheduledTime,
        paymentOption: maintenanceSelected ? "full" : paymentOption,
        subscriptionIntent:
          maintenanceSelected && maintenancePlan
            ? {
                planServiceId: maintenancePlan._id,
                frequency: effectiveSubscriptionFrequency,
                enrolledVehicleIndexes: enrolledMaintenanceVehicles.map(
                  (candidate) => candidate.index,
                ),
              }
            : undefined,
      });

      // Use the app's configured Expo scheme so Stripe can return to the
      // authenticated native session instead of leaving the customer in Safari.
      const checkoutOrigin = Linking.createURL("");
      const checkoutRedirectUrl = Linking.createURL("booking/success");
      const { url } = await createBookingCheckout({
        draftId,
        origin: checkoutOrigin,
        couponCode: appliedCoupon?.code ?? "",
      });

      if (!url) {
        throw new Error("Failed to create checkout session");
      }

      setIsLoading(false);
      const browserResult = await openAuthSession(url, checkoutRedirectUrl);

      // The webhook is authoritative, but confirm from the signed-in native
      // client as soon as Checkout returns so the appointment appears without
      // requiring a refresh or a trip through the web claim flow.
      setIsLoading(true);
      try {
        const result = await confirmBookingCheckout({ resumeToken });
        if (result.success && result.appointmentId) {
          router.replace(`/appointments/${result.appointmentId}`);
          return;
        }
      } catch (confirmErr) {
        console.warn("Could not confirm checkout immediately:", confirmErr);
      }

      const returnState = browserResult.type === "success" ? "" : "&checkout=closed";
      router.replace(`/booking/success?token=${encodeURIComponent(resumeToken)}${returnState}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create booking";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Screen scrollRef={scrollRef}>
      {/* Top Bar */}
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          onPress={() => (step > 1 ? setStep((prev) => (prev - 1) as any) : router.back())}
          className="flex-row items-center gap-1.5 active:opacity-70"
        >
          <ArrowLeft size={18} color={THEME.light.foreground} />
          <Text className="text-sm font-semibold">{step > 1 ? "Back" : "Cancel"}</Text>
        </Pressable>
        <Text className="text-xs font-bold text-accent">Step {step} of 5</Text>
      </View>

      {/* Progress Bars (5 Steps) */}
      <View className="flex-row gap-2">
        {[1, 2, 3, 4, 5].map((s) => (
          <View
            key={s}
            className="h-1.5 flex-1 rounded-full"
            style={{ backgroundColor: step >= s ? THEME.light.accent : THEME.light.muted }}
          />
        ))}
      </View>

      <ScreenHeader
        eyebrow={
          step === 1
            ? "Service Location"
            : step === 2
              ? "Date & Time"
              : step === 3
                ? "Your Garage & Condition"
                : step === 4
                  ? "Detailing Packages"
                  : "Review & Checkout"
        }
        title={
          step === 1
            ? "Where should we detail?"
            : step === 2
              ? "When works best for you?"
              : step === 3
                ? "Select vehicles & condition"
                : step === 4
                  ? "Choose packages & extras"
                  : "Confirm & Book"
        }
        description={
          step === 1
            ? "We bring pure water and equipment directly to your driveway."
            : step === 2
              ? "Live scheduling based on estimated service time and route."
              : step === 3
                ? "Tell us about pet hair, heavy soil, and select your vehicles."
                : step === 4
                  ? "Select core packages, ceramic upgrades, and add-ons for each vehicle."
                  : undefined
        }
      />

      {error ? (
        <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
          <Text className="text-xs font-medium text-destructive">{error}</Text>
        </View>
      ) : null}

      {/* STEP 1: Address & Location */}
      {step === 1 ? (
        <View key="step-1" className="gap-4">
          <Card className="border border-border">
            <CardContent className="p-4">
              <AddressSearch
                value={address}
                onChange={setAddress}
                onTravelQuoteChange={setTravelQuote}
                label="Driveway or Office Address"
                showNotes={true}
              />
            </CardContent>
          </Card>

          <Button
            size="lg"
            disabled={!canProceedToNext()}
            onPress={handleNext}
            className="w-full flex-row items-center justify-center gap-2 mt-2"
          >
            <Text className="font-bold text-primary-foreground">Choose Date & Time</Text>
            <ArrowRight size={18} color={THEME.light.primaryForeground} />
          </Button>
        </View>
      ) : null}

      {/* STEP 2: Date & Time Selection */}
      {step === 2 ? (
        <View key="step-2" className="gap-4">
          <TimeSlotPicker
            selectedDate={scheduledDate}
            onDateChange={setScheduledDate}
            selectedTime={scheduledTime}
            onTimeChange={setScheduledTime}
            durationMinutes={totalDurationMinutes || 120}
          />

          <Button
            size="lg"
            disabled={!canProceedToNext()}
            onPress={handleNext}
            className="w-full flex-row items-center justify-center gap-2 mt-2"
          >
            <Text className="font-bold text-primary-foreground">Select Vehicles</Text>
            <ArrowRight size={18} color={THEME.light.primaryForeground} />
          </Button>
        </View>
      ) : null}

      {/* STEP 3: Vehicle Selection & Condition */}
      {step === 3 ? (
        <View key="step-3" className="gap-5 pb-6">
          <View className="gap-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select From Your Garage
            </Text>

            {myVehicles?.length ? (
              <View className="gap-3">
                {myVehicles.map((v) => {
                  const key = `existing-${v._id}`;
                  const isSelected = selectedVehicles.some((item) => item.key === key);
                  const selection = selectedVehicles.find((item) => item.key === key);

                  return (
                    <Card
                      key={v._id}
                      className={`border overflow-hidden ${
                        isSelected ? "border-accent bg-accent/5" : "border-border bg-card"
                      }`}
                    >
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => toggleSavedVehicle(v)}
                        className="flex-row items-center justify-between p-4 active:bg-secondary/40"
                      >
                        <View className="flex-row items-center gap-3 flex-1">
                          <View
                            className={`h-9 w-9 items-center justify-center rounded-xl ${
                              isSelected ? "bg-accent" : "bg-secondary"
                            }`}
                          >
                            <CarFront
                              size={18}
                              color={
                                isSelected
                                  ? THEME.light.accentForeground
                                  : THEME.light.foreground
                              }
                            />
                          </View>
                          <View className="flex-1">
                            <Text className="font-bold text-sm">
                              {v.year} {v.make} {v.model}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              {v.vehicleType?.name || v.size || "Standard"}
                              {v.color ? ` · ${v.color}` : ""}
                            </Text>
                          </View>
                        </View>

                        <View
                          className={`h-6 w-6 items-center justify-center rounded-full border ${
                            isSelected ? "border-accent bg-accent" : "border-border"
                          }`}
                        >
                          {isSelected ? <Check size={14} color="#fff" /> : null}
                        </View>
                      </Pressable>

                      {/* Condition Questions (Pet Hair & Heavy Soil) */}
                      {isSelected ? (
                        <CardContent className="gap-3 p-4 pt-0 border-t border-border/40">
                          <Text className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-2">
                            Vehicle Condition
                          </Text>

                          {/* Pet Hair Toggle */}
                          <View className="flex-row items-center justify-between rounded-xl bg-secondary/40 p-3">
                            <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                              <Dog size={16} color={THEME.light.accent} />
                              <View className="flex-1">
                                <Text className="text-xs font-bold">Pet Hair Present?</Text>
                                <Text className="text-[11px] text-muted-foreground">
                                  Deep pet hair extraction (+ ${getPetFeeForVehicle(selection?.size || v.size || "medium").toFixed(2)})
                                </Text>
                              </View>
                            </View>
                            <Switch
                              value={Boolean(selection?.hasPet)}
                              onValueChange={(val) => updateVehicleCondition(key, { hasPet: val })}
                            />
                          </View>

                          {/* Heavy Soil / Bio Toggle */}
                          <View className="flex-row items-center justify-between rounded-xl bg-secondary/40 p-3">
                            <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                              <Sparkles size={16} color={THEME.light.accent} />
                              <View className="flex-1">
                                <Text className="text-xs font-bold">Heavy Soil or Mud?</Text>
                                <Text className="text-[11px] text-muted-foreground">
                                  Excessive mud, bio, or heavy staining
                                </Text>
                              </View>
                            </View>
                            <Switch
                              value={Boolean(selection?.hasHeavySoil)}
                              onValueChange={(val) =>
                                updateVehicleCondition(key, { hasHeavySoil: val })
                              }
                            />
                          </View>
                        </CardContent>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            ) : null}
          </View>

          {/* Ad-hoc Vehicle Additions */}
          {adHocVehicles.map((adhoc, idx) => (
            <Card key={idx} className="border border-border p-4 gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-bold text-sm">
                  Vehicle {selectedVehicles.length + idx + 1}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAdHocVehicles(adHocVehicles.filter((_, i) => i !== idx))}
                  className="p-1 rounded-full active:bg-secondary"
                >
                  <Trash2 size={16} color={THEME.light.destructive} />
                </Pressable>
              </View>

              <VehicleLookup
                title=""
                value={adhoc}
                onChange={(updated) => {
                  const next = [...adHocVehicles];
                  next[idx] = { ...next[idx], ...updated };
                  setAdHocVehicles(next);
                }}
              />

              {/* Condition Questions for Ad-hoc Vehicle */}
              <View className="gap-2.5 pt-2 border-t border-border/40">
                <Text className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Vehicle Condition
                </Text>

                <View className="flex-row items-center justify-between rounded-xl bg-secondary/40 p-3">
                  <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                    <Dog size={16} color={THEME.light.accent} />
                    <View className="flex-1">
                      <Text className="text-xs font-bold">Pet Hair Present?</Text>
                      <Text className="text-[11px] text-muted-foreground">
                        Deep pet hair extraction (+ ${getPetFeeForVehicle(adhoc.size || "medium").toFixed(2)})
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={Boolean(adhoc.hasPet)}
                    onValueChange={(val) => {
                      const next = [...adHocVehicles];
                      next[idx] = { ...next[idx], hasPet: val };
                      setAdHocVehicles(next);
                    }}
                  />
                </View>

                <View className="flex-row items-center justify-between rounded-xl bg-secondary/40 p-3">
                  <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                    <Sparkles size={16} color={THEME.light.accent} />
                    <View className="flex-1">
                      <Text className="text-xs font-bold">Heavy Soil or Mud?</Text>
                      <Text className="text-[11px] text-muted-foreground">
                        Excessive mud, bio, or heavy staining
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={Boolean(adhoc.hasHeavySoil)}
                    onValueChange={(val) => {
                      const next = [...adHocVehicles];
                      next[idx] = { ...next[idx], hasHeavySoil: val };
                      setAdHocVehicles(next);
                    }}
                  />
                </View>
              </View>
            </Card>
          ))}

          {/* Add Another Car Button (Full Height, No Clipping) */}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setAdHocVehicles([
                ...adHocVehicles,
                { year: "", make: "", model: "", size: "medium", hasPet: false, hasHeavySoil: false },
              ])
            }
            className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card active:bg-secondary"
          >
            <Plus size={16} color={THEME.light.foreground} />
            <Text className="font-semibold text-sm text-foreground">Add Another Car</Text>
          </Pressable>

          {/* Proceed Button */}
          <Button
            size="lg"
            disabled={!canProceedToNext()}
            onPress={handleNext}
            className="w-full flex-row items-center justify-center gap-2 mt-3 mb-8"
          >
            <Text className="font-bold text-primary-foreground">Choose Detailing Packages</Text>
            <ArrowRight size={18} color={THEME.light.primaryForeground} />
          </Button>
        </View>
      ) : null}

      {/* STEP 4: Detailing Packages Multi-Stepper Accordion */}
      {step === 4 ? (
        <View key="step-4" className="gap-5 pb-8">
          <View className="gap-4">
            {targetVehicles.map((v, vIdx) => {
              const pricingCtx = { vehicleSize: v.size, vehicleTypeId: v.vehicleTypeId };
              const currentServices = vehicleServices[v.key] || [];

              // Filter services available for this vehicle AND allowed for current condition
              const vehicleAvailableServices = (allServices || []).filter((s) => {
                if (s.isActive === false) return false;
                if (!isServiceAvailableForVehicle(s, pricingCtx)) return false;
                if (!isServiceAllowedForCondition(s, { hasPet: v.hasPet, hasHeavySoil: v.hasHeavySoil })) {
                  return false; // Strictly omit disallowed services when pet hair or heavy mud is selected
                }
                return true;
              });

              const coreServices = vehicleAvailableServices.filter(
                (s) =>
                  normalizeServiceType(s.serviceType) === "standard" &&
                  getServiceBookingRole(s) === "core",
              );

              const upgradeServices = vehicleAvailableServices.filter(
                (s) =>
                  normalizeServiceType(s.serviceType) === "standard" &&
                  getServiceBookingRole(s) === "upgrade",
              );

              const addonServices = vehicleAvailableServices.filter(
                (s) => getServiceBookingRole(s) === "addon",
              );

              // Sort lists by lowest to highest price
              const standardGroups = PACKAGE_CATEGORY_ORDER.map((slug) => ({
                slug,
                name: PACKAGE_CATEGORY_LABELS[slug],
                services: coreServices
                  .filter((s) => getPackageCategorySlug(s) === slug)
                  .sort(
                    (a, b) =>
                      getEffectiveServicePricingForVehicle(a, pricingCtx).price -
                      getEffectiveServicePricingForVehicle(b, pricingCtx).price,
                  ),
              })).filter((group) => group.services.length > 0);

              const sortedUpgradeServices = [...upgradeServices].sort(
                (a, b) =>
                  getEffectiveServicePricingForVehicle(a, pricingCtx).price -
                  getEffectiveServicePricingForVehicle(b, pricingCtx).price,
              );

              const addonGroups = ADDON_CATEGORY_ORDER.map((slug) => ({
                slug,
                name: ADDON_CATEGORY_LABELS[slug],
                services: addonServices
                  .filter((s) => getAddonCategorySlug(s) === slug)
                  .sort(
                    (a, b) =>
                      getEffectiveServicePricingForVehicle(a, pricingCtx).price -
                      getEffectiveServicePricingForVehicle(b, pricingCtx).price,
                  ),
              })).filter((group) => group.services.length > 0);

              const coreIds = new Set(coreServices.map((s) => String(s._id)));
              const selectedPackage = coreServices.find((s) => currentServices.includes(s._id));
              const selectedUpgrades = upgradeServices.filter((s) => currentServices.includes(s._id));
              const selectedAddons = addonServices.filter((s) => currentServices.includes(s._id));

              // Determine active category for package sub-accordions
              const currentPkgCategoryKey = `${v.key}-pkg`;
              const activePkgCat =
                activeNestedCategory[currentPkgCategoryKey] ??
                (selectedPackage
                  ? getPackageCategorySlug(selectedPackage)
                  : standardGroups[0]?.slug ?? "full-detail");

              // Vehicle subtotal
              const vehicleServicesTotal = currentServices.reduce((sum, id) => {
                const service = vehicleAvailableServices.find((s) => s._id === id);
                if (!service) return sum;
                return sum + getEffectiveServicePricingForVehicle(service, pricingCtx).price;
              }, 0);

              const isVehicleExpanded =
                expandedServiceVehicle === v.key || targetVehicles.length === 1;
              const currentSection =
                activeVehicleSection[v.key] !== undefined
                  ? activeVehicleSection[v.key]
                  : selectedPackage
                    ? ""
                    : "packages";

              return (
                <Card key={v.key} className="border border-border overflow-hidden">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setExpandedServiceVehicle(
                        isVehicleExpanded && targetVehicles.length > 1 ? "" : v.key,
                      )
                    }
                    className="flex-row items-center justify-between p-4 bg-card active:bg-secondary/40"
                  >
                    <View className="flex-row items-center gap-3 flex-1">
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
                        <CarFront size={18} color={THEME.light.accent} />
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="font-bold text-sm">{v.label}</Text>
                          <Badge variant="secondary" size="sm" label={v.size.toUpperCase()} />
                        </View>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {selectedPackage ? selectedPackage.name : "Choose package"}
                          {selectedAddons.length > 0 ? ` · +${selectedAddons.length} add-ons` : ""}
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row items-center gap-2">
                      {vehicleServicesTotal > 0 ? (
                        <Badge variant="accent" size="sm" label={`$${vehicleServicesTotal.toFixed(2)}`} />
                      ) : (
                        <Badge variant="warning" size="sm" label="Required" />
                      )}
                      {targetVehicles.length > 1 ? (
                        isVehicleExpanded ? (
                          <ChevronUp size={18} color={THEME.light.mutedForeground} />
                        ) : (
                          <ChevronDown size={18} color={THEME.light.mutedForeground} />
                        )
                      ) : null}
                    </View>
                  </Pressable>

                  {isVehicleExpanded ? (
                    <CardContent className="p-3 gap-3 bg-secondary/10 border-t border-border/40">
                      {/* Walkdown Section 1: Choose Package (REQUIRED) */}
                      <Card className="border border-border/70 overflow-hidden">
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            setActiveVehicleSection((prev) => ({
                              ...prev,
                              [v.key]: currentSection === "packages" ? "" : "packages",
                            }))
                          }
                          className="flex-row items-center justify-between p-3.5 bg-card active:bg-secondary/30"
                        >
                          <View className="flex-1 pr-2">
                            <View className="flex-row items-center gap-2">
                              <Badge variant={selectedPackage ? "secondary" : "accent"} size="sm" label="1. REQUIRED" />
                              <Text className="font-bold text-sm text-foreground">Choose Package</Text>
                            </View>
                            {selectedPackage ? (
                              <Text className="text-xs font-bold text-accent mt-1" numberOfLines={1}>
                                {selectedPackage.name} (${getEffectiveServicePricingForVehicle(selectedPackage, pricingCtx).price.toFixed(2)})
                              </Text>
                            ) : (
                              <Text className="text-xs text-muted-foreground mt-1">Select 1 base package</Text>
                            )}
                          </View>

                          <View className="shrink-0 pl-1">
                            {currentSection === "packages" ? (
                              <ChevronUp size={18} color={THEME.light.mutedForeground} />
                            ) : (
                              <ChevronDown size={18} color={THEME.light.mutedForeground} />
                            )}
                          </View>
                        </Pressable>

                        {currentSection === "packages" ? (
                          <CardContent className="p-3.5 pt-2 border-t border-border/30 gap-3">
                            {/* Nested Category Accordions: Full Detail, Interior Only, Exterior Only */}
                            {standardGroups.map((group) => {
                              const isCatOpen = activePkgCat === group.slug;
                              const isPackageInThisGroup =
                                selectedPackage &&
                                getPackageCategorySlug(selectedPackage) === group.slug;

                              return (
                                <View
                                  key={group.slug}
                                  className="rounded-xl border border-border/80 bg-background/50 overflow-hidden"
                                >
                                  {/* Category Header */}
                                  <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                      setActiveNestedCategory((prev) => ({
                                        ...prev,
                                        [currentPkgCategoryKey]: isCatOpen ? "" : group.slug,
                                      }))
                                    }
                                    className="flex-row items-center justify-between p-3 bg-secondary/20 active:bg-secondary/40"
                                  >
                                    <View className="flex-1 pr-2">
                                      <Text className="font-bold text-xs text-foreground uppercase tracking-wide">
                                        {group.name}
                                      </Text>
                                    </View>

                                    <View className="flex-row items-center gap-2 shrink-0">
                                      {isPackageInThisGroup ? (
                                        <View className="flex-row items-center gap-1.5">
                                          <Text className="text-[11px] font-semibold text-accent max-w-[130px]" numberOfLines={1}>
                                            {selectedPackage.name}
                                          </Text>
                                          <Check size={13} color={THEME.light.accent} />
                                        </View>
                                      ) : (
                                        <Text className="text-[11px] text-muted-foreground">
                                          {group.services.length} options
                                        </Text>
                                      )}
                                      {isCatOpen ? (
                                        <ChevronUp size={15} color={THEME.light.mutedForeground} />
                                      ) : (
                                        <ChevronDown size={15} color={THEME.light.mutedForeground} />
                                      )}
                                    </View>
                                  </Pressable>

                                  {/* Category Package List */}
                                  {isCatOpen ? (
                                    <View className="p-3 gap-2.5 border-t border-border/40">
                                      {group.services.map((pkg) => {
                                        const isChosen = selectedPackage?._id === pkg._id;
                                        const pricing = getEffectiveServicePricingForVehicle(pkg, pricingCtx);

                                        return (
                                          <Pressable
                                            key={pkg._id}
                                            accessibilityRole="button"
                                            onPress={() => {
                                              handleSelectPackage(v.key, pkg._id, coreIds);
                                              // Close the category accordion once an option is selected
                                              setActiveNestedCategory((prev) => ({
                                                ...prev,
                                                [currentPkgCategoryKey]: "",
                                              }));
                                              // Close the Choose Package section so only the selection & name show!
                                              setActiveVehicleSection((prev) => ({
                                                ...prev,
                                                [v.key]: "",
                                              }));
                                            }}
                                            className={`rounded-xl border p-3.5 ${
                                              isChosen
                                                ? "border-accent bg-accent/10"
                                                : "border-border bg-card active:bg-secondary"
                                            }`}
                                          >
                                            <View className="flex-row items-start justify-between gap-3">
                                              <View className="flex-1 pr-1">
                                                <Text className="font-bold text-sm text-foreground">
                                                  {pkg.name}
                                                </Text>
                                                {pkg.duration ? (
                                                  <View className="flex-row items-center mt-1">
                                                    <View className="rounded-full bg-secondary/80 px-2 py-0.5 border border-border/50">
                                                      <Text className="text-[10px] font-semibold text-muted-foreground">
                                                        ~{pricing.duration} min
                                                      </Text>
                                                    </View>
                                                  </View>
                                                ) : null}
                                                {pkg.description ? (
                                                  <Text className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                                    {pkg.description}
                                                  </Text>
                                                ) : null}
                                              </View>

                                              <View className="shrink-0 items-end justify-start pt-0.5">
                                                <Text className="text-sm font-black text-accent">
                                                  ${pricing.price.toFixed(2)}
                                                </Text>
                                              </View>
                                            </View>
                                          </Pressable>
                                        );
                                      })}
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}
                          </CardContent>
                        ) : null}
                      </Card>

                      {/* Walkdown Section 2: Upgrades (OPTIONAL) */}
                      {sortedUpgradeServices.length > 0 ? (
                        <Card className="border border-border/70 overflow-hidden">
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              setActiveVehicleSection((prev) => ({
                                ...prev,
                                [v.key]: currentSection === "upgrades" ? ("" as any) : "upgrades",
                              }))
                            }
                            className="flex-row items-center justify-between p-3.5 bg-card active:bg-secondary/30"
                          >
                            <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                              <Badge variant="secondary" size="sm" label="2. OPTIONAL" />
                              <Text className="font-bold text-sm text-foreground">Core Upgrades</Text>
                            </View>
                            <View className="flex-row items-center gap-2 shrink-0">
                              {selectedUpgrades.length > 0 ? (
                                <Text className="text-xs font-semibold text-accent">
                                  {selectedUpgrades.length} selected
                                </Text>
                              ) : (
                                <Text className="text-xs text-muted-foreground">None</Text>
                              )}
                              {currentSection === "upgrades" ? (
                                <ChevronUp size={16} color={THEME.light.mutedForeground} />
                              ) : (
                                <ChevronDown size={16} color={THEME.light.mutedForeground} />
                              )}
                            </View>
                          </Pressable>

                          {currentSection === "upgrades" ? (
                            <CardContent className="p-3.5 pt-2 border-t border-border/30 gap-2">
                              {sortedUpgradeServices.map((upg) => {
                                const isSelected = currentServices.includes(upg._id);
                                const pricing = getEffectiveServicePricingForVehicle(upg, pricingCtx);

                                return (
                                  <Pressable
                                    key={upg._id}
                                    accessibilityRole="button"
                                    onPress={() => handleToggleAddon(v.key, upg._id)}
                                    className={`flex-row items-center justify-between rounded-xl border p-3 ${
                                      isSelected
                                        ? "border-accent bg-accent/10"
                                        : "border-border bg-card active:bg-secondary"
                                    }`}
                                  >
                                    <View className="flex-1 pr-2">
                                      <Text className="font-semibold text-xs text-foreground">{upg.name}</Text>
                                      {upg.description ? (
                                        <Text className="text-[11px] text-muted-foreground mt-0.5">
                                          {upg.description}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <View className="flex-row items-center gap-2.5 shrink-0">
                                      <Text className="font-bold text-xs text-accent">+${pricing.price.toFixed(2)}</Text>
                                      <View
                                        className={`h-5 w-5 items-center justify-center rounded border ${
                                          isSelected ? "border-accent bg-accent" : "border-border"
                                        }`}
                                      >
                                        {isSelected ? <Check size={12} color="#fff" /> : null}
                                      </View>
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </CardContent>
                          ) : null}
                        </Card>
                      ) : null}

                      {/* Walkdown Section 3: Add-Ons (OPTIONAL) */}
                      {addonServices.length > 0 ? (
                        <Card className="border border-border/70 overflow-hidden">
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              setActiveVehicleSection((prev) => ({
                                ...prev,
                                [v.key]: currentSection === "addons" ? ("" as any) : "addons",
                              }))
                            }
                            className="flex-row items-center justify-between p-3.5 bg-card active:bg-secondary/30"
                          >
                            <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                              <Badge variant="secondary" size="sm" label="3. OPTIONAL" />
                              <Text className="font-bold text-sm text-foreground">Add-on Extras</Text>
                            </View>
                            <View className="flex-row items-center gap-2 shrink-0">
                              {selectedAddons.length > 0 ? (
                                <Text className="text-xs font-semibold text-accent">
                                  {selectedAddons.length} selected
                                </Text>
                              ) : (
                                <Text className="text-xs text-muted-foreground">None</Text>
                              )}
                              {currentSection === "addons" ? (
                                <ChevronUp size={16} color={THEME.light.mutedForeground} />
                              ) : (
                                <ChevronDown size={16} color={THEME.light.mutedForeground} />
                              )}
                            </View>
                          </Pressable>

                          {currentSection === "addons" ? (
                            <CardContent className="p-3.5 pt-2 border-t border-border/30 gap-3">
                              {addonGroups.map((group) => {
                                const currentAddonCatKey = `${v.key}-addon-${group.slug}`;
                                const isAddonGroupOpen =
                                  activeNestedCategory[currentAddonCatKey] !== "closed";
                                const groupAddonCount = group.services.filter((s) =>
                                  currentServices.includes(s._id),
                                ).length;

                                return (
                                  <View
                                    key={group.slug}
                                    className="rounded-xl border border-border/80 bg-background/50 overflow-hidden"
                                  >
                                    <Pressable
                                      accessibilityRole="button"
                                      onPress={() =>
                                        setActiveNestedCategory((prev) => ({
                                          ...prev,
                                          [currentAddonCatKey]: isAddonGroupOpen ? "closed" : "open",
                                        }))
                                      }
                                      className="flex-row items-center justify-between p-3 bg-secondary/20 active:bg-secondary/40"
                                    >
                                      <View className="flex-1 pr-2">
                                        <Text className="font-bold text-xs text-foreground uppercase tracking-wide">
                                          {group.name}
                                        </Text>
                                      </View>

                                      <View className="flex-row items-center gap-2 shrink-0">
                                        {groupAddonCount > 0 ? (
                                          <Badge
                                            variant="accent"
                                            size="sm"
                                            label={`${groupAddonCount} selected`}
                                          />
                                        ) : (
                                          <Text className="text-[11px] text-muted-foreground">
                                            {group.services.length} options
                                          </Text>
                                        )}
                                        {isAddonGroupOpen ? (
                                          <ChevronUp size={15} color={THEME.light.mutedForeground} />
                                        ) : (
                                          <ChevronDown size={15} color={THEME.light.mutedForeground} />
                                        )}
                                      </View>
                                    </Pressable>

                                    {isAddonGroupOpen ? (
                                      <View className="p-3 gap-2.5 border-t border-border/40">
                                        {group.services.map((addon) => {
                                          const isSelected = currentServices.includes(addon._id);
                                          const pricing = getEffectiveServicePricingForVehicle(addon, pricingCtx);

                                          return (
                                            <Pressable
                                              key={addon._id}
                                              accessibilityRole="button"
                                              onPress={() => handleToggleAddon(v.key, addon._id)}
                                              className={`flex-row items-center justify-between rounded-xl border p-3 ${
                                                isSelected
                                                  ? "border-accent bg-accent/10"
                                                  : "border-border bg-card active:bg-secondary"
                                              }`}
                                            >
                                              <View className="flex-1 pr-2">
                                                <Text className="font-semibold text-xs text-foreground">{addon.name}</Text>
                                                <Text className="text-[11px] text-muted-foreground mt-0.5">
                                                  +{pricing.duration} mins
                                                </Text>
                                              </View>
                                              <View className="flex-row items-center gap-2.5 shrink-0">
                                                <Text className="font-bold text-xs text-accent">
                                                  +${pricing.price.toFixed(2)}
                                                </Text>
                                                <View
                                                  className={`h-5 w-5 items-center justify-center rounded border ${
                                                    isSelected ? "border-accent bg-accent" : "border-border"
                                                  }`}
                                                >
                                                  {isSelected ? <Check size={12} color="#fff" /> : null}
                                                </View>
                                              </View>
                                            </Pressable>
                                          );
                                        })}
                                      </View>
                                    ) : null}
                                  </View>
                                );
                              })}
                            </CardContent>
                          ) : null}
                        </Card>
                      ) : null}
                    </CardContent>
                  ) : null}
                </Card>
              );
            })}
          </View>

          {/* Bottom Navigation to Step 5 (Review & Checkout) */}
          <Button
            size="lg"
            disabled={!canProceedToNext()}
            onPress={handleNext}
            className="w-full flex-row items-center justify-center gap-2 mt-2 mb-8"
          >
            <Text className="font-bold text-primary-foreground">Review & Checkout</Text>
            <ArrowRight size={18} color={THEME.light.primaryForeground} />
          </Button>
        </View>
      ) : null}

      {/* STEP 5: Dedicated Review & Stripe Checkout Screen (Single Screen View) */}
      {step === 5 ? (
        <View key="step-5" className="gap-3.5 pb-6">
          {/* Unified Order, Appointment & Location Summary Card */}
          <Card className="border border-border bg-card overflow-hidden">
            {/* Top Appointment & Location strip */}
            <View className="bg-secondary/30 p-3 border-b border-border/50 gap-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2 flex-1 pr-2">
                  <Calendar size={15} color={THEME.light.accent} />
                  <Text className="font-bold text-xs text-foreground" numberOfLines={1}>
                    {scheduledDate
                      ? new Date(`${scheduledDate}T12:00:00`).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })
                      : ""}{" "}
                    at {formatTime12h(scheduledTime)}
                  </Text>
                </View>
                <Badge variant="secondary" size="sm" label={`~${totalDurationMinutes}m`} />
              </View>

              <View className="flex-row items-center gap-2">
                <MapPin size={15} color={THEME.light.accent} />
                <Text className="text-xs text-muted-foreground flex-1" numberOfLines={1}>
                  {address.street ? `${address.street}, ${address.city}, ${address.state}` : "Driveway Service"}
                </Text>
              </View>
            </View>

            <CardContent className="p-3 gap-2.5">
              {/* Vehicles & Services */}
              <View className="gap-2">
                {targetVehicles.map((v) => {
                  const sIds = vehicleServices[v.key] || [];
                  const pricingCtx = { vehicleSize: v.size, vehicleTypeId: v.vehicleTypeId };
                  const chosenServices = (allServices || [])
                    .filter((s) => sIds.includes(s._id))
                    .map((s) => ({
                      ...s,
                      pricing: getEffectiveServicePricingForVehicle(s, pricingCtx),
                    }));

                  return (
                    <View key={v.key} className="gap-1 rounded-lg bg-secondary/20 p-2.5 border border-border/30">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                          <CarFront size={14} color={THEME.light.accent} />
                          <Text className="font-bold text-xs text-foreground" numberOfLines={1}>
                            {v.label}
                          </Text>
                        </View>
                        <Badge variant="secondary" size="sm" label={v.size.toUpperCase()} />
                      </View>

                      <View className="gap-1 pt-1 border-t border-border/20">
                        {chosenServices.map((s) => (
                          <View key={s._id} className="flex-row items-center justify-between">
                            <Text className="text-[11px] text-muted-foreground flex-1 pr-2" numberOfLines={1}>
                              {s.name}
                            </Text>
                            <Text className="text-[11px] font-semibold text-foreground">
                              ${s.pricing.price.toFixed(2)}
                            </Text>
                          </View>
                        ))}
                        {v.hasPet && petFeeSettings?.isActive !== false ? (
                          <View className="flex-row items-center justify-between">
                            <Text className="text-[11px] text-muted-foreground">Pet Hair Extraction</Text>
                            <Text className="text-[11px] font-semibold text-foreground">
                              +${getPetFeeForVehicle(v.size).toFixed(2)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Price & Fees calculation */}
              <View className="gap-1 border-t border-border/50 pt-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs text-muted-foreground">Detailing Subtotal</Text>
                  <Text className="text-xs font-semibold text-foreground">
                    ${totalServicePrice.toFixed(2)}
                  </Text>
                </View>

                {petFeeTotal > 0 ? (
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-muted-foreground">Pet Hair Extraction Fee</Text>
                    <Text className="text-xs font-semibold text-foreground">
                      +${petFeeTotal.toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {travelQuote && travelQuote.fee > 0 ? (
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-muted-foreground">
                      Arkansas Travel ({travelQuote.distanceMiles.toFixed(1)} mi)
                    </Text>
                    <Text className="text-xs font-semibold text-foreground">
                      +${travelQuote.fee.toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {appliedCoupon && discountAmount > 0 ? (
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-muted-foreground">
                      Promo ({appliedCoupon.code})
                    </Text>
                    <Text className="text-xs font-semibold text-emerald-600">
                      -${discountAmount.toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                <View className="flex-row items-center justify-between border-t border-border/50 pt-1.5 mt-0.5">
                  <Text className="text-sm font-extrabold text-foreground">Total</Text>
                  <Text className="text-base font-black text-accent">
                    ${finalTotal.toFixed(2)}
                  </Text>
                </View>
              </View>
            </CardContent>
          </Card>

          <View className="gap-2">
            <Text className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Promo code
            </Text>
            <View className="flex-row gap-2">
              <Input
                value={promoCodeInput}
                onChangeText={(value) => {
                  setPromoCodeInput(value);
                  setPromoStatus("idle");
                  setPromoError(null);
                }}
                placeholder="Enter code"
                autoCapitalize="characters"
                className="flex-1"
              />
              <Button
                variant="outline"
                onPress={handleApplyPromoCode}
                disabled={promoStatus === "checking" || !promoCodeInput.trim()}
              >
                <Text className="text-xs font-semibold">
                  {promoStatus === "checking" ? "Checking..." : "Apply"}
                </Text>
              </Button>
            </View>
            {appliedCoupon ? (
              <Text className="text-xs text-emerald-600">
                Code {appliedCoupon.code} applied — you save $
                {discountAmount.toFixed(2)}.
              </Text>
            ) : null}
            {promoStatus === "invalid" ? (
              <Text className="text-xs text-destructive">
                {promoError ?? "That promo code is not valid."}
              </Text>
            ) : null}
          </View>

          {maintenanceEligibleVehicles.length > 0 ? (
            <Card className="border border-accent/30 bg-accent/5">
              <CardContent className="gap-3 p-4">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-0.5">
                    <Text className="font-bold text-sm">
                      {maintenancePlan?.name}
                    </Text>
                    <Text className="text-[11px] leading-4 text-muted-foreground">
                      Replace the one-time {maintenanceIncludedServiceNames} with
                      member pricing. Cancel anytime.
                    </Text>
                  </View>
                  <Badge variant="accent" size="sm" label="Club" />
                </View>

                {maintenanceEligibleVehicles.map((candidate) => (
                  <Switch
                    key={candidate.vehicle.key}
                    label={candidate.vehicle.label}
                    description={`$${candidate.planPrice.toFixed(
                      2,
                    )}/month · save $${candidate.savings.toFixed(
                      2,
                    )} vs one-time`}
                    value={Boolean(
                      subscriptionSelections[candidate.vehicle.key],
                    )}
                    onValueChange={(checked) =>
                      setSubscriptionSelections((prev) => ({
                        ...prev,
                        [candidate.vehicle.key]: checked,
                      }))
                    }
                  />
                ))}

                {availableFrequencies.length > 1 ? (
                  <View className="flex-row gap-2">
                    {availableFrequencies.map((frequency) => (
                      <Pressable
                        key={frequency}
                        accessibilityRole="button"
                        onPress={() => setSubscriptionFrequency(frequency)}
                        className={`flex-1 rounded-xl border px-3 py-2 ${
                          effectiveSubscriptionFrequency === frequency
                            ? "border-accent bg-accent/10"
                            : "border-border bg-card"
                        }`}
                      >
                        <Text
                          className={`text-center text-xs font-bold ${
                            effectiveSubscriptionFrequency === frequency
                              ? "text-accent"
                              : "text-foreground"
                          }`}
                        >
                          {frequency === "monthly" ? "Monthly" : "Biweekly"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {maintenanceSelected ? (
                  <View className="gap-1 rounded-xl border border-border bg-card p-3">
                    <Text className="text-xs font-semibold text-muted-foreground">
                      Membership due today
                    </Text>
                    <Text className="text-xl font-extrabold text-accent">
                      ${maintenanceTotalPerCycle.toFixed(2)}
                    </Text>
                    <Text className="text-[11px] text-muted-foreground">
                      Then ${maintenanceTotalPerCycle.toFixed(2)} each{" "}
                      {effectiveSubscriptionFrequency === "monthly"
                        ? "month"
                        : "two weeks"}
                      . Includes pet and travel fees.
                    </Text>
                  </View>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {!maintenanceSelected ? (
            <>
              {/* Compact Payment Option Tabs */}
          <View className="gap-1.5">
            <Text className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Payment Option
            </Text>

            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() => setPaymentOption("deposit")}
                className={`flex-1 items-center justify-center rounded-xl py-2 px-1.5 border ${
                  paymentOption === "deposit"
                    ? "border-accent bg-accent/15"
                    : "border-border bg-card active:bg-secondary/40"
                }`}
              >
                <Text
                  className={`font-bold text-xs ${
                    paymentOption === "deposit" ? "text-accent" : "text-foreground"
                  }`}
                >
                  Pay Deposit
                </Text>
                <Text className="text-[10px] text-muted-foreground mt-0.5">
                  ${depositTotal.toFixed(2)} today
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => setPaymentOption("full")}
                className={`flex-1 items-center justify-center rounded-xl py-2 px-1.5 border ${
                  paymentOption === "full"
                    ? "border-accent bg-accent/15"
                    : "border-border bg-card active:bg-secondary/40"
                }`}
              >
                <Text
                  className={`font-bold text-xs ${
                    paymentOption === "full" ? "text-accent" : "text-foreground"
                  }`}
                >
                  Pay in Full
                </Text>
                <Text className="text-[10px] text-muted-foreground mt-0.5">
                  ${finalTotal.toFixed(2)} today
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => setPaymentOption("in_person")}
                className={`flex-1 items-center justify-center rounded-xl py-2 px-1.5 border ${
                  paymentOption === "in_person"
                    ? "border-accent bg-accent/15"
                    : "border-border bg-card active:bg-secondary/40"
                }`}
              >
                <Text
                  className={`font-bold text-xs ${
                    paymentOption === "in_person" ? "text-accent" : "text-foreground"
                  }`}
                >
                  Pay at Service
                </Text>
                <Text className="text-[10px] text-muted-foreground mt-0.5">
                  ${depositTotal.toFixed(2)} hold
                </Text>
              </Pressable>
            </View>

            <Text className="text-[11px] text-muted-foreground px-0.5">
              {paymentOption === "deposit"
                ? `Pay $${depositTotal.toFixed(2)} deposit now. Remaining $${Math.max(0, finalTotal - depositTotal).toFixed(2)} invoiced after service.`
                : paymentOption === "full"
                  ? `Pay full $${finalTotal.toFixed(2)} upfront securely via Stripe.`
                  : `Pay $${depositTotal.toFixed(2)} deposit now. Pay remaining $${Math.max(0, finalTotal - depositTotal).toFixed(2)} via cash or card at appointment.`}
            </Text>
          </View>
            </>
          ) : null}

          {/* Notification Preferences */}
          <Switch
            label="SMS Arrival Updates"
            description="Live text alerts when your technician is en route."
            value={smsOptIn}
            onValueChange={setSmsOptIn}
          />
          <Switch
            label="Email me occasional offers"
            description="Maintenance tips, member offers, and seasonal promotions. Unsubscribe anytime."
            value={marketingEmails}
            onValueChange={setMarketingEmails}
          />

          {/* Final Submit Button */}
          <Button
            size="lg"
            disabled={isLoading}
            onPress={handleSubmitBooking}
            className="w-full flex-row items-center justify-center gap-2 mt-1 mb-8"
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={THEME.light.primaryForeground} />
            ) : (
              <>
                <Text className="font-bold text-primary-foreground">
                  {maintenanceSelected
                    ? `Start Membership · $${finalTotal.toFixed(2)} today`
                    : paymentOption === "full"
                      ? `Pay $${finalTotal.toFixed(2)} & Book`
                      : `Pay $${depositTotal.toFixed(2)} Deposit & Book`}
                </Text>
                <CheckCircle2 size={18} color={THEME.light.primaryForeground} />
              </>
            )}
          </Button>
        </View>
      ) : null}
    </Screen>
  );
}
