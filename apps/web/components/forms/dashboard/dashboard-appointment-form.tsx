import React, { useState, useMemo } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { formatDateString, formatTime12h } from "@/lib/time";
import {
  getEffectiveServicePricingForVehicle,
  isServiceAvailableForVehicle,
  normalizeServiceType,
  type ServiceType,
} from "@rivercitymd/backend/convex/lib/pricing";
import { calculateSchedulingDuration } from "@rivercitymd/backend/convex/lib/booking";
import type { VehicleSize } from "@rivercitymd/backend/convex/lib/pricing";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AddressInput from "@/components/ui/address-input";
import { ServiceCard } from "@/components/home/service-card";
import { TimeSlotPicker } from "@/components/home/time-slot-picker";
import {
  ArrowLeft,
  ArrowRight,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  Plus,
} from "lucide-react";
import Link from "next/link";

const TOTAL_STEPS = 4;

const SIZE_LABELS: Record<string, string> = {
  small: "Small",
  medium: "Mid-Size",
  large: "Large",
};

interface DashboardAppointmentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedVehicleId?: string | null;
}

interface RadarAddress {
  formattedAddress?: string;
  addressLabel?: string;
  number?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  addressComponents?: {
    street?: string;
    city?: string;
    locality?: string;
    state?: string;
    region?: string;
    postalCode?: string;
  };
}

type DashboardVehicleOption = {
  _id: Id<"vehicles">;
  year: number;
  make: string;
  model: string;
  color?: string;
  licensePlate?: string;
  size?: "small" | "medium" | "large";
  vehicleTypeId?: Id<"vehicleTypes">;
};

type DashboardServiceOption = {
  _id: Id<"services">;
  name: string;
  description: string;
  serviceType?: ServiceType;
  isActive: boolean;
  basePrice?: number;
  basePriceSmall?: number;
  basePriceMedium?: number;
  basePriceLarge?: number;
  duration?: number;
  durationSmall?: number;
  durationMedium?: number;
  durationLarge?: number;
  vehiclePrices?: Array<{
    vehicleTypeId: Id<"vehicleTypes">;
    price: number;
    isAvailable: boolean;
    duration?: number;
  }>;
  bookableVehicleTypeIds?: Id<"vehicleTypes">[];
  bookableLegacySizes?: Array<"small" | "medium" | "large">;
};

export function DashboardAppointmentForm({
  open,
  onOpenChange,
  preselectedVehicleId,
}: DashboardAppointmentFormProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [readingService, setReadingService] = useState<{
    name: string;
    description: string;
    price: number;
  } | null>(null);

  // Form state
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [packageByVehicle, setPackageByVehicle] = useState<
    Record<string, Id<"services"> | null>
  >({});
  const [extrasByVehicle, setExtrasByVehicle] = useState<
    Record<string, Id<"services">[]>
  >({});
  const [petFeeByVehicle, setPetFeeByVehicle] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedVehicleId, setExpandedVehicleId] = useState<string | null>(
    null,
  );
  const [activeServiceSectionByVehicle, setActiveServiceSectionByVehicle] =
    useState<Record<string, "packages" | "addons" | "subscriptions" | "">>({});
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [addressMode, setAddressMode] = useState<"saved" | "new">("saved");
  const [locationNotes, setLocationNotes] = useState("");
  const [paymentOption, setPaymentOption] = useState<
    "deposit" | "full" | "in_person"
  >("deposit");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [travelQuote, setTravelQuote] = useState<{
    distanceMiles: number;
    fee: number;
    bufferMinutes: number;
  } | null>(null);

  // Queries
  const currentUser = useQuery(api.users.getCurrentUser);
  const userVehicles = useQuery(api.vehicles.getMyVehicles) as
    | DashboardVehicleOption[]
    | undefined;
  const services = useQuery(api.services.list) as
    | DashboardServiceOption[]
    | undefined;
  const petFeeSettings = useQuery(api.petFeeSettings.get);
  const nextBookableDate = useQuery(api.availability.getNextBookableDate, {});

  // Mutations/Actions
  const upsertBookingDraft = useAction(api.bookingDrafts.createOrUpdate);
  const createBookingCheckout = useAction(api.payments.createBookingCheckout);
  const calculateTravelFee = useAction(api.travelFees.calculate);

  const hasSavedAddress = Boolean(
    currentUser?.address?.street?.trim() &&
      currentUser.address.city?.trim() &&
      currentUser.address.state?.trim() &&
      currentUser.address.zip?.trim(),
  );

  const selectSavedAddress = React.useCallback(() => {
    if (!hasSavedAddress || !currentUser?.address) return;
    setStreet(currentUser.address.street);
    setCity(currentUser.address.city);
    setState(currentUser.address.state);
    setZip(currentUser.address.zip);
    setAddressMode("saved");
  }, [currentUser?.address, hasSavedAddress]);

  const selectNewAddress = React.useCallback(() => {
    setStreet("");
    setCity("");
    setState("");
    setZip("");
    setTravelQuote(null);
    setAddressMode("new");
  }, []);

  const handleAddressSelect = React.useCallback((address: RadarAddress) => {
    const components = address.addressComponents;
    const streetName = address.street || components?.street || "";
    const fullStreet = address.number
      ? `${address.number} ${streetName}`.trim()
      : streetName || address.formattedAddress || address.addressLabel || "";

    setStreet(fullStreet);
    setCity(address.city || components?.city || components?.locality || "");
    setState(address.state || components?.state || components?.region || "");
    setZip(address.postalCode || components?.postalCode || "");
  }, []);

  React.useEffect(() => {
    if (!street.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setTravelQuote(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      void calculateTravelFee({
        address: { street, city, state, zip, notes: locationNotes || undefined },
      })
        .then(setTravelQuote)
        .catch(() => setTravelQuote(null));
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [calculateTravelFee, city, locationNotes, state, street, zip]);

  // Pre-fill address when user data loads
  React.useEffect(() => {
    if (!open || street) return;
    if (hasSavedAddress) {
      selectSavedAddress();
    } else {
      setStreet("");
      setCity("");
      setState("");
      setZip("");
      setAddressMode("new");
    }
  }, [hasSavedAddress, open, selectSavedAddress, street]);

  React.useEffect(() => {
    if (currentUser?.notificationPreferences?.operationalSmsConsent?.optedIn) {
      setSmsOptIn(true);
    }
  }, [currentUser?.notificationPreferences?.operationalSmsConsent?.optedIn]);

  // Pre-fill next bookable date
  React.useEffect(() => {
    if (open && nextBookableDate && !scheduledDate) {
      setScheduledDate(nextBookableDate);
    }
  }, [open, nextBookableDate, scheduledDate]);

  // Pre-select vehicle when provided
  React.useEffect(() => {
    if (open && preselectedVehicleId) {
      setSelectedVehicleIds([preselectedVehicleId]);
      setExpandedVehicleId(preselectedVehicleId);
      setCurrentStep(2);
    }
  }, [open, preselectedVehicleId]);

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setCurrentStep(1);
      setSelectedVehicleIds([]);
      setPackageByVehicle({});
      setExtrasByVehicle({});
      setPetFeeByVehicle({});
      setExpandedVehicleId(null);
      setActiveServiceSectionByVehicle({});
      setScheduledDate("");
      setScheduledTime("");
      setLocationNotes("");
      setPaymentOption("deposit");
      if (hasSavedAddress) {
        selectSavedAddress();
      } else {
        selectNewAddress();
      }
    }
  }, [hasSavedAddress, open, selectNewAddress, selectSavedAddress]);

  // Derived state
  const selectedVehicles = useMemo(
    () =>
      (userVehicles ?? []).filter((v) => selectedVehicleIds.includes(v._id)),
    [userVehicles, selectedVehicleIds],
  );

  const getVehiclePricingContext = (vehicle: DashboardVehicleOption) => ({
    vehicleSize: ((vehicle.size as VehicleSize) || "medium") as VehicleSize,
    vehicleTypeId: vehicle.vehicleTypeId ?? null,
  });

  const getVehicleActiveServices = (vehicle: DashboardVehicleOption) =>
    services?.filter((service) =>
      isServiceAvailableForVehicle(service, getVehiclePricingContext(vehicle)),
    ) ?? [];

  const getVehicleOptionalServiceIds = (vehicle: DashboardVehicleOption) => {
    const active = getVehicleActiveServices(vehicle);
    return new Set(
      active
        .filter(
          (s) =>
            normalizeServiceType(s.serviceType) === "addon" ||
            normalizeServiceType(s.serviceType) === "subscription",
        )
        .map((s) => s._id),
    );
  };

  const getVehicleServiceIds = (vehicle: DashboardVehicleOption) => {
    const active = getVehicleActiveServices(vehicle);
    const activeIds = new Set(active.map((s) => s._id));
    const optionalIds = getVehicleOptionalServiceIds(vehicle);
    const extras = (extrasByVehicle[vehicle._id] ?? []).filter((id) =>
      optionalIds.has(id),
    );
    const pkg = packageByVehicle[vehicle._id];
    return pkg && activeIds.has(pkg) ? [pkg, ...extras] : extras;
  };

  const getVehicleServicesTotal = (vehicle: DashboardVehicleOption) =>
    getVehicleServiceIds(vehicle).reduce((sum, serviceId) => {
      const service = getVehicleActiveServices(vehicle).find(
        (s) => s._id === serviceId,
      );
      return service
        ? sum +
            getEffectiveServicePricingForVehicle(
              service,
              getVehiclePricingContext(vehicle),
            ).price
        : sum;
    }, 0);

  const getVehiclePetFee = (vehicle: DashboardVehicleOption) => {
    if (!petFeeByVehicle[vehicle._id]) return 0;
    if (petFeeSettings?.isActive === false) return 0;
    const size = ((vehicle.size as VehicleSize) || "medium") as VehicleSize;
    if (size === "small") {
      return petFeeSettings?.basePriceSmall ?? petFeeSettings?.basePriceMedium ?? 50;
    }
    if (size === "large") {
      return petFeeSettings?.basePriceLarge ?? petFeeSettings?.basePriceMedium ?? 50;
    }
    return petFeeSettings?.basePriceMedium ?? 50;
  };

  const serviceTotal = selectedVehicles.reduce(
    (sum, vehicle) => sum + getVehicleServicesTotal(vehicle),
    0,
  );
  const petFeeTotal = selectedVehicles.reduce(
    (sum, vehicle) => sum + getVehiclePetFee(vehicle),
    0,
  );
  const petFeeVehicleCount = selectedVehicles.filter(
    (v) => petFeeByVehicle[v._id] && petFeeSettings?.isActive !== false,
  ).length;
  const depositTotal = 50 * Math.max(selectedVehicleIds.length, 1);
  const travelFeeTotal = travelQuote?.fee ?? 0;
  const orderTotal = serviceTotal + petFeeTotal + travelFeeTotal;
  const dueNow =
    paymentOption === "full" ? orderTotal : Math.min(depositTotal, orderTotal);
  const schedulingDuration = calculateSchedulingDuration({
    serviceDurations: selectedVehicles.flatMap((vehicle) => {
      const ctx = getVehiclePricingContext(vehicle);
      return getVehicleServiceIds(vehicle).map((serviceId) => {
        const service = getVehicleActiveServices(vehicle).find(
          (s) => s._id === serviceId,
        );
        return service
          ? getEffectiveServicePricingForVehicle(service, ctx).duration
          : 0;
      });
    }),
    petFeeVehicleCount: petFeeVehicleCount,
    petFeeTimeMinutes: petFeeSettings?.timeAddMinutes,
    travelBufferMinutes: travelQuote?.bufferMinutes,
  });

  // Step validation
  const canAdvance = (step: number): boolean => {
    switch (step) {
      case 1:
        return selectedVehicleIds.length > 0;
      case 2:
        return (
          selectedVehicles.length > 0 &&
          selectedVehicles.every((vehicle) => {
            const pkg = packageByVehicle[vehicle._id];
            return !!pkg && getVehicleServiceIds(vehicle).includes(pkg);
          })
        );
      case 3:
        return !!scheduledDate && !!scheduledTime && !!street && !!city && !!state && !!zip;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    if (currentStep < TOTAL_STEPS && canAdvance(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleAddonToggle = (
    vehicleId: string,
    serviceId: Id<"services">,
    selected: boolean,
  ) => {
    setExtrasByVehicle((prev) => {
      const current = prev[vehicleId] ?? [];
      return {
        ...prev,
        [vehicleId]: selected
          ? [...current, serviceId]
          : current.filter((id) => id !== serviceId),
      };
    });
  };

  const onSubmit = async () => {
    if (!currentUser || selectedVehicleIds.length === 0) return;

    setIsLoading(true);
    try {
      const { draftId } = await upsertBookingDraft({
        name: currentUser.name || currentUser.email || "Customer",
        email: currentUser.email || "",
        phone: currentUser.phone || "",
        smsOptIn,
        address: {
          street,
          city,
          state,
          zip,
          notes: locationNotes || undefined,
        },
        existingVehicleIds: selectedVehicleIds as Id<"vehicles">[],
        existingVehicleServices: selectedVehicles.map((vehicle) => ({
          vehicleId: vehicle._id as Id<"vehicles">,
          serviceIds: getVehicleServiceIds(vehicle) as Id<"services">[],
        })),
        petFeeExistingVehicleIds: selectedVehicles
          .filter((vehicle) => petFeeByVehicle[vehicle._id])
          .map((vehicle) => vehicle._id as Id<"vehicles">),
        serviceIds: Array.from(
          new Set(
            selectedVehicles.flatMap((vehicle) => getVehicleServiceIds(vehicle)),
          ),
        ) as Id<"services">[],
        scheduledDate,
        scheduledTime,
        paymentOption,
      });

      const { url } = await createBookingCheckout({
        draftId,
        origin: window.location.origin,
      });

      if (url) {
        window.location.href = url;
      } else {
        throw new Error("Failed to create checkout session");
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to schedule appointment"));
    } finally {
      setIsLoading(false);
    }
  };

  const stepLabels = [
    "Select Vehicle",
    "Choose Services",
    "Date & Location",
    "Review & Pay",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule New Appointment</DialogTitle>
          <DialogDescription>
            Step {currentStep} of {TOTAL_STEPS}: {stepLabels[currentStep - 1]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-1.5 mb-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i + 1 === currentStep
                  ? "bg-primary"
                  : i + 1 < currentStep
                    ? "bg-primary/40"
                    : "bg-muted",
              )}
            />
          ))}
        </div>

        {/* Step 1: Vehicle Selection */}
        {currentStep === 1 && (
          <div className="space-y-4">
            {userVehicles && userVehicles.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Select one or more vehicles — services are chosen per vehicle
                  in the next step.
                </p>
                {userVehicles.map((vehicle) => {
                  const isSelected = selectedVehicleIds.includes(vehicle._id);
                  return (
                    <div
                      key={vehicle._id}
                      onClick={() =>
                        setSelectedVehicleIds((current) =>
                          current.includes(vehicle._id)
                            ? current.filter((id) => id !== vehicle._id)
                            : [...current, vehicle._id],
                        )
                      }
                      className={cn(
                        "group relative flex cursor-pointer rounded-xl border-2 p-4 transition-all duration-200 hover:shadow-md",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-muted hover:border-primary/50",
                      )}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Car className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold">
                            {vehicle.year} {vehicle.make} {vehicle.model}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {vehicle.color && `${vehicle.color} · `}
                            {vehicle.licensePlate && `${vehicle.licensePlate}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {vehicle.size && (
                            <Badge variant="secondary" className="text-xs">
                              {SIZE_LABELS[vehicle.size] || vehicle.size}
                            </Badge>
                          )}
                          <div
                            className={cn(
                              "h-6 w-6 rounded-md border-2 flex items-center justify-center transition-all",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-muted-foreground/30",
                            )}
                          >
                            {isSelected && (
                              <Check className="h-3.5 w-3.5 stroke-[3]" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Car className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No vehicles yet</h3>
                <p className="text-muted-foreground mb-4">
                  Add a vehicle to get started with booking.
                </p>
                <Button asChild>
                  <Link href="/dashboard/vehicles">
                    <Plus className="w-4 h-4 mr-2" />
                    Add a Vehicle
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Service Selection */}
        {currentStep === 2 && (
          <div className="space-y-3">
            {selectedVehicles.map((vehicle, vIdx) => {
              const ctx = getVehiclePricingContext(vehicle);
              const active = getVehicleActiveServices(vehicle);
              const standardServices = active.filter(
                (s) => normalizeServiceType(s.serviceType) === "standard",
              );
              const addonServices = active.filter(
                (s) => normalizeServiceType(s.serviceType) === "addon",
              );
              const subscriptionServices = active.filter(
                (s) => normalizeServiceType(s.serviceType) === "subscription",
              );
              const serviceIds = getVehicleServiceIds(vehicle);
              const selectedPackageId = packageByVehicle[vehicle._id] ?? null;
              const selectedPackage = standardServices.find(
                (s) => s._id === selectedPackageId,
              );
              const selectedPackagePrice = selectedPackage
                ? getEffectiveServicePricingForVehicle(selectedPackage, ctx)
                    .price
                : null;
              const selectedExtrasCount = serviceIds.filter(
                (id) => id !== selectedPackageId,
              ).length;
              const isExpanded = expandedVehicleId === vehicle._id;
              const activeSection =
                activeServiceSectionByVehicle[vehicle._id] || "packages";
              const vehicleTotal = getVehicleServicesTotal(vehicle);

              const renderSectionHeader = (
                sectionKey: "packages" | "addons" | "subscriptions",
                label: string,
                badge: string,
                summary: React.ReactNode,
              ) => (
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-3 bg-muted/20 hover:bg-muted/40 transition-colors font-medium text-sm text-foreground text-left"
                  onClick={() =>
                    setActiveServiceSectionByVehicle((prev) => ({
                      ...prev,
                      [vehicle._id]:
                        (prev[vehicle._id] || "packages") === sectionKey
                          ? ""
                          : sectionKey,
                    }))
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="bg-accent/10 text-accent px-2 py-0.5 rounded text-[10px] font-bold">
                      {badge}
                    </span>
                    {label}
                  </span>
                  <span className="text-muted-foreground text-xs font-normal flex items-center gap-1.5">
                    {summary}
                    {activeSection === sectionKey ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </span>
                </button>
              );

              return (
                <Card
                  key={vehicle._id}
                  className="gap-0 border border-border/60 overflow-hidden py-0"
                >
                  <button
                    type="button"
                    className="w-full text-left focus:outline-none"
                    onClick={() =>
                      setExpandedVehicleId(isExpanded ? null : vehicle._id)
                    }
                  >
                    <CardHeader className="bg-muted/10 border-b border-border/40 hover:bg-muted/20 transition-colors cursor-pointer p-4">
                      <CardTitle className="text-sm font-bold flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {vIdx + 1}. {vehicle.year} {vehicle.make}{" "}
                            {vehicle.model}
                          </span>
                          <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wider bg-muted/35 px-2 py-0.5 rounded-full border border-border/20">
                            {(vehicle.size as string) || "medium"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {vehicleTotal > 0 && (
                            <span className="text-xs font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
                              ${vehicleTotal}
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </CardTitle>
                    </CardHeader>
                  </button>
                  {isExpanded && (
                    <CardContent className="p-3 space-y-2">
                      {/* Section 1: Choose a Package */}
                      <div className="border border-border/40 rounded-lg overflow-hidden">
                        {renderSectionHeader(
                          "packages",
                          "1. Choose Package",
                          "REQUIRED",
                          selectedPackage ? (
                            <span className="text-accent font-semibold">
                              {selectedPackage.name} (${selectedPackagePrice})
                            </span>
                          ) : (
                            <span>Select one</span>
                          ),
                        )}
                        {activeSection === "packages" && (
                          <div className="p-3 border-t border-border/40">
                            <div className="grid grid-cols-1 gap-3">
                              {standardServices.map((service) => (
                                <ServiceCard
                                  key={service._id}
                                  service={service}
                                  vehicleSize={ctx.vehicleSize}
                                  vehicleTypeId={ctx.vehicleTypeId}
                                  isSelected={selectedPackageId === service._id}
                                  onSelect={(selected) => {
                                    setPackageByVehicle((prev) => ({
                                      ...prev,
                                      [vehicle._id]: selected
                                        ? service._id
                                        : null,
                                    }));
                                    if (selected) {
                                      setActiveServiceSectionByVehicle(
                                        (prev) => ({
                                          ...prev,
                                          [vehicle._id]: "addons",
                                        }),
                                      );
                                    }
                                  }}
                                />
                              ))}
                              {standardServices.length === 0 && (
                                <p className="text-sm text-muted-foreground italic">
                                  No packages available for this vehicle.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Section 2: Add-ons */}
                      {addonServices.length > 0 && (
                        <div className="border border-border/40 rounded-lg overflow-hidden">
                          {renderSectionHeader(
                            "addons",
                            "2. Add-ons & Upgrades",
                            "OPTIONAL",
                            selectedExtrasCount > 0 ? (
                              <span className="text-accent font-semibold">
                                {selectedExtrasCount} selected
                              </span>
                            ) : (
                              <span>None</span>
                            ),
                          )}
                          {activeSection === "addons" && (
                            <div className="p-3 border-t border-border/40 grid grid-cols-1 gap-3">
                              {addonServices.map((service) => (
                                <ServiceCard
                                  key={service._id}
                                  service={service}
                                  vehicleSize={ctx.vehicleSize}
                                  vehicleTypeId={ctx.vehicleTypeId}
                                  isSelected={serviceIds.includes(service._id)}
                                  onSelect={(selected) =>
                                    handleAddonToggle(
                                      vehicle._id,
                                      service._id,
                                      selected,
                                    )
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Section 3: Recurring Plans */}
                      {subscriptionServices.length > 0 && (
                        <div className="border border-border/40 rounded-lg overflow-hidden">
                          {renderSectionHeader(
                            "subscriptions",
                            "3. Recurring Plans",
                            "OPTIONAL",
                            serviceIds.some((id) =>
                              subscriptionServices.some((s) => s._id === id),
                            ) ? (
                              <span className="text-accent font-semibold">
                                {
                                  serviceIds.filter((id) =>
                                    subscriptionServices.some(
                                      (s) => s._id === id,
                                    ),
                                  ).length
                                }{" "}
                                selected
                              </span>
                            ) : (
                              <span>None</span>
                            ),
                          )}
                          {activeSection === "subscriptions" && (
                            <div className="p-3 border-t border-border/40 grid grid-cols-1 gap-3">
                              {subscriptionServices.map((service) => (
                                <ServiceCard
                                  key={service._id}
                                  service={service}
                                  vehicleSize={ctx.vehicleSize}
                                  vehicleTypeId={ctx.vehicleTypeId}
                                  isSelected={serviceIds.includes(service._id)}
                                  onSelect={(selected) =>
                                    handleAddonToggle(
                                      vehicle._id,
                                      service._id,
                                      selected,
                                    )
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Per-vehicle pet fee */}
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
                        <div>
                          <p className="text-xs font-medium">
                            Pet hair or pet travel fee
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Adds the pet fee and extra time for this vehicle.
                          </p>
                        </div>
                        <Switch
                          checked={!!petFeeByVehicle[vehicle._id]}
                          onCheckedChange={(checked) =>
                            setPetFeeByVehicle((prev) => ({
                              ...prev,
                              [vehicle._id]: checked,
                            }))
                          }
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}

            {/* Running total */}
            <div className="bg-muted/50 p-3 rounded-lg border border-border/50 flex items-center justify-between">
              <span className="text-sm font-medium">
                Running Total
                {petFeeVehicleCount > 0
                  ? ` · pet fees ×${petFeeVehicleCount}`
                  : ""}
              </span>
              <span className="font-bold text-lg text-primary">
                ${(serviceTotal + petFeeTotal).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Step 3: Date, Time & Location */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Preferred Date</label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => {
                    setScheduledDate(e.target.value);
                    setScheduledTime("");
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Preferred Time</label>
                <TimeSlotPicker
                  date={scheduledDate}
                  selectedTime={scheduledTime}
                  onTimeSelect={setScheduledTime}
                  serviceDuration={schedulingDuration}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium">Service Location</h3>
              <div className="space-y-3">
                {hasSavedAddress && currentUser?.address && addressMode === "saved" ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Saved address</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {currentUser.address.street}
                          <br />
                          {currentUser.address.city}, {currentUser.address.state}{" "}
                          {currentUser.address.zip}
                        </p>
                      </div>
                      <Check className="h-4 w-4 shrink-0" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={selectNewAddress}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Use a different address
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AddressInput
                      onAddressSelect={handleAddressSelect}
                      label="New service address"
                      placeholder="Search for your service address"
                    />
                    {hasSavedAddress && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={selectSavedAddress}
                      >
                        <MapPin className="mr-2 h-4 w-4" />
                        Use saved address
                      </Button>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">
                    Location Notes (Optional)
                  </label>
                  <Textarea
                    value={locationNotes}
                    onChange={(e) => setLocationNotes(e.target.value)}
                    placeholder="Any special instructions for finding the location"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review & Pay */}
        {currentStep === 4 && (
          <div className="space-y-5">
            {/* Summary */}
            <div className="bg-muted/50 p-4 rounded-lg border border-border/50 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">
                  ✓
                </span>
                Order Summary
              </h3>

              {/* Vehicles & Services */}
              {selectedVehicles.map((vehicle) => {
                const ctx = getVehiclePricingContext(vehicle);
                const serviceIds = getVehicleServiceIds(vehicle);
                return (
                  <div
                    key={vehicle._id}
                    className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </span>
                      <span>{(vehicle.size as string) || "medium"}</span>
                    </div>
                    {serviceIds.map((serviceId) => {
                      const service = getVehicleActiveServices(vehicle).find(
                        (s) => s._id === serviceId,
                      );
                      if (!service) return null;
                      const price = getEffectiveServicePricingForVehicle(
                        service,
                        ctx,
                      ).price;
                      const isSubscription =
                        normalizeServiceType(service.serviceType) ===
                        "subscription";
                      return (
                        <div
                          key={serviceId}
                          className="flex justify-between text-sm items-start gap-2"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setReadingService({
                                name: service.name,
                                description:
                                  service.description ||
                                  "No description available.",
                                price,
                              })
                            }
                            className="text-left text-muted-foreground hover:text-primary transition-colors flex items-baseline gap-1.5 focus:outline-none"
                          >
                            <span className="border-b border-dashed border-muted-foreground/40 hover:border-primary">
                              {service.name}
                            </span>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="font-medium text-foreground">
                              ${price.toFixed(2)}
                            </span>
                            {isSubscription && (
                              <span className="text-[10px] text-muted-foreground">
                                /mo
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {getVehiclePetFee(vehicle) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Pet fee</span>
                        <span className="font-medium">
                          ${getVehiclePetFee(vehicle).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                <span>Service Total</span>
                <span>${serviceTotal.toFixed(2)}</span>
              </div>
              {petFeeTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pet fee</span>
                  <span className="font-medium">${petFeeTotal.toFixed(2)}</span>
                </div>
              )}
              {travelFeeTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Travel fee
                    {travelQuote && ` (${travelQuote.distanceMiles.toFixed(1)} miles)`}
                  </span>
                  <span className="font-medium">${travelFeeTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span>${orderTotal.toFixed(2)}</span>
              </div>

              {/* Date/Time */}
              <div className="border-t pt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Date & Time</span>
                <span className="font-medium">
                  {formatDateString(scheduledDate)} at {formatTime12h(scheduledTime)}
                </span>
              </div>

              {/* Location */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium text-right">
                  {street}, {city}, {state} {zip}
                </span>
              </div>
            </div>

            {/* Payment Options */}
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Payment Option</h3>
              <div className="space-y-2">
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    paymentOption === "deposit"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    value="deposit"
                    checked={paymentOption === "deposit"}
                    onChange={() => setPaymentOption("deposit")}
                    className="mt-1 accent-primary"
                  />
                  <div>
                    <span className="font-medium text-sm">
                      Pay Deposit Now
                    </span>
                    <span className="text-xs text-muted-foreground block">
                      ${Math.min(depositTotal, orderTotal).toFixed(2)} deposit now, remaining balance
                      invoiced after service
                    </span>
                  </div>
                </label>
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    paymentOption === "full"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    value="full"
                    checked={paymentOption === "full"}
                    onChange={() => setPaymentOption("full")}
                    className="mt-1 accent-primary"
                  />
                  <div>
                    <span className="font-medium text-sm">
                      Pay Full Price Now
                    </span>
                    <span className="text-xs text-muted-foreground block">
                      ${orderTotal.toFixed(2)} — pay entire amount upfront
                    </span>
                  </div>
                </label>
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    paymentOption === "in_person"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    value="in_person"
                    checked={paymentOption === "in_person"}
                    onChange={() => setPaymentOption("in_person")}
                    className="mt-1 accent-primary"
                  />
                  <div>
                    <span className="font-medium text-sm">
                      Pay Remaining in Person
                    </span>
                    <span className="text-xs text-muted-foreground block">
                      ${Math.min(depositTotal, orderTotal).toFixed(2)} deposit now, pay balance in
                      cash/card at service
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Amount due */}
            <div className="bg-muted/50 p-4 rounded-lg border border-border/50">
              <div className="flex justify-between items-end">
                <div>
                  <span className="font-bold text-base block">
                    {paymentOption === "full"
                      ? "Total Due Now"
                      : "Deposit Due Now"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Secure payment via Stripe
                  </span>
                </div>
                <span className="font-bold text-xl text-primary">
                  ${dueNow.toFixed(2)}
                </span>
              </div>
              {paymentOption !== "full" && (
                <p className="text-xs text-muted-foreground mt-2">
                  This deposit is non-refundable and will be applied to your
                  service total.
                </p>
              )}
              {paymentOption === "in_person" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Remaining balance of $
                  {Math.max(0, orderTotal - depositTotal).toFixed(2)} will be collected
                  in person.
                </p>
              )}
            </div>

            <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-sm">Urgent SMS Updates</p>
                <p className="text-xs text-muted-foreground">
                  Text me about confirmations, reminders, cancellations,
                  reschedules, and when service begins.
                </p>
              </div>
              <Switch checked={smsOptIn} onCheckedChange={setSmsOptIn} />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-4 pt-4 border-t mt-2">
          {currentStep > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={prevStep}
              className="flex-1"
              disabled={isLoading}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          )}
          {currentStep === 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={isLoading}
            >
              Cancel
            </Button>
          )}
          {currentStep < TOTAL_STEPS ? (
            <Button
              type="button"
              onClick={nextStep}
              className="flex-1"
              disabled={!canAdvance(currentStep)}
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSubmit}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Processing...
                </>
              ) : paymentOption === "full" ? (
                "Pay & Book"
              ) : (
                "Pay Deposit & Book"
              )}
            </Button>
          )}
        </div>
        {readingService && (
          <Dialog open={readingService !== null} onOpenChange={(open) => !open && setReadingService(null)}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>{readingService.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2 text-sm">
                <p className="text-muted-foreground leading-relaxed">{readingService.description}</p>
                <div className="font-semibold text-foreground">
                  Price: ${readingService.price.toFixed(2)}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
