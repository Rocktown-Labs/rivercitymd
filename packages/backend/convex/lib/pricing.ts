export type ServiceType = "standard" | "addon" | "subscription";
export type BookingRole = "core" | "upgrade" | "addon";
export type ServiceCategorySlug =
  | "full-detail"
  | "interior"
  | "exterior"
  | "wax-ceramic"
  | "add-ons";
export type VehicleSize = "small" | "medium" | "large";
export const DEFAULT_PET_FEE_AMOUNT = 50;

const SERVICE_CATEGORY_LABELS: Record<ServiceCategorySlug, string> = {
  "full-detail": "Full Detail",
  interior: "Interior",
  exterior: "Exterior",
  "wax-ceramic": "Wax & Ceramic",
  "add-ons": "Add-ons",
};

export type ServiceVehiclePriceShape = {
  vehicleTypeId?: string;
  price: number;
  duration?: number;
  isAvailable: boolean;
  vehicleType?: {
    legacySize?: VehicleSize;
  } | null;
};

type ServicePricingShape = {
  name?: string;
  categoryName?: string;
  categorySlug?: ServiceCategorySlug | string;
  basePrice?: number;
  basePriceSmall?: number;
  basePriceMedium?: number;
  basePriceLarge?: number;
  duration?: number;
  isActive?: boolean;
  serviceType?: ServiceType;
  bookingRole?: BookingRole;
  disallowWhenPetHair?: boolean;
  disallowWhenDirtyMud?: boolean;
  isSubscribable?: boolean;
  subscriptionFrequencies?: Array<"monthly" | "biweekly">;
  vehiclePrices?: ServiceVehiclePriceShape[];
};

type PetFeePricingShape = {
  basePriceSmall?: number;
  basePriceMedium?: number;
  basePriceLarge?: number;
  isActive?: boolean;
} | null;

export function normalizeServiceType(serviceType?: ServiceType): ServiceType {
  return serviceType ?? "standard";
}

function normalizeText(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

export function getServiceCategoryLabel(slug: ServiceCategorySlug): string {
  return SERVICE_CATEGORY_LABELS[slug];
}

export function inferServiceCategorySlug(
  service: Pick<
    ServicePricingShape,
    "name" | "categoryName" | "categorySlug" | "serviceType" | "bookingRole"
  >,
): ServiceCategorySlug {
  if (service.categorySlug && service.categorySlug in SERVICE_CATEGORY_LABELS) {
    return service.categorySlug as ServiceCategorySlug;
  }

  const serviceType = normalizeServiceType(service.serviceType);
  const label = `${service.categoryName ?? ""} ${service.name ?? ""}`.toLowerCase();
  if (serviceType === "addon" || service.bookingRole === "addon") {
    if (
      label.includes("engine bay") ||
      label.includes("interior") ||
      label.includes("leather") ||
      label.includes("steam") ||
      label.includes("pet") ||
      label.includes("odor") ||
      label.includes("stain") ||
      label.includes("carpet") ||
      label.includes("seat")
    ) {
      return "interior";
    }
    if (
      label.includes("ceramic") ||
      label.includes("wax") ||
      label.includes("decon") ||
      label.includes("clay") ||
      label.includes("chrome") ||
      label.includes("muffler") ||
      label.includes("trim") ||
      label.includes("headlight") ||
      label.includes("paint") ||
      label.includes("scratch") ||
      label.includes("correction") ||
      label.includes("wheel") ||
      label.includes("window")
    ) {
      return "exterior";
    }
    return "add-ons";
  }

  if (label.includes("interior")) return "interior";
  if (
    label.includes("exterior") ||
    label.includes("wash") ||
    label.includes("decon")
  ) {
    return "exterior";
  }
  if (
    label.includes("ceramic") ||
    label.includes("wax") ||
    label.includes("paint enhancement") ||
    label.includes("protection")
  ) {
    return "wax-ceramic";
  }
  return "full-detail";
}

export function getServiceBookingRole(
  service: Pick<
    ServicePricingShape,
    "name" | "categoryName" | "categorySlug" | "serviceType" | "bookingRole"
  >,
): BookingRole {
  if (service.bookingRole) return service.bookingRole;
  if (normalizeServiceType(service.serviceType) === "addon") return "addon";
  return inferServiceCategorySlug(service) === "wax-ceramic" ? "upgrade" : "core";
}

export function serviceHasLevelOneName(service: Pick<ServicePricingShape, "name">): boolean {
  const name = normalizeText(service.name);
  return /\blevel\s*1\b/.test(name) || name.includes("basic reset");
}

export function isServiceAllowedForCondition(
  service: Pick<
    ServicePricingShape,
    | "name"
    | "categoryName"
    | "categorySlug"
    | "serviceType"
    | "bookingRole"
    | "disallowWhenPetHair"
    | "disallowWhenDirtyMud"
  >,
  vehicle: { hasPet?: boolean; hasHeavySoil?: boolean },
): boolean {
  const isLevelOne = serviceHasLevelOneName(service);
  const categorySlug = inferServiceCategorySlug(service);
  const disallowWhenPetHair =
    service.disallowWhenPetHair ??
    (isLevelOne && (categorySlug === "full-detail" || categorySlug === "interior"));
  const disallowWhenDirtyMud =
    service.disallowWhenDirtyMud ??
    (isLevelOne && (categorySlug === "full-detail" || categorySlug === "exterior"));

  if (vehicle.hasPet && disallowWhenPetHair) return false;
  if (vehicle.hasHeavySoil && disallowWhenDirtyMud) return false;
  return true;
}

export function getEffectiveServicePrice(
  service: ServicePricingShape,
  vehicleSize: VehicleSize,
): number {
  const fallback = service.basePrice ?? 0;
  if (vehicleSize === "small") {
    return service.basePriceSmall ?? service.basePriceMedium ?? fallback;
  }
  if (vehicleSize === "large") {
    return service.basePriceLarge ?? service.basePriceMedium ?? fallback;
  }
  return service.basePriceMedium ?? fallback;
}

export function getEffectiveServicePricingForVehicle(
  service: ServicePricingShape,
  vehicle: {
    vehicleSize: VehicleSize;
    vehicleTypeId?: string | null;
  },
): {
  price: number;
  duration: number;
  isAvailable: boolean;
} {
  const fallbackDuration = Math.max(0, service.duration ?? 0);
  const rows = service.vehiclePrices ?? [];

  if (rows.length > 0) {
    const exactRow = vehicle.vehicleTypeId
      ? rows.find((row) => row.vehicleTypeId === vehicle.vehicleTypeId)
      : undefined;
    const legacyRow = !vehicle.vehicleTypeId
      ? rows.find(
          (row) => row.vehicleType?.legacySize === vehicle.vehicleSize,
        )
      : undefined;
    const row = exactRow ?? legacyRow;

    if (!row) {
      return { price: 0, duration: fallbackDuration, isAvailable: false };
    }

    const price = Number.isFinite(row.price) ? row.price : 0;
    const duration = Math.max(0, row.duration ?? fallbackDuration);
    return {
      price,
      duration,
      isAvailable: row.isAvailable && price > 0 && duration > 0,
    };
  }

  const price = getEffectiveServicePrice(service, vehicle.vehicleSize);
  return {
    price,
    duration: fallbackDuration,
    isAvailable: service.isActive !== false && price > 0,
  };
}

export function isServiceAvailableForVehicle(
  service: ServicePricingShape,
  vehicle: {
    vehicleSize: VehicleSize;
    vehicleTypeId?: string | null;
  },
): boolean {
  return (
    service.isActive === true &&
    getEffectiveServicePricingForVehicle(service, vehicle).isAvailable
  );
}

export function hasAnyPositiveServicePrice(service: ServicePricingShape): boolean {
  return (
    (service.basePriceSmall ?? 0) > 0 ||
    (service.basePriceMedium ?? 0) > 0 ||
    (service.basePriceLarge ?? 0) > 0 ||
    (service.basePrice ?? 0) > 0
  );
}

export function hasAnyAvailableVehicleTypePrice(
  vehiclePrices?: ServiceVehiclePriceShape[],
): boolean {
  return (
    vehiclePrices?.some(
      (price) =>
        price.isAvailable &&
        Number.isFinite(price.price) &&
        price.price > 0 &&
        (price.duration ?? 0) > 0,
    ) ?? false
  );
}

export function isBookableStandardService(service: ServicePricingShape): boolean {
  const hasVehicleTypeRows = (service.vehiclePrices?.length ?? 0) > 0;
  return (
    service.isActive === true &&
    normalizeServiceType(service.serviceType) === "standard" &&
    (hasVehicleTypeRows
      ? hasAnyAvailableVehicleTypePrice(service.vehiclePrices)
      : hasAnyPositiveServicePrice(service))
  );
}

export function getEffectivePetFeePrice(
  settings: PetFeePricingShape,
  vehicleSize: VehicleSize,
): number {
  if (settings?.isActive === false) {
    return 0;
  }

  const fallback = DEFAULT_PET_FEE_AMOUNT;
  if (vehicleSize === "small") {
    return settings?.basePriceSmall ?? settings?.basePriceMedium ?? fallback;
  }
  if (vehicleSize === "large") {
    return settings?.basePriceLarge ?? settings?.basePriceMedium ?? fallback;
  }
  return settings?.basePriceMedium ?? fallback;
}
