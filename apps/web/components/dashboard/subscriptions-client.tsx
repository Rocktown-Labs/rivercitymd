"use client";

import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AddressInput from "@/components/ui/address-input";
import { TimeSlotPicker } from "@/components/home/time-slot-picker";
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
  preferredTime: string;
  estimatedDurationMinutes?: number;
  location?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    notes?: string;
  };
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

type ServiceAddress = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

function PendingPaymentControls({
  sub,
  isLoading,
  onPreferencesChange,
  onPay,
  onDecline,
}: {
  sub: SubscriptionCard;
  isLoading: boolean;
  onPreferencesChange: (
    subscriptionId: Id<"subscriptions">,
    prefs: {
      startDate?: string;
      preferredTime?: string;
      location?: ServiceAddress;
    },
  ) => Promise<void>;
  onPay: (subscriptionId: Id<"subscriptions">) => Promise<void>;
  onDecline: (subscriptionId: Id<"subscriptions">) => Promise<void>;
}) {
  const serviceDate = sub.startDate;
  const [addressSearchAvailable, setAddressSearchAvailable] = useState(true);
  const [manualAddress, setManualAddress] = useState<ServiceAddress>(() => ({
    street: sub.location?.street ?? "",
    city: sub.location?.city ?? "",
    state: sub.location?.state ?? "",
    zip: sub.location?.zip ?? "",
  }));

  const handleAddressSelect = (address: {
    addressComponents?: {
      street?: string;
      city?: string;
      locality?: string;
      state?: string;
      region?: string;
      postalCode?: string;
    };
  }) => {
    const components = address.addressComponents;
    const next: ServiceAddress = {
      street: components?.street ?? "",
      city: components?.city ?? components?.locality ?? "",
      state: components?.state ?? components?.region ?? "",
      zip: components?.postalCode ?? "",
    };
    setManualAddress(next);
    if (next.street && next.city && next.state && next.zip) {
      void onPreferencesChange(sub._id, { location: next });
    }
  };

  return (
    <div className="space-y-2.5 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        Charged {formatCurrency(sub.totalPrice)} today, then every{" "}
        {sub.frequency === "monthly" ? "month" : "2 weeks"}. Pick your service
        date, time, and address below — your next visit stays pre-scheduled and
        confirms with each payment.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Service date</span>
          <Input
            type="date"
            className="h-9 bg-background border-border text-foreground"
            value={serviceDate || ""}
            min={new Date().toISOString().slice(0, 10)}
            disabled={isLoading}
            onChange={(event) =>
              void onPreferencesChange(sub._id, {
                startDate: event.target.value,
                preferredTime: "",
              })
            }
          />
        </label>
        <div className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Service time</span>
          <TimeSlotPicker
            date={serviceDate || ""}
            selectedTime={sub.preferredTime}
            onTimeSelect={(time) =>
              void onPreferencesChange(sub._id, {
                startDate: serviceDate,
                preferredTime: time,
              })
            }
            serviceDuration={sub.estimatedDurationMinutes || 60}
          />
        </div>
      </div>

      <div className="max-w-sm space-y-1">
        <AddressInput
          onAddressSelect={handleAddressSelect}
          onAutocompleteAvailabilityChange={setAddressSearchAvailable}
          label="Service Address"
          placeholder="Search for your service address"
        />
        <p className="text-xs text-muted-foreground">
          Current:{" "}
          <span className="font-medium text-foreground">
            {sub.location
              ? `${sub.location.street}, ${sub.location.city}, ${sub.location.state} ${sub.location.zip}`
              : "Not set"}
          </span>
        </p>
        {!addressSearchAvailable && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Street"
              value={manualAddress.street}
              disabled={isLoading}
              onChange={(e) =>
                setManualAddress({ ...manualAddress, street: e.target.value })
              }
            />
            <Input
              placeholder="City"
              value={manualAddress.city}
              disabled={isLoading}
              onChange={(e) =>
                setManualAddress({ ...manualAddress, city: e.target.value })
              }
            />
            <Input
              placeholder="State"
              value={manualAddress.state}
              disabled={isLoading}
              onChange={(e) =>
                setManualAddress({ ...manualAddress, state: e.target.value })
              }
            />
            <Input
              placeholder="ZIP"
              value={manualAddress.zip}
              disabled={isLoading}
              onChange={(e) =>
                setManualAddress({ ...manualAddress, zip: e.target.value })
              }
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="col-span-2"
              disabled={
                isLoading ||
                !manualAddress.street ||
                !manualAddress.city ||
                !manualAddress.state ||
                !manualAddress.zip
              }
              onClick={() =>
                void onPreferencesChange(sub._id, {
                  location: manualAddress,
                })
              }
            >
              Save Address
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void onPay(sub._id)}
          disabled={isLoading || !serviceDate}
        >
          <CreditCard className="mr-2 h-4 w-4" />
          Pay &amp; Start Subscription
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onDecline(sub._id)}
          disabled={isLoading}
        >
          Decline Subscription
        </Button>
      </div>
    </div>
  );
}

export default function SubscriptionsClient() {
  const subscriptions = useQuery(
    api.subscriptions.getByUser,
  ) as SubscriptionCard[] | undefined | null;
  const createPortalSession = useAction(api.subscriptions.createCustomerPortalSession);
  const startCheckout = useAction(api.subscriptions.startCheckout);
  const cancelSubscription = useMutation(api.subscriptions.cancelByCustomer);
  const updateStartDate = useMutation(api.subscriptions.updateStartDateByCustomer);
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

  const handlePreferencesChange = async (
    subscriptionId: Id<"subscriptions">,
    prefs: {
      startDate?: string;
      preferredTime?: string;
      location?: {
        street: string;
        city: string;
        state: string;
        zip: string;
      };
    },
  ) => {
    setIsLoading(true);
    try {
      await updateStartDate({ subscriptionId, ...prefs });
      toast.success(
        prefs.location && !prefs.startDate && !prefs.preferredTime
          ? "Service address updated"
          : prefs.preferredTime
            ? "Service time updated"
            : "Start date updated",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update schedule");
    } finally {
      setIsLoading(false);
    }
  };

  const renderSubscriptionCards = (items: SubscriptionCard[]) => (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {items.map((sub) => (
        <Card key={sub._id} className="gap-3 py-4">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4">
            <CardTitle className="text-sm font-semibold leading-snug">
              {sub.serviceNames.join(", ")}
            </CardTitle>
            <Badge variant={statusVariant(sub.status)}>
              {statusLabel(sub.status)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <p className="text-muted-foreground">Frequency</p>
                <p className="text-sm font-medium capitalize">{sub.frequency}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Price</p>
                <p className="text-sm font-medium">
                  {formatCurrency(sub.totalPrice)} /{" "}
                  {sub.frequency === "monthly" ? "month" : "2 weeks"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Vehicles</p>
                <p className="text-sm font-medium">
                  {sub.vehicleNames.join(", ")}
                </p>
              </div>
              {sub.nextScheduledDate && (
                <div>
                  <p className="text-muted-foreground">Next Appointment</p>
                  <p className="text-sm font-medium flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {sub.nextScheduledDate}
                  </p>
                </div>
              )}
            </div>

            {sub.startDate && sub.status !== "pending_payment" && (
              <p className="text-xs text-muted-foreground">
                First service on <span className="font-medium text-foreground">{sub.startDate}</span>
              </p>
            )}

            {sub.status === "pending_payment" && (
              <PendingPaymentControls
                sub={sub}
                isLoading={isLoading}
                onPreferencesChange={handlePreferencesChange}
                onPay={handlePay}
                onDecline={handleCancel}
              />
            )}

            <div className="flex flex-wrap gap-2">
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
  );

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

  const renderEmptyState = (title: string, description: string) => (
    <Card className="py-10 text-center">
      <CardContent>
        <RefreshCw className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h3 className="mb-1 text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );

  const cancelledSubscriptions = subscriptions.filter(
    (sub) => sub.status === "cancelled",
  );
  const openSubscriptions = subscriptions.filter(
    (sub) => sub.status !== "cancelled",
  );

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

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="all">
            All ({subscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="active">
            Active ({openSubscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="cancelled">
            Cancelled ({cancelledSubscriptions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          {renderSubscriptionCards(subscriptions)}
        </TabsContent>

        <TabsContent value="active" className="mt-6">
          {openSubscriptions.length > 0
            ? renderSubscriptionCards(openSubscriptions)
            : renderEmptyState(
                "No active subscriptions",
                "You don't have any active subscriptions right now.",
              )}
        </TabsContent>

        <TabsContent value="cancelled" className="mt-6">
          {cancelledSubscriptions.length > 0
            ? renderSubscriptionCards(cancelledSubscriptions)
            : renderEmptyState(
                "No cancelled subscriptions",
                "Subscriptions you cancel will appear here.",
              )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
