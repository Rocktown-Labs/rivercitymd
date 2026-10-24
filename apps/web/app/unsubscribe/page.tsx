"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function UnsubscribePage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const unsubscribe = useMutation(api.campaigns.unsubscribe);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const handleUnsubscribe = async () => {
    if (!token) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    try {
      const result = await unsubscribe({ token });
      setStatus(result.success ? "success" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle>Email preferences</CardTitle>
          <CardDescription>
            Manage whether River City Mobile Detailing can send you marketing
            emails and membership offers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {status === "success" ? (
            <>
              <p className="text-sm text-muted-foreground">
                You&apos;re unsubscribed from marketing emails. You&apos;ll
                still receive transactional emails about bookings, payments,
                and service updates.
              </p>
              <Button asChild>
                <Link href="/">Return home</Link>
              </Button>
            </>
          ) : status === "error" ? (
            <>
              <p className="text-sm text-muted-foreground">
                This unsubscribe link is invalid or has expired. Please contact
                us if you need help updating your email preferences.
              </p>
              <Button asChild variant="outline">
                <Link href="/">Return home</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Click below to stop receiving marketing emails and membership
                offers. Booking confirmations and payment emails are not
                affected.
              </p>
              <Button
                onClick={handleUnsubscribe}
                disabled={status === "loading" || !token}
              >
                {status === "loading" ? "Unsubscribing..." : "Unsubscribe"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
