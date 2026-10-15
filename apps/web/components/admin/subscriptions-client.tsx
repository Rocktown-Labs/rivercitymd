"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/ui/data-table";
import { toast } from "sonner";
import { AddCustomerForm } from "@/components/forms/admin/add-customer-form";
import {
  AlertCircle,
  DollarSign,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Users,
  X,
} from "lucide-react";

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type SubscriptionRecord = {
  _id: Id<"subscriptions">;
  _creationTime: number;
  userId: Id<"users">;
  serviceIds: Id<"services">[];
  vehicleIds: Id<"vehicles">[];
  frequency: "biweekly" | "monthly";
  preferredDayOfWeek: number;
  preferredTime: string;
  location: {
    street: string;
    city: string;
    state: string;
    zip: string;
    notes?: string;
  };
  totalPrice: number;
  status: "pending_payment" | "active" | "paused" | "past_due" | "cancelled";
  nextScheduledDate?: string;
  startDate?: string;
  notes?: string;
  userName: string;
  userEmail?: string;
  serviceNames: string[];
  vehicleNames: string[];
};

type CustomerOption = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
};

type CustomerVehicle = {
  _id: Id<"vehicles">;
  year: number;
  make: string;
  model: string;
  size?: "small" | "medium" | "large";
};

type SubscriptionServiceOption = {
  _id: Id<"services">;
  name: string;
  isActive: boolean;
  serviceType?: string;
  basePrice?: number;
  basePriceSmall?: number;
  basePriceMedium?: number;
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
  const subscriptions = useQuery(api.subscriptions.list) as
    | SubscriptionRecord[]
    | null
    | undefined;
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const pauseSubscription = useMutation(api.subscriptions.pause);
  const resumeSubscription = useMutation(api.subscriptions.resume);
  const cancelSubscription = useMutation(api.subscriptions.cancel);
  const resendLink = useAction(api.subscriptions.resendCheckoutLink);

  const handlePause = async (id: Id<"subscriptions">) => {
    try {
      await pauseSubscription({ subscriptionId: id });
      toast.success("Subscription paused");
    } catch {
      toast.error("Failed to pause subscription");
    }
  };

  const handleResume = async (id: Id<"subscriptions">) => {
    try {
      await resumeSubscription({ subscriptionId: id });
      toast.success("Subscription resumed");
    } catch {
      toast.error("Failed to resume subscription");
    }
  };

  const handleCancel = async (id: Id<"subscriptions">) => {
    try {
      await cancelSubscription({ subscriptionId: id });
      toast.success("Subscription cancelled");
    } catch {
      toast.error("Failed to cancel subscription");
    }
  };

  const handleResendLink = async (id: Id<"subscriptions">) => {
    try {
      await resendLink({ subscriptionId: id });
      toast.success("Checkout link resent");
    } catch {
      toast.error("Failed to resend checkout link");
    }
  };

  const columns: ColumnDef<SubscriptionRecord>[] = [
    {
      accessorKey: "userName",
      header: "Customer",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.userName}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.userEmail}
          </p>
        </div>
      ),
    },
    {
      id: "services",
      header: "Service(s)",
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <p className="text-sm">{row.original.serviceNames.join(", ")}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.vehicleNames.join(", ")}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "frequency",
      header: "Frequency",
      cell: ({ row }) => (
        <span className="text-sm capitalize">{row.original.frequency}</span>
      ),
    },
    {
      accessorKey: "totalPrice",
      header: "Price/Cycle",
      cell: ({ row }) => (
        <span className="font-medium">
          {formatCurrency(row.original.totalPrice)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.status)}>
          {statusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      accessorKey: "nextScheduledDate",
      header: "Next Appointment",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.nextScheduledDate || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const sub = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {sub.status === "active" && (
                <DropdownMenuItem onClick={() => handlePause(sub._id)}>
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </DropdownMenuItem>
              )}
              {sub.status === "paused" && (
                <DropdownMenuItem onClick={() => handleResume(sub._id)}>
                  <Play className="mr-2 h-4 w-4" />
                  Resume
                </DropdownMenuItem>
              )}
              {sub.status === "pending_payment" && (
                <DropdownMenuItem onClick={() => handleResendLink(sub._id)}>
                  <Send className="mr-2 h-4 w-4" />
                  Resend Checkout Link
                </DropdownMenuItem>
              )}
              {sub.status !== "cancelled" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleCancel(sub._id)}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  // Stats
  const activeCount = subscriptions?.filter((s) => s.status === "active").length ?? 0;
  const pendingCount = subscriptions?.filter((s) => s.status === "pending_payment").length ?? 0;
  const pastDueCount = subscriptions?.filter((s) => s.status === "past_due").length ?? 0;
  const mrr = subscriptions
    ?.filter((s) => s.status === "active")
    .reduce((sum, s) => {
      // Normalize to monthly: biweekly × 2.17 ≈ monthly
      return sum + (s.frequency === "biweekly" ? s.totalPrice * 2.17 : s.totalPrice);
    }, 0) ?? 0;

  if (subscriptions === undefined) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Subscriptions</h2>
            <p className="mt-1 text-muted-foreground">
              Manage recurring billing for repeat customers
            </p>
          </div>
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Card>
          <CardContent className="py-10">
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Subscriptions</h2>
          <p className="text-muted-foreground">
            Manage recurring billing for repeat customers
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Subscription
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Subscription</DialogTitle>
            </DialogHeader>
            <CreateSubscriptionForm onSuccess={() => setShowCreateDialog(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Payment
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Est. MRR</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(mrr)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Past Due</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {pastDueCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={subscriptions ?? []}
        filterColumn="userName"
        filterPlaceholder="Search by customer name..."
      />
    </div>
  );
}

// --- Create Subscription Form ---

function CreateSubscriptionForm({ onSuccess }: { onSuccess: () => void }) {
  const customers = useQuery(api.users.listWithStats) as
    | CustomerOption[]
    | undefined;
  const services = useQuery(api.services.list) as SubscriptionServiceOption[] | undefined;
  const createSubscription = useMutation(api.subscriptions.create);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<"biweekly" | "monthly">("monthly");
  const [preferredDay, setPreferredDay] = useState("1"); // Monday
  const [startDate, setStartDate] = useState(
    () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  );
  const [preferredTime, setPreferredTime] = useState("09:00");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  // Get vehicles for selected customer
  const customerVehicles = useQuery(
    api.vehicles.getByUser,
    selectedCustomerId
      ? { userId: selectedCustomerId as Id<"users"> }
      : "skip",
  ) as CustomerVehicle[] | undefined;

  const handleCustomerChange = (value: string) => {
    setSelectedCustomerId(value);
    setSelectedVehicleIds([]);
    const cust = customers?.find((c) => c._id === value);
    if (cust?.address) {
      setStreet(cust.address.street || "");
      setCity(cust.address.city || "");
      setState(cust.address.state || "");
      setZip(cust.address.zip || "");
    }
  };

  // Filter services to subscription type
  const subscriptionServices = services?.filter(
    (s) => (s.serviceType === "subscription" || !s.serviceType) && s.isActive,
  );

  const handleSubmit = async () => {
    if (!selectedCustomerId || selectedServiceIds.length === 0 || selectedVehicleIds.length === 0) {
      toast.error("Please select a customer, service(s), and vehicle(s)");
      return;
    }
    if (!street || !city || !state || !zip) {
      toast.error("Please fill in the location");
      return;
    }

    setIsSubmitting(true);
    try {
      await createSubscription({
        userId: selectedCustomerId as Id<"users">,
        serviceIds: selectedServiceIds as Id<"services">[],
        vehicleIds: selectedVehicleIds as Id<"vehicles">[],
        frequency,
        preferredDayOfWeek: parseInt(preferredDay),
        startDate,
        preferredTime,
        location: { street, city, state, zip },
        notes: notes || undefined,
      });
      toast.success("Subscription created! Checkout link will be emailed to customer.");
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create subscription",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Customer */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Customer</Label>
          <Button type="button" variant="link" size="sm" onClick={() => setShowAddCustomer(true)}>
            Create new customer
          </Button>
        </div>
        <Select value={selectedCustomerId} onValueChange={handleCustomerChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a customer..." />
          </SelectTrigger>
          <SelectContent>
            {customers?.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name || c.email || "Unknown"} — {c.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          New customers receive an account invitation and can add their card from the emailed setup link or their dashboard.
        </p>
        <AddCustomerForm open={showAddCustomer} onOpenChange={setShowAddCustomer} />
      </div>

      {/* Vehicles */}
      {customerVehicles && customerVehicles.length > 0 && (
        <div className="space-y-2">
          <Label>Vehicles</Label>
          <div className="space-y-1">
            {customerVehicles.map((v) => (
              <label
                key={v._id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedVehicleIds.includes(v._id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedVehicleIds([...selectedVehicleIds, v._id]);
                    } else {
                      setSelectedVehicleIds(
                        selectedVehicleIds.filter((id) => id !== v._id),
                      );
                    }
                  }}
                />
                {v.year} {v.make} {v.model}
                {v.size && (
                  <span className="text-xs text-muted-foreground">
                    ({v.size})
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Services */}
      <div className="space-y-2">
        <Label>Service(s)</Label>
        {subscriptionServices && subscriptionServices.length > 0 ? (
          <div className="space-y-1">
            {subscriptionServices.map((s) => (
              <label
                key={s._id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedServiceIds.includes(s._id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedServiceIds([...selectedServiceIds, s._id]);
                    } else {
                      setSelectedServiceIds(
                        selectedServiceIds.filter((id) => id !== s._id),
                      );
                    }
                  }}
                />
                {s.name} — from{" "}
                {formatCurrency(
                  s.basePriceSmall || s.basePriceMedium || s.basePrice || 0,
                )}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No subscription-type services found. Any active service can be used.
          </p>
        )}
        {/* Fallback: show all active services if no subscription-type exist */}
        {(!subscriptionServices || subscriptionServices.length === 0) &&
          services
            ?.filter((s) => s.isActive)
            .map((s) => (
              <label
                key={s._id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedServiceIds.includes(s._id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedServiceIds([...selectedServiceIds, s._id]);
                    } else {
                      setSelectedServiceIds(
                        selectedServiceIds.filter((id) => id !== s._id),
                      );
                    }
                  }}
                />
                {s.name} — from{" "}
                {formatCurrency(
                  s.basePriceSmall || s.basePriceMedium || s.basePrice || 0,
                )}
              </label>
            ))}
      </div>

      {/* Frequency */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select
            value={frequency}
            onValueChange={(v) => setFrequency(v as "biweekly" | "monthly")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="biweekly">Biweekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Preferred Day</Label>
          <Select value={preferredDay} onValueChange={setPreferredDay}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OF_WEEK.map((day, i) => (
                <SelectItem key={i} value={i.toString()}>
                  {day}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Time */}
      <div className="space-y-2">
        <Label>Service start and billing date</Label>
        <Input
          type="date"
          value={startDate}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The customer&apos;s first service and recurring billing anchor date.
        </p>
      </div>

      {/* Time */}
      <div className="space-y-2">
        <Label>Preferred Time</Label>
        <Input
          type="time"
          value={preferredTime}
          onChange={(e) => setPreferredTime(e.target.value)}
        />
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label>Location</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Street"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            className="col-span-2"
          />
          <Input
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="State"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
            <Input
              placeholder="ZIP"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any special instructions..."
        />
      </div>

      {/* Submit */}
      <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        Create & Send Checkout Link
      </Button>
    </div>
  );
}
