"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatDateString, formatTime12h } from "@/lib/time";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  MoreHorizontal,
  Send,
} from "lucide-react";

interface InvoiceItem {
  serviceName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface Invoice {
  _creationTime: number;
  invoiceNumber: string;
  customer: string;
  customerEmail: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  stripeInvoiceUrl?: string;
  notes?: string;
  paymentOption?: "deposit" | "full" | "in_person" | "subscription";
  depositPaid?: boolean;
  depositAmount?: number;
  remainingBalance?: number;
}

type AbandonedDraftRow = {
  _id: Id<"bookingDrafts">;
  name: string;
  email: string;
  phone?: string;
  serviceNames: string[];
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  recovered?: boolean;
  recoveredFromRecovery?: boolean;
  resumeToken: string;
  abandonedEmailSentAt?: number;
  abandonedFollowUpSentAt?: number;
  recoveryClickedAt?: number;
  recoveryClickCount?: number;
  recoverySource?: string;
  membershipEligible?: boolean;
  membershipPlanName?: string;
  lastActivityAt: number;
};

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

type InvoiceRecord = Invoice & {
  _id: Id<"invoices">;
  status: InvoiceStatus;
  serviceName: string;
};

function InvoicePreview({ invoice }: { invoice: Invoice }) {
  const business = useQuery(api.business.get);

  if (business === undefined) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 border border-gray-200 bg-white p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const businessData = business ?? {
    name: "River City Mobile Detailing",
    owner: "",
    address: "",
    cityStateZip: "",
    country: "",
  };

  return (
    <div className="mx-auto max-w-4xl border border-gray-200 bg-white p-8" id="invoice-preview">
      <div className="mb-8 flex items-start justify-between">
        <div className="text-sm">
          <h3 className="text-lg font-bold">{businessData.name}</h3>
          <p>{businessData.owner}</p>
          <p>{businessData.address}</p>
          <p>{businessData.cityStateZip}</p>
          <p>{businessData.country}</p>
        </div>
        <div className="text-right">
          <h2 className="text-4xl font-bold uppercase text-gray-300">Invoice</h2>
        </div>
      </div>

      <div className="mb-8 flex justify-between text-sm">
        <div>
          <p className="mb-1 font-bold text-gray-500">BILL TO</p>
          <p className="font-bold">{invoice.customer}</p>
          <p>{invoice.customerEmail}</p>
        </div>
        <div className="text-right">
          <p>
            <span className="font-bold text-gray-500">Invoice #</span> {invoice.invoiceNumber}
          </p>
          <p>
            <span className="font-bold text-gray-500">Date:</span>{" "}
            {new Date(invoice._creationTime).toLocaleDateString()}
          </p>
          <p>
            <span className="font-bold text-gray-500">Due Date:</span> {invoice.dueDate}
          </p>
        </div>
      </div>

      <table className="mb-8 w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 text-left font-bold text-gray-600">Item Description</th>
            <th className="p-2 text-center font-bold text-gray-600">Qty</th>
            <th className="p-2 text-right font-bold text-gray-600">Price</th>
            <th className="p-2 text-right font-bold text-gray-600">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoice.items.map((item: InvoiceItem, index: number) => (
            <tr key={index}>
              <td className="p-2">{item.serviceName}</td>
              <td className="p-2 text-center">{item.quantity}</td>
              <td className="p-2 text-right">${item.unitPrice.toFixed(2)}</td>
              <td className="p-2 text-right">${item.totalPrice.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-8 flex justify-end text-sm">
        <div className="w-1/3 space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Subtotal</span>
            <span>${invoice.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Sales Tax</span>
            <span>${invoice.tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 text-lg font-bold">
            <span>Total</span>
            <span>${invoice.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        <div className="mb-4">
          <h4 className="mb-1 font-bold">Notes</h4>
          <p>{invoice.notes || "Thank you for your business!"}</p>
        </div>
        <div>
          <h4 className="mb-1 font-bold">Terms & Conditions</h4>
          <p>Payment is due within 30 days. Late payments are subject to a fee.</p>
        </div>
      </div>
    </div>
  );
}

function InvoiceModal({
  invoice,
  onClose,
}: {
  invoice: Invoice;
  onClose: () => void;
}) {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice Details</DialogTitle>
          <DialogDescription>Invoice #{invoice.invoiceNumber}</DialogDescription>
        </DialogHeader>
        <InvoicePreview invoice={invoice} />
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsClient() {
  const router = useRouter();
  const invoicesQuery = useQuery(api.invoices.listWithDetails, {});
  const statsQuery = useQuery(api.invoices.getSummaryStats, {});
  const abandonedDrafts = useQuery(api.bookingDrafts.listAbandonedForAdmin, {});
  const updateInvoiceStatus = useMutation(api.invoices.updateStatus);
  const repairLegacyPendingBookings = useMutation(
    api.bookingDrafts.repairLegacyPendingBookings,
  );
  const sendRecoveryForDraft = useAction(api.campaigns.sendRecoveryForDraft);
  const startMembershipCampaign = useAction(
    api.campaigns.startMembershipCampaign,
  );
  const sendMembershipCampaignTest = useAction(
    api.campaigns.sendMembershipCampaignTest,
  );
  const campaigns = useQuery(api.campaigns.listCampaigns, {});

  const [updatingId, setUpdatingId] = useState<Id<"invoices"> | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [repairingLegacy, setRepairingLegacy] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<
    Id<"bookingDrafts">[]
  >([]);
  const [serviceFilter, setServiceFilter] = useState("all");
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [campaignName, setCampaignName] = useState(
    "Maintenance Club — abandoned booking offer",
  );
  const [testEmail, setTestEmail] = useState("");
  const [isSendingRecovery, setIsSendingRecovery] = useState<
    Id<"bookingDrafts"> | null
  >(null);
  const [isStartingCampaign, setIsStartingCampaign] = useState(false);
  const campaignPreview = useQuery(
    api.campaigns.previewAudience,
    campaignDialogOpen && selectedDraftIds.length > 0
      ? { audience: { draftIds: selectedDraftIds, statuses: ["expired"] } }
      : "skip",
  );

  if (invoicesQuery === undefined || statsQuery === undefined) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Payments</h2>
            <p className="text-muted-foreground">Track your transactions and revenue</p>
          </div>
          <Skeleton className="h-9 w-32" />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Skeleton className="mb-2 h-4 w-24" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                  <Skeleton className="h-12 w-12 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (invoicesQuery === null || statsQuery === null) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h2 className="text-3xl font-bold">Payments</h2>
          <p className="text-muted-foreground">Track your transactions and revenue</p>
        </div>

        <Card className="py-12 text-center">
          <CardContent>
            <AlertCircle className="mx-auto mb-4 h-16 w-16 text-destructive" />
            <h3 className="mb-2 text-xl font-semibold">Unable to load payments</h3>
            <p className="mb-6 text-muted-foreground">
              There was an error loading the payment data. Please try again later.
            </p>
            <Button onClick={() => window.location.reload()}>Try Again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const invoices = invoicesQuery as InvoiceRecord[];
  const stats = statsQuery;
  const abandonedItems = abandonedDrafts ?? [];
  const serviceOptions = Array.from(
    new Set(abandonedItems.flatMap((item) => item.serviceNames)),
  ).sort();
  const filteredAbandonedItems = abandonedItems.filter(
    (item) =>
      serviceFilter === "all" || item.serviceNames.includes(serviceFilter),
  );
  const allVisibleSelected =
    filteredAbandonedItems.length > 0 &&
    filteredAbandonedItems.every((item) =>
      selectedDraftIds.includes(item._id),
    );
  const selectedVisibleDraftIds = filteredAbandonedItems
    .filter((item) => selectedDraftIds.includes(item._id))
    .map((item) => item._id);

  const toggleDraftSelection = (draftId: Id<"bookingDrafts">) => {
    setSelectedDraftIds((current) =>
      current.includes(draftId)
        ? current.filter((id) => id !== draftId)
        : [...current, draftId],
    );
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredAbandonedItems.map((item) => item._id));
      setSelectedDraftIds((current) =>
        current.filter((id) => !visibleIds.has(id)),
      );
      return;
    }
    setSelectedDraftIds((current) => [
      ...new Set([
        ...current,
        ...filteredAbandonedItems.map((item) => item._id),
      ]),
    ]);
  };

  const handleSendRecovery = async (draftId: Id<"bookingDrafts">) => {
    setIsSendingRecovery(draftId);
    try {
      const sent = await sendRecoveryForDraft({ draftId });
      toast.success(
        sent
          ? "Recovery email sent"
          : "This draft already received a recovery email or is no longer eligible.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send recovery email",
      );
    } finally {
      setIsSendingRecovery(null);
    }
  };

  const handleExportCsv = () => {
    const header = [
      "Name",
      "Email",
      "Phone",
      "Status",
      "Services",
      "Requested Date",
      "Requested Time",
      "Total",
      "Last Activity",
      "Recovery Email Sent",
      "Follow-up Sent",
      "Recovery Clicked",
      "Membership Eligible",
      "Resume Link",
    ];
    const rows = filteredAbandonedItems.map((item) => [
      item.name,
      item.email,
      item.phone ?? "",
      item.status,
      item.serviceNames.join(" | "),
      item.scheduledDate,
      item.scheduledTime,
      item.totalPrice?.toFixed(2) ?? "",
      new Date(item.lastActivityAt).toISOString(),
      item.abandonedEmailSentAt
        ? new Date(item.abandonedEmailSentAt).toISOString()
        : "",
      item.abandonedFollowUpSentAt
        ? new Date(item.abandonedFollowUpSentAt).toISOString()
        : "",
      item.recoveryClickedAt
        ? new Date(item.recoveryClickedAt).toISOString()
        : "",
      item.membershipEligible ? "Yes" : "No",
      `${window.location.origin}/booking/resume?token=${item.resumeToken}`,
    ]);
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escape(String(cell))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `abandoned-checkouts-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSendTestCampaign = async () => {
    if (!testEmail.trim()) {
      toast.error("Enter an email address for the test.");
      return;
    }
    try {
      await sendMembershipCampaignTest({ to: testEmail.trim() });
      toast.success("Test membership email sent");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send test email",
      );
    }
  };

  const handleStartCampaign = async () => {
    if (selectedVisibleDraftIds.length === 0) {
      toast.error("Select at least one abandoned checkout.");
      return;
    }
    setIsStartingCampaign(true);
    try {
      const result = await startMembershipCampaign({
        name: campaignName.trim() || "Maintenance Club campaign",
        audience: { draftIds: selectedVisibleDraftIds, statuses: ["expired"] },
      });
      toast.success(
        `Campaign started: ${result.eligible} eligible, ${result.skipped} skipped for consent.`,
      );
      setCampaignDialogOpen(false);
      setSelectedDraftIds([]);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start campaign",
      );
    } finally {
      setIsStartingCampaign(false);
    }
  };

  const getStatusColor = (status: InvoiceStatus) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-700";
      case "sent":
      case "draft":
        return "bg-yellow-100 text-yellow-700";
      case "overdue":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const handleStatusUpdate = async (invoiceId: Id<"invoices">, newStatus: InvoiceStatus) => {
    setUpdatingId(invoiceId);
    try {
      await updateInvoiceStatus({
        invoiceId,
        status: newStatus,
        paidDate: newStatus === "paid" ? new Date().toISOString().split("T")[0] : undefined,
      });
      toast.success(`Invoice marked as ${newStatus}`);
      router.refresh();
    } catch {
      toast.error("Failed to update invoice status");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleLegacyCleanup = async () => {
    setRepairingLegacy(true);
    try {
      const result = await repairLegacyPendingBookings({ dryRun: false });
      toast.success(
        `Removed ${result.removedAppointments} orphan appointment${result.removedAppointments === 1 ? "" : "s"} and ${result.removedInvoices} invoice${result.removedInvoices === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to clean up legacy pending bookings",
      );
    } finally {
      setRepairingLegacy(false);
    }
  };

  const columns: ColumnDef<InvoiceRecord>[] = [
    {
      accessorKey: "customer",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Customer
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <p className="font-medium">{row.original.customer}</p>
          <p className="text-xs text-muted-foreground">{row.original.customerEmail}</p>
        </div>
      ),
    },
    {
      accessorKey: "serviceName",
      header: "Service",
      cell: ({ row }) => (
        <span className="block min-w-[160px] truncate text-sm">{row.original.serviceName}</span>
      ),
    },
    {
      accessorKey: "dueDate",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Due Date
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => <span>{formatDateString(row.original.dueDate)}</span>,
    },
    {
      accessorKey: "total",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Amount
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => <span className="font-medium">${row.original.total.toFixed(2)}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className={`capitalize ${getStatusColor(row.original.status)}`}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const invoice = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0" disabled={updatingId === invoice._id}>
                <span className="sr-only">Open actions</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {invoice.status === "draft" && (
                <DropdownMenuItem onClick={() => void handleStatusUpdate(invoice._id, "sent")}>
                  <Send className="mr-2 h-4 w-4" />
                  Send
                </DropdownMenuItem>
              )}
              {(invoice.status === "sent" || (invoice.paymentOption === "in_person" && invoice.depositPaid && invoice.status === "draft")) && (
                <DropdownMenuItem onClick={() => void handleStatusUpdate(invoice._id, "paid")}>
                  <Check className="mr-2 h-4 w-4" />
                  Mark Paid
                </DropdownMenuItem>
              )}
              {invoice.stripeInvoiceUrl && (
                <DropdownMenuItem
                  onClick={() => window.open(invoice.stripeInvoiceUrl, "_blank", "noopener,noreferrer")}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Open Stripe
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSelectedInvoice(invoice)}>
                <Eye className="mr-2 h-4 w-4" />
                View Invoice
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Payments</h2>
          <p className="text-muted-foreground">Track your transactions and revenue</p>
        </div>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">${stats.totalRevenue.toLocaleString()}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
                <DollarSign className="h-6 w-6 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">${stats.pending.toLocaleString()}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
                <CreditCard className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">${stats.completed.toLocaleString()}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Abandoned Checkouts</h3>
              <p className="text-sm text-muted-foreground">
                Expired checkout drafts and their recovery activity. Marketing
                campaigns only include customers who opted in.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={serviceFilter}
                onChange={(event) => {
                  setServiceFilter(event.target.value);
                  setSelectedDraftIds([]);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Filter abandoned checkouts by service"
              >
                <option value="all">All services</option>
                {serviceOptions.map((serviceName) => (
                  <option key={serviceName} value={serviceName}>
                    {serviceName}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={filteredAbandonedItems.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCampaignDialogOpen(true)}
                disabled={selectedVisibleDraftIds.length === 0}
              >
                <Send className="mr-2 h-4 w-4" />
                Send membership offer
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLegacyCleanup}
                disabled={repairingLegacy}
              >
                {repairingLegacy ? "Cleaning..." : "Clean legacy pending"}
              </Button>
            </div>
          </div>

          {filteredAbandonedItems.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No abandoned checkout drafts right now.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="w-10 pb-3 pr-2 font-medium">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Select all visible abandoned checkouts"
                        className="accent-primary"
                      />
                    </th>
                    <th className="pb-3 pr-4 font-medium">Customer</th>
                    <th className="pb-3 pr-4 font-medium">Services</th>
                    <th className="pb-3 pr-4 font-medium">Slot</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 pr-4 font-medium">Recovery</th>
                    <th className="pb-3 pr-4 font-medium">Last Activity</th>
                    <th className="pb-3 pr-4 font-medium">Reach Out</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAbandonedItems.map((draft: AbandonedDraftRow) => (
                    <tr key={draft._id} className="border-b last:border-b-0">
                      <td className="py-3 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={selectedDraftIds.includes(draft._id)}
                          onChange={() => toggleDraftSelection(draft._id)}
                          aria-label={`Select ${draft.name || draft.email}`}
                          className="accent-primary"
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{draft.name}</div>
                        <div className="text-xs text-muted-foreground">{draft.email}</div>
                        {draft.phone ? (
                          <div className="text-xs text-muted-foreground">{draft.phone}</div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {draft.serviceNames.join(", ")}
                      </td>
                      <td className="py-3 pr-4">
                        <div>{formatDateString(draft.scheduledDate)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime12h(draft.scheduledTime)}
                        </div>
                      </td>
                      <td className="space-y-1 py-3 pr-4">
                        <Badge variant="outline">
                          {draft.recovered
                            ? "Recovered"
                            : draft.status.replaceAll("_", " ")}
                        </Badge>
                        {draft.membershipEligible ? (
                          <Badge variant="secondary">Club eligible</Badge>
                        ) : null}
                      </td>
                      <td className="space-y-1 py-3 pr-4 text-xs text-muted-foreground">
                        <div>
                          {draft.abandonedEmailSentAt
                            ? `Email 1: ${new Date(draft.abandonedEmailSentAt).toLocaleDateString()}`
                            : "Email 1: not sent"}
                        </div>
                        <div>
                          {draft.abandonedFollowUpSentAt
                            ? `Follow-up: ${new Date(draft.abandonedFollowUpSentAt).toLocaleDateString()}`
                            : "Follow-up: not sent"}
                        </div>
                        <div>
                          {draft.recoveryClickCount
                            ? `Clicks: ${draft.recoveryClickCount}`
                            : "Clicks: 0"}
                          {draft.recoveredFromRecovery ? " · recovered" : ""}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {new Date(draft.lastActivityAt).toLocaleString()}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                          <Button asChild size="sm" variant="outline">
                            <a href={`mailto:${draft.email}`}>Email</a>
                          </Button>
                          {draft.phone ? (
                            <Button asChild size="sm" variant="outline">
                              <a href={`tel:${draft.phone}`}>Call</a>
                            </Button>
                          ) : null}
                          {!draft.recovered ? (
                            <Button asChild size="sm" variant="outline">
                              <a href={`/booking/resume?token=${draft.resumeToken}`}>
                                Resume Link
                              </a>
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSendRecovery(draft._id)}
                            disabled={
                              Boolean(draft.abandonedEmailSentAt) ||
                              Boolean(draft.recovered) ||
                              isSendingRecovery === draft._id
                            }
                          >
                            {isSendingRecovery === draft._id
                              ? "Sending..."
                              : draft.recovered
                                ? "Recovered"
                                : draft.abandonedEmailSentAt
                                  ? "Email sent"
                                  : "Send recovery"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div>
            <h3 className="text-lg font-semibold">Campaign History</h3>
            <p className="text-sm text-muted-foreground">
              Consent-aware membership offers, sent in batches with per-recipient
              tracking.
            </p>
          </div>
          {campaigns && campaigns.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {campaigns.map((campaign) => (
                <div
                  key={campaign._id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="text-sm font-medium">{campaign.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(campaign.createdAt).toLocaleString()} ·{" "}
                      {campaign.templateKey}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">{campaign.status}</Badge>
                    <span className="text-muted-foreground">
                      Sent {campaign.sentCount}/{campaign.totalRecipients}
                    </span>
                    <span className="text-muted-foreground">
                      Skipped {campaign.skippedCount}
                    </span>
                    {campaign.failedCount > 0 ? (
                      <span className="text-destructive">
                        Failed {campaign.failedCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No campaigns yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Maintenance Club offer</DialogTitle>
            <DialogDescription>
              This is a marketing email. Only customers with an explicit
              marketing opt-in and no suppression are eligible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="campaign-name">
                Campaign name
              </label>
              <Input
                id="campaign-name"
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Selected</p>
                <p className="text-xl font-semibold">
                  {selectedVisibleDraftIds.length}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Eligible</p>
                <p className="text-xl font-semibold">
                  {campaignPreview?.counts.eligible ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Skipped</p>
                <p className="text-xl font-semibold">
                  {campaignPreview
                    ? campaignPreview.counts.skippedNoConsent +
                      campaignPreview.counts.skippedSuppressed +
                      campaignPreview.counts.skippedNoEmail
                    : "—"}
                </p>
              </div>
            </div>

            {campaignPreview ? (
              <p className="text-xs text-muted-foreground">
                {campaignPreview.counts.replacement} maintenance replacement
                offer{campaignPreview.counts.replacement === 1 ? "" : "s"} ·{" "}
                {campaignPreview.counts.afterDetail} post-detail offer
                {campaignPreview.counts.afterDetail === 1 ? "" : "s"}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Calculating audience...
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="you@example.com"
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                type="email"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSendTestCampaign}
              >
                Send test
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Preview the recovery and campaign designs with{" "}
              <code>pnpm --filter web email:dev</code> before sending.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCampaignDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleStartCampaign}
                disabled={
                  isStartingCampaign ||
                  !campaignPreview ||
                  campaignPreview.counts.eligible === 0
                }
              >
                {isStartingCampaign ? "Starting..." : "Start campaign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DataTable
        columns={columns}
        data={invoices}
        filterColumn="customer"
        filterPlaceholder="Filter by customer..."
        tableMinWidthClass="min-w-[1140px]"
        onRowClick={(row) => router.push(`/admin/payments/${row._id}`)}
      />

      {selectedInvoice && (
        <InvoiceModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      )}
    </div>
  );
}
