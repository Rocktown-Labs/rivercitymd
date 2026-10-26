import * as React from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/expo";
import { router } from "expo-router";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { isArkansasState } from "@rivercitymd/backend/convex/lib/address";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit2,
  MapPin,
  Phone,
  Plus,
  Sparkles,
  User,
} from "lucide-react-native";

import { BrandMark } from "@/components/brand-mark";
import { Screen, ScreenHeader } from "@/components/screen";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import {
  AddressSearch,
  type AddressValue,
  type TravelQuoteValue,
} from "@/components/forms/address-search";
import { VehicleLookup, type VehicleLookupValue } from "@/components/forms/vehicle-lookup";
import { THEME } from "@/lib/theme";

export default function OnboardingScreen() {
  const { user } = useUser();
  const currentUser = useQuery(api.users.getCurrentUser);
  const createUserProfile = useMutation(api.users.createUserProfile);

  const [step, setStep] = React.useState<1 | 2>(1);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Step 1: Contact & Service Address
  const [name, setName] = React.useState(
    currentUser?.name || user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "",
  );
  const [phone, setPhone] = React.useState(currentUser?.phone || user?.primaryPhoneNumber?.phoneNumber || "");
  const [marketingEmails, setMarketingEmails] = React.useState<boolean | undefined>(undefined);
  const [address, setAddress] = React.useState<AddressValue>({
    street: currentUser?.address?.street || "",
    city: currentUser?.address?.city || "",
    state: currentUser?.address?.state || "AR",
    zip: currentUser?.address?.zip || "",
  });
  const [travelQuote, setTravelQuote] = React.useState<TravelQuoteValue | null>(null);

  const isContactComplete = Boolean(name.trim() && phone.replace(/\D/g, "").length >= 10);
  const isAddressComplete = Boolean(
    address.street.trim() && address.city.trim() && address.state.trim() && address.zip.trim(),
  );

  // Determine initial accordion state
  const [activeAccordion, setActiveAccordion] = React.useState<"contact" | "address" | null>(() => {
    if (!name.trim() || phone.replace(/\D/g, "").length < 10) return "contact";
    if (!address.street.trim() || !address.city.trim()) return "address";
    return null; // Both already complete, keep closed
  });

  // Step 2: Vehicles
  const [vehicles, setVehicles] = React.useState<VehicleLookupValue[]>([
    { year: "", make: "", model: "", size: "medium" },
  ]);
  const [activeVehicleIndex, setActiveVehicleIndex] = React.useState<number | null>(0);

  const addVehicle = () => {
    const nextVehicles = [...vehicles, { year: "", make: "", model: "", size: "medium" as const }];
    setVehicles(nextVehicles);
    setActiveVehicleIndex(nextVehicles.length - 1);
  };

  const removeVehicle = (index: number) => {
    if (vehicles.length > 1) {
      const nextVehicles = vehicles.filter((_, i) => i !== index);
      setVehicles(nextVehicles);
      if (activeVehicleIndex === index) {
        setActiveVehicleIndex(null);
      } else if (activeVehicleIndex !== null && activeVehicleIndex > index) {
        setActiveVehicleIndex(activeVehicleIndex - 1);
      }
    }
  };

  const updateVehicle = (index: number, updated: VehicleLookupValue) => {
    setVehicles(vehicles.map((v, i) => (i === index ? updated : v)));
  };

  const formatPhoneNumber = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const isArkansas = React.useMemo(() => {
    return isArkansasState(address.state);
  }, [address.state]);

  const handleNext = () => {
    setError(null);
    if (step === 1) {
      if (!name.trim()) {
        setActiveAccordion("contact");
        setError("Please enter your full name");
        return;
      }
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) {
        setActiveAccordion("contact");
        setError("Please enter a valid 10-digit mobile phone number");
        return;
      }
      if (!isAddressComplete) {
        setActiveAccordion("address");
        setError("Please select or enter your default service address");
        return;
      }
      setStep(2);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    const validVehicles = vehicles.filter(
      (v) => /^\d{4}$/.test(v.year) && v.make?.trim() && v.model?.trim(),
    );

    if (validVehicles.length === 0) {
      setError("Please add at least one valid vehicle (Year, Make, Model)");
      return;
    }

    setIsLoading(true);
    try {
      await createUserProfile({
        name: name.trim(),
        phone: phone.trim(),
        marketingEmails,
        address: {
          street: address.street.trim(),
          city: address.city.trim(),
          state: address.state.trim().toUpperCase(),
          zip: address.zip.trim(),
        },
        vehicles: validVehicles.map((v) => ({
          year: Number(v.year),
          make: v.make.trim(),
          model: v.model.trim(),
          color: v.color?.trim() || undefined,
          size: v.size ?? "medium",
          vehicleTypeId: v.vehicleTypeId as Id<"vehicleTypes"> | undefined,
          classification: v.classification,
        })),
      });

      // Redirect directly to customer dashboard
      router.replace("/(tabs)");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save profile";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <BrandMark />
          <View className="gap-0.5">
            <Text className="text-xs font-bold tracking-wider text-muted-foreground">
              RiverCityMD
            </Text>
            <Text className="text-base font-semibold">Account Setup</Text>
          </View>
        </View>
        <Text className="text-xs font-bold text-accent">Step {step} of 2</Text>
      </View>

      {/* Progress Bars */}
      <View className="flex-row gap-2">
        <View className={`h-1.5 flex-1 rounded-full ${step >= 1 ? "bg-accent" : "bg-muted"}`} />
        <View className={`h-1.5 flex-1 rounded-full ${step >= 2 ? "bg-accent" : "bg-muted"}`} />
      </View>

      <ScreenHeader
        eyebrow={step === 1 ? "Personal & Service Details" : "Your Garage"}
        title={step === 1 ? "Let's get you set up" : "Add your vehicle(s)"}
        description={
          step === 1
            ? "We bring showroom-level detailing right to your driveway."
            : "Tell us about your cars so we can tailor the right packages and sizing."
        }
      />

      {error ? (
        <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
          <Text className="text-xs font-medium text-destructive">{error}</Text>
        </View>
      ) : null}

      {step === 1 ? (
        <View className="gap-3">
          {/* ACCORDION 1: Personal & Contact Information */}
          <Card className="border border-border overflow-hidden">
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveAccordion(activeAccordion === "contact" ? null : "contact")}
              className="flex-row items-center justify-between p-4 bg-card active:bg-secondary/40"
            >
              <View className="flex-row items-center gap-3 flex-1">
                <View
                  className={`h-7 w-7 items-center justify-center rounded-full ${
                    isContactComplete ? "bg-emerald-600" : "bg-accent/10"
                  }`}
                >
                  {isContactComplete ? (
                    <Check size={14} color="#fff" />
                  ) : (
                    <Text className="text-xs font-bold text-accent">1</Text>
                  )}
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-sm">Contact Information</Text>
                  {activeAccordion !== "contact" && isContactComplete ? (
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {name} · {phone}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View className="flex-row items-center gap-1.5">
                {activeAccordion !== "contact" && isContactComplete ? (
                  <Badge variant="success" size="sm" label="Saved" />
                ) : null}
                {activeAccordion === "contact" ? (
                  <ChevronUp size={18} color={THEME.light.mutedForeground} />
                ) : (
                  <ChevronDown size={18} color={THEME.light.mutedForeground} />
                )}
              </View>
            </Pressable>

            {activeAccordion === "contact" ? (
              <CardContent className="gap-3 p-4 pt-0 border-t border-border/50">
                <Input
                  label="Full Name"
                  placeholder="John Doe"
                  value={name}
                  onChangeText={setName}
                  leftIcon={<User size={18} color={THEME.light.mutedForeground} />}
                />
                <Input
                  label="Mobile Phone Number"
                  placeholder="(501) 555-0123"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(t) => setPhone(formatPhoneNumber(t))}
                  helperText="Used for technician arrival alerts and service updates."
                />

                {isContactComplete ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => setActiveAccordion("address")}
                    className="flex-row items-center justify-center gap-1.5 self-end mt-1"
                  >
                    <Text className="text-xs font-bold">Next: Service Address</Text>
                    <ArrowRight size={14} color={THEME.light.foreground} />
                  </Button>
                ) : null}
              </CardContent>
            ) : null}
          </Card>

          {/* ACCORDION 2: Service Address */}
          <Card className="border border-border overflow-hidden">
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveAccordion(activeAccordion === "address" ? null : "address")}
              className="flex-row items-center justify-between p-4 bg-card active:bg-secondary/40"
            >
              <View className="flex-row items-center gap-3 flex-1">
                <View
                  className={`h-7 w-7 items-center justify-center rounded-full ${
                    isAddressComplete ? "bg-emerald-600" : "bg-accent/10"
                  }`}
                >
                  {isAddressComplete ? (
                    <Check size={14} color="#fff" />
                  ) : (
                    <Text className="text-xs font-bold text-accent">2</Text>
                  )}
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-sm">Default Service Address</Text>
                  {activeAccordion !== "address" && isAddressComplete ? (
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {address.street}, {address.city}, {address.state}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View className="flex-row items-center gap-1.5">
                {activeAccordion !== "address" && isAddressComplete ? (
                  <Badge variant="success" size="sm" label="Saved" />
                ) : null}
                {activeAccordion === "address" ? (
                  <ChevronUp size={18} color={THEME.light.mutedForeground} />
                ) : (
                  <ChevronDown size={18} color={THEME.light.mutedForeground} />
                )}
              </View>
            </Pressable>

            {activeAccordion === "address" ? (
              <CardContent className="p-4 pt-1 border-t border-border/50">
                <AddressSearch
                  value={address}
                  onChange={setAddress}
                  onTravelQuoteChange={setTravelQuote}
                  onSelectAddress={() => {
                    // Auto-close Step 2 accordion once address is chosen
                    setActiveAccordion(null);
                  }}
                  label=""
                  showNotes={false}
                  hideTravelFeeCard={true}
                />
              </CardContent>
            ) : null}
          </Card>

          {/* STANDALONE TRAVEL FEE & AREA STATUS (Shows after address is selected and closed) */}
          {isAddressComplete && activeAccordion !== "address" ? (
            <View className="pt-1">
              {isArkansas ? (
                travelQuote && travelQuote.fee > 0 ? (
                  <View className="rounded-2xl border border-sky-300/40 bg-sky-500/10 p-3.5 gap-1">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <CheckCircle2 size={16} color="#0284c7" />
                        <Text className="font-bold text-xs text-sky-900 dark:text-sky-200">
                          {travelQuote.distanceMiles > 60
                            ? "Arkansas service area confirmed"
                            : "Travel fee applies"}
                        </Text>
                      </View>
                      <Badge variant="accent" size="sm" label={`$${travelQuote.fee.toFixed(2)}`} />
                    </View>
                    <Text className="text-xs text-sky-950/80 dark:text-sky-100/80 leading-4">
                      We can service this Arkansas address ({travelQuote.distanceMiles.toFixed(1)} miles from Little Rock).
                    </Text>
                  </View>
                ) : (
                  <View className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex-row items-center gap-2">
                    <CheckCircle2 size={16} color="#16a34a" />
                    <Text className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                      Standard Little Rock service area (No travel fee)
                    </Text>
                  </View>
                )
              ) : (
                <View className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 gap-1">
                  <View className="flex-row items-center gap-2">
                    <AlertTriangle size={16} color="#d97706" />
                    <Text className="font-bold text-xs text-amber-900 dark:text-amber-200">
                      Out-of-Arkansas Coverage
                    </Text>
                  </View>
                  <Text className="text-xs text-amber-950/80 dark:text-amber-100/80 leading-4">
                    This address appears to be outside Arkansas. Service requires manual confirmation.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          <Switch
            label="Email me occasional offers"
            description="Maintenance tips, member offers, and seasonal promotions. Unsubscribe anytime."
            value={marketingEmails ?? false}
            onValueChange={setMarketingEmails}
          />

          {/* Continue Button */}
          <Button
            variant="default"
            size="lg"
            onPress={handleNext}
            className="w-full flex-row items-center justify-center gap-2 mt-1"
          >
            <Text className="font-bold text-primary-foreground">Continue to Vehicles</Text>
            <ArrowRight size={18} color={THEME.light.primaryForeground} />
          </Button>
        </View>
      ) : (
        <View className="gap-3.5">
          {vehicles.map((vehicle, index) => (
            <VehicleLookup
              key={index}
              title={`Vehicle ${index + 1}`}
              value={vehicle}
              onChange={(updated) => updateVehicle(index, updated)}
              onRemove={vehicles.length > 1 ? () => removeVehicle(index) : undefined}
              isExpanded={activeVehicleIndex === index}
              onToggleExpanded={() =>
                setActiveVehicleIndex(activeVehicleIndex === index ? null : index)
              }
              onSelectVehicle={() => {
                setActiveVehicleIndex(null);
              }}
            />
          ))}

          <Button
            variant="outline"
            onPress={addVehicle}
            className="flex-row items-center justify-center gap-2 border-dashed py-3"
          >
            <Plus size={16} color={THEME.light.foreground} />
            <Text className="font-semibold text-sm">Add Another Vehicle</Text>
          </Button>

          {/* Navigation Buttons */}
          <View className="flex-row gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              onPress={() => setStep(1)}
              disabled={isLoading}
              className="flex-1"
            >
              <ArrowLeft size={18} color={THEME.light.foreground} />
              <Text className="font-semibold">Back</Text>
            </Button>

            <Button
              variant="default"
              size="lg"
              onPress={handleSubmit}
              disabled={isLoading}
              className="flex-2"
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={THEME.light.primaryForeground} />
              ) : (
                <>
                  <Text className="font-bold text-primary-foreground">Complete Setup</Text>
                  <CheckCircle2 size={18} color={THEME.light.primaryForeground} />
                </>
              )}
            </Button>
          </View>
        </View>
      )}
    </Screen>
  );
}
