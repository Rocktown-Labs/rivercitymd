"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateStringLong, formatTime12h } from "@/lib/time";

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function buildAuthHref(pathname: "/sign-in" | "/sign-up", token: string, email?: string) {
  const params = new URLSearchParams();
  params.set("redirect_url", `/booking/claim?token=${token}`);
  if (email) {
    params.set("email_address", email);
  }
  return `${pathname}?${params.toString()}`;
}

type BookingSuccessAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
};

function BookingSuccessWithClerk() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <BookingSuccessContent
      auth={{ isLoaded, isSignedIn: Boolean(isSignedIn) }}
    />
  );
}

export default function BookingSuccessPage() {
  if (!clerkPublishableKey) {
    return (
      <BookingSuccessContent
        auth={{
          isLoaded: true,
          isSignedIn: false,
        }}
      />
    );
  }

  return <BookingSuccessWithClerk />;
}

function BookingSuccessContent({
  auth,
}: {
  auth: BookingSuccessAuthState;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = auth;
  const token = searchParams.get("token");
  const draftContext = useQuery(api.bookingDrafts.getPublicContext, token ? { token } : "skip");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!token || !isLoaded || !isSignedIn || !draftContext?.convertedUserId) {
      return;
    }

    router.replace(`/booking/claim?token=${token}`);
  }, [draftContext?.convertedUserId, isLoaded, isSignedIn, router, token]);

  const signInHref = token ? buildAuthHref("/sign-in", token, draftContext?.email) : "/sign-in";
  const signUpHref = token ? buildAuthHref("/sign-up", token, draftContext?.email) : "/sign-up";

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
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 text-green-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl">Booking received</CardTitle>
            <CardDescription className="text-base">
              Your payment went through and we saved your appointment details.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {mounted && token && isLoaded && isSignedIn ? (
            <div className="flex items-center justify-center rounded-xl border bg-muted/40 px-4 py-6 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              You&apos;re already signed in. Finishing your booking...
            </div>
          ) : null}

          {token && draftContext === undefined ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Finalizing your booking details...
            </div>
          ) : draftContext ? (
            <div className="rounded-xl border bg-muted/40 p-5">
              <p className="text-sm font-medium text-muted-foreground">
                {draftContext.serviceNames.join(", ") || "Appointment"} for {draftContext.email}
              </p>
              <p className="mt-2 text-lg font-semibold">
                {formatDateStringLong(draftContext.scheduledDate)} at{" "}
                {formatTime12h(draftContext.scheduledTime)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {draftContext.convertedUserId
                  ? "Create an account or sign in with this email to manage your booking, reschedule, and see future invoices in one place."
                  : "Your payment succeeded. We’re finishing the booking in the background and will open account options as soon as it’s ready."}
              </p>
              {draftContext.subscription ? (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-semibold">
                    {draftContext.subscription.planName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ${draftContext.subscription.totalPerCycle.toFixed(2)} /{" "}
                    {draftContext.subscription.frequency === "monthly"
                      ? "month"
                      : "2 weeks"}{" "}
                    · next charge {draftContext.subscription.nextChargeDate}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your first month is paid today. Claim your account to manage
                    the membership.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              We saved your payment, but this booking link is missing or invalid. You can still return home and contact us if you need help attaching it to an account.
            </div>
          )}

          {mounted && (!isLoaded || !isSignedIn) ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="flex-1" disabled={!token || !draftContext?.convertedUserId}>
                <Link href={signUpHref}>Create account</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1" disabled={!token || !draftContext?.convertedUserId}>
                <Link href={signInHref}>Sign in</Link>
              </Button>
            </div>
          ) : null}

          <div className="text-center">
            <Button asChild variant="ghost">
              <Link href="/">I&apos;ll do this later</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
