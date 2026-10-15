"use client";

import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Calendar,
  CreditCard,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";

type SubscriptionCard = {
  _id: Id<"subscriptions">;
  serviceNames: string[];
  vehicleNames: string[];
  status: string;
  frequency: "biweekly" | "monthly";
  totalPrice: number;
  nextScheduledDate?: string;
  startDate?: string;
};

function statusVariant(status: string) {
  switch (status) {
    case "active":
      return "default" as const;
    case "pending_payment":
      return "secondary" as const;
    case "paused":
      return "outline" as const;
    case "past_due":
      return "destructive" as const;
    case "cancelled":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "pending_payment":
      return "Pending Payment";
    case "past_due":
      return "Past Due";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default function SubscriptionsClient() {
  const subscriptions = useQuery(
    api.subscriptions.getByUser,
  ) as SubscriptionCard[] | undefined | null;
  const createPortalSession = useAction(api.subscriptions.createCustomerPortalSession);
  const startCheckout = useAction(api.subscriptions.startCheckout);
  const cancelSubscription = useMutation(api.subscriptions.cancelByCustomer);
  const [isLoading, setIsLoading] = useState(false);

  const handleManagePayment = async () => {
    setIsLoading(true);
    try {
      const url = await createPortalSession({});
      window.open(url, "_blank");
    } catch {
      toast.error("Failed to open payment management");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePay = async (subscriptionId: Id<"subscriptions">) => {
    setIsLoading(true);
    try {
      const url = await startCheckout({ subscriptionId });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open payment");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (subscriptionId: Id<"subscriptions">) => {
    if (!window.confirm("Cancel this subscription?")) return;
    setIsLoading(true);
    try {
      await cancelSubscription({ subscriptionId });
      toast.success("Subscription cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel subscription");
    } finally {
      setIsLoading(false);
    }
  };

  if (subscriptions === undefined) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold">My Subscriptions</h2>
        <div className="space-y-4">
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (!subscriptions || subscriptions.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold">My Subscriptions</h2>
        <Card className="py-12 text-center">
          <CardContent>
            <RefreshCw className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No Subscriptions</h3>
            <p className="text-muted-foreground">
              You don&apos;t have any active subscriptions yet. Contact us to set
              up recurring service.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">My Subscriptions</h2>
        <Button variant="outline" onClick={handleManagePayment} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CreditCard className="mr-2 h-4 w-4" />
          )}
          Manage Payment Method
        </Button>
      </div>

      <div className="space-y-4">
        {subscriptions.map((sub) => (
          <Card key={sub._id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">
                {sub.serviceNames.join(", ")}
              </CardTitle>
              <Badge variant={statusVariant(sub.status)}>
                {statusLabel(sub.status)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Frequency</p>
                  <p className="font-medium capitalize">{sub.frequency}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Price</p>
                  <p className="font-medium">
                    {formatCurrency(sub.totalPrice)} /{" "}
                    {sub.frequency === "monthly" ? "month" : "2 weeks"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vehicles</p>
                  <p className="font-medium">
                    {sub.vehicleNames.join(", ")}
                  </p>
                </div>
                {sub.nextScheduledDate && (
                  <div>
                    <p className="text-muted-foreground">Next Appointment</p>
                    <p className="font-medium flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {sub.nextScheduledDate}
                    </p>
                  </div>
                )}
              </div>

              {sub.startDate && (
                <p className="text-sm text-muted-foreground">
                  Starts and bills on <span className="font-medium text-foreground">{sub.startDate}</span>
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {sub.status === "pending_payment" && (
                  <>
                    <Button size="sm" onClick={() => handlePay(sub._id)} disabled={isLoading}>
                      <CreditCard className="mr-2 h-4 w-4" />
                      Add Card &amp; Pay
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleCancel(sub._id)} disabled={isLoading}>
                      Decline Subscription
                    </Button>
                  </>
                )}
                {(sub.status === "active" || sub.status === "past_due" || sub.status === "paused") && (
                  <Button size="sm" variant="outline" onClick={() => handleCancel(sub._id)} disabled={isLoading}>
                    Cancel Subscription
                  </Button>
                )}
              </div>

              {sub.status === "active" && sub.nextScheduledDate && (
                <div className="pt-2">
                  <Link href="/dashboard/appointments">
                    <Button variant="outline" size="sm">
                      <Calendar className="mr-2 h-4 w-4" />
                      View Upcoming Appointments
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
