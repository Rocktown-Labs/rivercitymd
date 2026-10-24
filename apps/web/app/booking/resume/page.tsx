"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { useBookingStore } from "@/hooks/use-booking-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateStringLong, formatTime12h } from "@/lib/time";

function getVehicleTypeFromSize(size?: "small" | "medium" | "large") {
  switch (size) {
    case "small":
      return "car" as const;
    case "large":
      return "truck" as const;
    default:
      return "suv" as const;
  }
}

type DraftVehicle = {
  year: string;
  make: string;
  model: string;
  size?: "small" | "medium" | "large";
  color?: string;
  licensePlate?: string;
};

export default function BookingResumePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const recovery = searchParams.get("recovery");
  const resumeCheckout = useAction(api.payments.resumeBookingDraftCheckout);
  const trackRecoveryClick = useMutation(api.bookingDrafts.trackRecoveryClick);
  const trackedRecoveryRef = useRef(false);
  const draftContext = useQuery(api.bookingDrafts.getPublicContext, token ? { token } : "skip");
  const { hydrateFromDraft } = useBookingStore();
  const [status, setStatus] = useState<"idle" | "loading" | "requires_new_time" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !recovery || trackedRecoveryRef.current) {
      return;
    }
    trackedRecoveryRef.current = true;
    void trackRecoveryClick({ token, source: recovery });
  }, [recovery, token, trackRecoveryClick]);

  useEffect(() => {
    if (!token || status !== "idle") {
      return;
    }

    let isCancelled = false;
    setStatus("loading");

    resumeCheckout({
      token,
      origin: window.location.origin,
    })
      .then((result) => {
        if (isCancelled) {
          return;
        }

        if ((result.status === "redirect" || result.status === "converted") && result.url) {
          window.location.href = result.url;
          return;
        }

        if (result.status === "requires_new_time") {
          setStatus("requires_new_time");
          return;
        }

        setStatus("error");
        setError("We couldn't restart checkout for this booking.");
      })
      .catch((resumeError) => {
        if (isCancelled) {
          return;
        }
        setStatus("error");
        setError(
          resumeError instanceof Error
            ? resumeError.message
            : "We couldn't restart checkout for this booking.",
        );
      });

    return () => {
      isCancelled = true;
    };
  }, [resumeCheckout, status, token]);

  const canRehydrate = useMemo(
    () => Boolean(token && draftContext),
    [draftContext, token],
  );

  const handleChooseNewTime = () => {
    if (!token || !draftContext) {
      return;
    }

    hydrateFromDraft({
      token,
      step1Data: {
        scheduledDate: new Date(`${draftContext.scheduledDate}T00:00:00.000Z`),
        scheduledTime: draftContext.scheduledTime,
        street: draftContext.address.street,
        city: draftContext.address.city,
        state: draftContext.address.state,
        zip: draftContext.address.zip,
        locationNotes: draftContext.address.notes,
      },
      step2Data: {
        name: draftContext.name,
        phone: draftContext.phone,
        email: draftContext.email,
        smsOptIn: draftContext.smsOptIn,
        marketingEmails: draftContext.marketingEmails,
      },
      step3Data: {
        vehicles: draftContext.vehicles.map((vehicle: DraftVehicle) => ({
          ...vehicle,
          year: String(vehicle.year),
          type: getVehicleTypeFromSize(vehicle.size),
        })),
      },
      step4Data: {
        serviceIds: draftContext.serviceIds,
      },
    });

    router.push("/book");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-background p-4">
      <Card className="w-full max-w-2xl shadow-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto relative h-12 w-12">
            <Image
              src="/BoldRiverCityMobileDetailingLogo.png"
              alt="River City Mobile Detail"
              fill
              className="object-contain"
            />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl">Resume your booking</CardTitle>
            <CardDescription className="text-base">
              We&apos;re checking whether your original slot is still open.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {draftContext ? (
            <div className="rounded-xl border bg-muted/40 p-5">
              <p className="text-sm font-medium text-muted-foreground">
                {draftContext.serviceNames.join(", ") || "Appointment"} for {draftContext.email}
              </p>
              <p className="mt-2 text-lg font-semibold">
                {formatDateStringLong(draftContext.scheduledDate)} at{" "}
                {formatTime12h(draftContext.scheduledTime)}
              </p>
            </div>
          ) : null}

          {status === "loading" || draftContext === undefined ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Restarting checkout...
            </div>
          ) : null}

          {status === "requires_new_time" ? (
            <div className="space-y-4 rounded-xl border p-5">
              <p className="text-sm text-muted-foreground">
                That original time is no longer available. We saved the rest of your
                details, so you can jump back in and choose a new slot.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="flex-1"
                  onClick={handleChooseNewTime}
                  disabled={!canRehydrate || (draftContext?.existingVehicleIds.length ?? 0) > 0}
                >
                  Choose a new time
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/">Return home</Link>
                </Button>
              </div>
              {(draftContext?.existingVehicleIds.length ?? 0) > 0 ? (
                <p className="text-xs text-muted-foreground">
                  This draft uses a saved vehicle. Sign in and restart from your
                  dashboard if you need to pick a different time.
                </p>
              ) : null}
            </div>
          ) : null}

          {status === "error" ? (
            <div className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <p className="text-sm text-destructive">{error}</p>
              <Button asChild className="w-full">
                <Link href="/">Return home</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
