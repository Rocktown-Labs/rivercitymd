"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import { motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { GiftCardsSection } from "@/components/gift-cards/gift-cards-section";

type LandingPricingService = {
  _id: string;
  name: string;
  description?: string;
  icon?: string;
  features?: string[];
  categorySlug: string;
  categoryName: string;
  bookingRole: "core" | "upgrade" | "addon";
  startingPrice: number;
  minDuration: number;
  vehiclePrices: Array<{
    vehicleTypeId: string;
    vehicleTypeName: string;
    price: number;
    duration: number;
  }>;
};

type LandingPricingCategory = {
  slug: string;
  name: string;
  displayOrder: number;
  services: LandingPricingService[];
};

type LandingPricingResult = {
  categories: LandingPricingCategory[];
  addons: LandingPricingService[];
};

function pluralizeVehicleType(name: string) {
  if (name.endsWith("s")) return name;
  return `${name}s`;
}

const ADDON_GROUPS = [
  { slug: "interior", name: "Interior" },
  { slug: "exterior", name: "Exterior" },
] as const;

function getAddonGroupSlug(addon: LandingPricingService) {
  return addon.categorySlug === "interior" ? "interior" : "exterior";
}

export function PricingSection() {
  const router = useRouter();
  const pricingQuery = useQuery(api.services.listLandingPagePricing) as
    | LandingPricingResult
    | undefined
    | null;
  const bookingReadiness = useQuery(
    api.setupReadiness.getPublicBookingReadiness,
  );

  const [selectedCategorySlug, setSelectedCategorySlug] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!pricingQuery?.categories.length) return;
    const hasSelected = pricingQuery.categories.some(
      (group) => group.slug === selectedCategorySlug,
    );
    if (!hasSelected) {
      setSelectedCategorySlug(pricingQuery.categories[0].slug);
    }
  }, [pricingQuery, selectedCategorySlug]);

  const selectedGroup =
    pricingQuery?.categories.find((group) => group.slug === selectedCategorySlug) ??
    pricingQuery?.categories[0];
  const mainServices = selectedGroup?.services ?? [];
  const addons = pricingQuery?.addons ?? [];
  const addonGroups = ADDON_GROUPS.map((group) => ({
    ...group,
    services: addons.filter((addon) => getAddonGroupSlug(addon) === group.slug),
  })).filter((group) => group.services.length > 0);
  const visibleCardCount = Math.min(mainServices.length, 4);
  const cardGridClass = cn(
    "flex snap-x gap-4 overflow-x-auto pb-3 md:grid md:justify-center md:overflow-visible",
    visibleCardCount === 1 &&
      "justify-center md:grid-cols-[minmax(0,17.5rem)]",
    visibleCardCount === 2 &&
      "justify-center md:grid-cols-[repeat(2,minmax(0,17.5rem))]",
    visibleCardCount === 3 &&
      "md:grid-cols-[repeat(2,minmax(0,17.5rem))] lg:grid-cols-[repeat(3,minmax(0,17.5rem))]",
    visibleCardCount >= 4 && "md:grid-cols-2 lg:grid-cols-4",
  );

  const handleBookNow = () => {
    if (bookingReadiness && !bookingReadiness.isReady) {
      router.push("/sign-up");
      return;
    }
    if (bookingReadiness === undefined) return;
    router.push("/book");
  };

  // Loading state
  if (pricingQuery === undefined) {
    return (
      <section
        id="pricing"
        className="py-24 bg-gradient-to-b from-background to-secondary/20"
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <Skeleton className="h-10 w-80 mx-auto mb-4" />
            <Skeleton className="h-5 w-64 mx-auto mb-8" />
            <Skeleton className="h-10 w-56 mx-auto" />
          </div>
          {/* Skeleton cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 max-w-6xl mx-auto">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
                  <div className="h-0.5 w-full bg-border/50" />
                  <div className="p-5 space-y-3">
                    <Skeleton className="h-5 w-36 mx-auto" />
                    <Skeleton className="h-3 w-48 mx-auto" />
                    <Skeleton className="h-8 w-20 mx-auto mt-2" />
                    <Skeleton className="h-3 w-16 mx-auto" />
                    <div className="pt-2 border-t border-border/30 grid grid-cols-2 gap-1.5">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <Skeleton key={j} className="h-3 w-full" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Error state
  if (pricingQuery === null) {
    return (
      <section
        id="pricing"
        className="py-24 bg-gradient-to-b from-background to-secondary/20"
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-4xl font-bold mb-4">Unable to load services</h2>
            <p className="text-muted-foreground">Please try again later.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section
        id="pricing"
        className="py-24 bg-gradient-to-b from-background to-secondary/20"
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto mb-12"
          >
            <h2 className="text-4xl sm:text-5xl font-bold mb-4 text-balance">
              Transparent pricing for quality service
            </h2>
            <p className="text-lg text-muted-foreground mb-2">
              Mobile detailing packages matched to your vehicles
            </p>
            <p className="text-sm text-muted-foreground">
              Choose a category to compare packages and vehicle pricing.
            </p>
          </motion.div>

          {/* Service Category Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="max-w-xl mx-auto mb-10"
          >
            <p className="text-center text-sm text-muted-foreground mb-5">
              Select a service category
            </p>
            <div
              role="tablist"
              className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border/40 bg-secondary/40 p-1"
            >
              {pricingQuery.categories.map((category) => (
                <button
                  key={category.slug}
                  role="tab"
                  aria-selected={selectedGroup?.slug === category.slug}
                  onClick={() => setSelectedCategorySlug(category.slug)}
                  className={cn(
                    "min-w-28 flex-1 whitespace-nowrap rounded-md px-3 py-2.5 text-xs sm:text-sm font-medium transition-colors outline-none focus-visible:outline-none",
                    selectedGroup?.slug === category.slug
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Cards */}
          <div className="max-w-6xl mx-auto">
            {mainServices.length === 0 ? (
              <div className="mx-auto max-w-2xl rounded-xl border border-border/40 bg-background px-6 py-10 text-center">
                <h3 className="text-lg font-semibold">
                  Pricing is being updated
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Contact us or start booking to see the best options for your
                  vehicle.
                </p>
              </div>
            ) : (
              <div
                className={cardGridClass}
                aria-label="Service pricing cards"
              >
              {mainServices.map((service, index) => {
                return (
                  <motion.div
                    key={service._id}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-50px" }}
                    transition={{ duration: 0.45, delay: index * 0.1 }}
                    className="flex min-w-[280px] snap-start flex-col md:min-w-0"
                  >
                    <div className="relative flex flex-col flex-1 rounded-lg border border-border/40 bg-background overflow-hidden transition-all duration-300 hover:border-border/70 hover:shadow-md group">
                      {/* Top accent strip */}
                      <div className="h-[3px] w-full bg-primary/70 flex-shrink-0" />

                      {/* Header */}
                      <div className="flex min-h-[152px] flex-col justify-between px-5 pt-5 pb-4 text-center">
                        {/* Icon + Title inline */}
                        <div className="mb-2 flex min-h-6 items-center justify-center gap-2">
                          {service.icon && (
                            <span className="text-xl leading-none">
                              {service.icon}
                            </span>
                          )}
                          <h3 className="min-w-0 truncate whitespace-nowrap text-base font-bold leading-tight tracking-normal sm:text-[17px]">
                            {service.name}
                          </h3>
                        </div>

                        <p className="mx-auto line-clamp-3 min-h-10 max-w-[15rem] text-xs leading-snug text-muted-foreground">
                          {service.description}
                        </p>

                        {/* Price */}
                        <div className="mt-4 flex min-h-9 items-baseline justify-center gap-0.5">
                          <span className="mr-1 text-xs font-medium uppercase text-muted-foreground">
                            From
                          </span>
                          <span className="text-sm font-medium text-muted-foreground">
                            $
                          </span>
                          <span className="text-3xl font-bold text-foreground tracking-tight">
                            {service.startingPrice.toFixed(0)}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground">
                            .00
                          </span>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="mx-5 h-px bg-border/40" />

                      <div className="min-h-[120px] px-5 py-4">
                        <div className="space-y-2">
                          {service.vehiclePrices.slice(0, 6).map((price) => (
                            <div
                              key={`${service._id}-${price.vehicleTypeId}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="min-w-0 truncate text-muted-foreground">
                                {pluralizeVehicleType(price.vehicleTypeName)}
                              </span>
                              <span className="font-semibold text-foreground">
                                ${price.price.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Features */}
                      {service.features && service.features.length > 0 && (
                        <div className="mx-5 flex-1 border-t border-border/40 py-4">
                          <p className="mb-3 text-xs font-semibold leading-none text-foreground">
                            Includes:
                          </p>
                          <ul className="grid grid-cols-2 gap-1.5">
                            {service.features.map((feature, i) => (
                              <li
                                key={i}
                                className="inline-flex min-h-5 items-center justify-center rounded-md bg-primary px-2 py-1 text-center text-[9px] font-semibold leading-[1.05] text-primary-foreground"
                              >
                                <span className="break-words">
                                  {feature}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Mobile book button */}
                      <div className="px-5 pb-5 pt-0 mt-auto sm:hidden">
                        <Button
                          className="w-full h-8 text-xs"
                          variant="outline"
                          disabled={bookingReadiness === undefined}
                          onClick={handleBookNow}
                        >
                          Select {service.name}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              </div>
            )}
          </div>

          {/* Desktop CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-center mt-10 sm:mt-14"
          >
            <Button
              size="lg"
              disabled={bookingReadiness === undefined}
              onClick={handleBookNow}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-lg rounded-lg shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              <Calendar className="w-5 h-5 mr-2" />
              Book Appointment
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">
              A deposit is required to secure your appointment.
            </p>
          </motion.div>

          {addons.length > 0 && (
            <div className="mx-auto mt-12 max-w-6xl rounded-lg border border-border/40 bg-background p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
                <div>
                  <h3 className="text-xl font-bold">Add-ons</h3>
                  <p className="text-sm text-muted-foreground">
                    Extra services available with eligible packages.
                  </p>
                </div>
                <span className="rounded-full border border-border/50 px-3 py-1 text-xs font-medium text-muted-foreground">
                  Starting prices
                </span>
              </div>
              <div className="space-y-6">
                {addonGroups.map((group) => (
                  <section key={group.slug} className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold">{group.name}</h4>
                      <span className="text-xs text-muted-foreground">
                        {group.services.length} option{group.services.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {group.services.map((addon) => (
                        <div
                          key={addon._id}
                          className="flex items-start justify-between gap-4 rounded-md border border-border/40 bg-secondary/20 p-4"
                        >
                          <div className="min-w-0">
                            <h5 className="text-sm font-semibold leading-tight">
                              {addon.name}
                            </h5>
                            {addon.description ? (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {addon.description}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-sm font-bold text-primary">
                            ${addon.startingPrice.toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          <GiftCardsSection />
        </div>
      </section>
    </>
  );
}
