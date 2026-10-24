"use client";

import type React from "react";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Plus } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { useAuth, useUser } from "@clerk/nextjs";
import { completeOnboarding } from "./_actions";
import {
  VehicleLookupCard,
  type VehicleClassification,
  type VehicleLookupValue,
} from "@/components/forms/vehicle-lookup-card";
import AddressInput from "@/components/ui/address-input";

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

interface RadarAddress {
  formattedAddress?: string;
  addressLabel?: string;
  number?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

type Vehicle = {
  year: string;
  make: string;
  model: string;
  color?: string;
  size?: "small" | "medium" | "large";
  vehicleTypeId?: string;
  vehicleTypeName?: string;
  classification?: VehicleClassification;
};

function OnboardingWithClerk() {
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken } = useAuth();
  const userRole = useQuery(api.auth.getUserRole);
  const createUserProfile = useMutation(api.users.createUserProfile);
  const currentUser = useQuery(api.auth.getCurrentUser);

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read step from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stepParam = urlParams.get("step");
    if (stepParam && !isNaN(Number(stepParam))) {
      const stepNumber = Math.max(1, Math.min(2, Number(stepParam)));
      setStep(stepNumber);
    }
  }, []);

  // Step 1: Personal Info
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [hasEditedName, setHasEditedName] = useState(false);

  // Auto-populate email from auth system
  // Use Clerk's useUser hook first (works for new users), fallback to Convex query
  useEffect(() => {
    if (user?.emailAddresses?.[0]?.emailAddress) {
      setEmail(user.emailAddresses[0].emailAddress);
    } else if (currentUser?.email) {
      setEmail(currentUser.email);
    }
  }, [user, currentUser]);

  useEffect(() => {
    if (hasEditedName) return;

    const clerkName =
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    const fallbackName = clerkName || currentUser?.name || "";
    if (fallbackName) {
      setName(fallbackName);
    }
  }, [user, currentUser, hasEditedName]);

  // Service Address
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");

  const handleAddressSelect = useCallback((address: RadarAddress) => {
    const streetNumber = address.number || "";
    const streetName = address.street || "";
    const fullStreet = streetNumber
      ? `${streetNumber} ${streetName}`.trim()
      : streetName || address.formattedAddress || address.addressLabel || "";

    setStreet(fullStreet);
    setCity(address.city || "");
    setState(address.state || "");
    setZipCode(address.postalCode || "");
  }, []);

  // Step 2: Vehicles
  const [vehicles, setVehicles] = useState<Vehicle[]>([
    { year: "", make: "", model: "" },
  ]);

  const addVehicle = () => {
    setVehicles([...vehicles, { year: "", make: "", model: "" }]);
  };

  const removeVehicle = (index: number) => {
    if (vehicles.length > 1) {
      setVehicles(vehicles.filter((_, i) => i !== index));
      return;
    }
    setVehicles([{ year: "", make: "", model: "" }]);
  };

  const updateVehicle = (index: number, nextVehicle: VehicleLookupValue) => {
    if (
      /^\d{4}$/.test(nextVehicle.year) &&
      nextVehicle.make &&
      nextVehicle.model
    ) {
      setError(null);
    }
    setVehicles(
      vehicles.map((vehicle, vehicleIndex) =>
        vehicleIndex === index
          ? {
              ...vehicle,
              year: nextVehicle.year,
              make: nextVehicle.make,
              model: nextVehicle.model,
              color: nextVehicle.color,
              size: nextVehicle.size,
              vehicleTypeId: nextVehicle.vehicleTypeId,
              vehicleTypeName: nextVehicle.vehicleTypeName,
              classification: nextVehicle.classification,
            }
          : vehicle,
      ),
    );
  };

  const handleNext = () => {
    setError(null);
    if (step === 1) {
      if (!name.trim() || !email.trim() || !phone.trim()) {
        setError("Please fill in all fields");
        return;
      }
      if (!street.trim() || !city.trim() || !state.trim() || !zipCode.trim()) {
        setError("Please select your service address");
        return;
      }
      const newStep = 2;
      setStep(newStep);
      updateUrlStep(newStep);
    }
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) {
      const newStep = step - 1;
      setStep(newStep);
      updateUrlStep(newStep);
    }
  };

  const updateUrlStep = (stepNumber: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", stepNumber.toString());
    window.history.replaceState({}, "", url.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate vehicles
    const validVehicles = vehicles.filter(
      (v) => /^\d{4}$/.test(v.year) && v.make && v.model,
    );

    if (validVehicles.length === 0) {
      setError("Please search for and select at least one vehicle");
      return;
    }

    // Ensure user is loaded before proceeding
    if (!isUserLoaded || !user) {
      setError("Please wait for your account to load...");
      return;
    }

    setIsLoading(true);

    try {
      // Ensure the Convex JWT template token is available before mutation.
      // This avoids a race right after verification/sign-up in production.
      let convexToken = await getToken({ template: "convex" });
      if (!convexToken) {
        await user.reload();
        convexToken = await getToken({ template: "convex" });
      }

      if (!convexToken) {
        setError(
          "Authentication is still initializing. Please wait a few seconds and try again.",
        );
        return;
      }

      // First, save the profile data to Convex
      await createUserProfile({
        name,
        phone,
        address: {
          street,
          city,
          state,
          zip: zipCode,
        },
        vehicles: validVehicles.map((vehicle) => ({
          year: Number(vehicle.year),
          make: vehicle.make,
          model: vehicle.model,
          color: vehicle.color,
          size: vehicle.size ?? "medium",
          vehicleTypeId: vehicle.vehicleTypeId as Id<"vehicleTypes"> | undefined,
          classification: vehicle.classification,
        })),
      });

      // Then, update Clerk's publicMetadata to mark onboarding as complete
      // Wait for it to complete so we can reload the user token immediately
      const result = await completeOnboarding();
      if (result?.error) {
        console.error("Failed to update Clerk metadata:", result.error);
        // Still allow navigation - Convex record is updated
      }

      // Force a token refresh to get the updated onboardingComplete claim immediately
      // This ensures the middleware sees the updated claim on the next request
      await user.reload();

      // Check user role from Convex (not organization) and navigate accordingly
      // Use window.location.href to force full reload so middleware can redirect properly
      // This ensures proper role-based routing after onboarding
      // Refetch the role query to get the latest role after profile creation
      router.refresh();

      // Small delay to allow query to refetch, then check role
      setTimeout(() => {
        // Re-query the role (the query should have updated by now)
        const currentRole = userRole?.type;
        if (currentRole === "admin") {
          window.location.href = "/admin";
        } else {
          window.location.href = "/dashboard";
        }
      }, 200);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to complete onboarding";
      setError(
        message === "Not authenticated"
          ? "Authentication is still syncing. Please try again in a few seconds."
          : message,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-background p-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Logo and Back Button */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-10 h-10 transition-transform group-hover:scale-105">
              <Image
                src="/BoldRiverCityMobileDetailingLogo.png"
                alt="River City Mobile Detail"
                fill
                className="object-contain"
              />
            </div>
            <span className="font-bold text-lg">River City MD</span>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>

        {/* Progress Indicator */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all ${
                s === step
                  ? "w-12 bg-accent"
                  : s < step
                    ? "w-8 bg-accent/60"
                    : "w-8 bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Onboarding Card */}
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">
              {step === 1 && "Personal Information"}
              {step === 2 && "Your Vehicles"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Tell us who you are and where we'll provide service"}
              {step === 2 && "Tell us about your vehicles"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Step 1: Personal Info */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="John Doe"
                      value={name}
                      onChange={(e) => {
                        setHasEditedName(true);
                        setName(e.target.value);
                      }}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="john@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled
                        className="bg-muted"
                      />
                      <p className="text-xs text-muted-foreground">
                        Email from your account
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="(501) 555-0123"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <AddressInput
                      onAddressSelect={handleAddressSelect}
                      label="Service Address"
                      placeholder="Search for your service address"
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Vehicles */}
              {step === 2 && (
                <div className="space-y-4">
                  {vehicles.map((vehicle, index) => (
                    <VehicleLookupCard
                      key={index}
                      title={`Vehicle ${index + 1}`}
                      value={vehicle}
                      onChange={(nextVehicle) => updateVehicle(index, nextVehicle)}
                      showColor={false}
                      onRemove={() => removeVehicle(index)}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={addVehicle}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Another Vehicle
                  </Button>
                </div>
              )}

              {error && (
                <div className="bg-red-500/20 border-2 border-red-500/50 rounded-md p-3">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex gap-4 pt-4">
                {step > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    className="flex-1"
                    disabled={isLoading}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                )}
                {step < 2 ? (
                  <Button type="button" onClick={handleNext} className="flex-1">
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" className="flex-1" disabled={isLoading}>
                    {isLoading ? "Saving..." : "Complete Setup"}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  if (!clerkPublishableKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Account setup unavailable</CardTitle>
            <CardDescription>
              Account onboarding is not configured in this preview. You can
              still book as a guest, and we&apos;ll email your booking details.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild>
              <Link href="/book">Book as guest</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <OnboardingWithClerk />;
}
