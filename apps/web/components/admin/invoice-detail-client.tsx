"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  AlertCircle,
  ExternalLink,
  Calendar,
  FileText,
  Gift,
  RefreshCw,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { formatDateString } from "@/lib/time";
import { normalizeStripeCouponCode } from "@rivercitymd/backend/convex/lib/coupons";

type Props = {
  invoiceId: Id<"invoices">;
};

type InvoiceLineItem = {
  serviceName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

function getStatusBadge(status: string) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "outline",
    sent: "secondary",
    paid: "default",
    overdue: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"}>
      {status.toUpperCase()}
    </Badge>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(date: string | null | undefined) {
  if (!date) return "-";
  // Date-only strings (YYYY-MM-DD) use formatDateString to avoid UTC shift;
  // full ISO timestamps fall through to Date constructor (correct for _creationTime).
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return formatDateString(date);
  }
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function InvoiceDetailClient({ invoiceId }: Props) {
  const router = useRouter();
  const invoice = useQuery(api.invoices.getById, { invoiceId });
  const appointment = useQuery(
    api.appointments.getByIdWithDetails,
    invoice?.appointmentId ? { appointmentId: invoice.appointmentId } : "skip",
  );
  const retryInvoiceGeneration = useMutation(api.appointments.retryInvoiceGeneration);
  const updateBillingSettings = useMutation(api.invoices.updateBillingSettings);
  const reissueStripeInvoice = useAction(api.payments.reissueStripeInvoice);
  const applyCouponToInvoice = useAction(api.payments.applyCouponToInvoice);
  const removeDiscountFromInvoice = useAction(api.payments.removeDiscountFromInvoice);
  const [isRetrying, setIsRetrying] = useState(false);
  const [billingDueDate, setBillingDueDate] = useState("");
  const [billingMethod, setBillingMethod] = useState<
    "send_invoice" | "charge_automatically"
  >("send_invoice");
  const [isSavingBilling, setIsSavingBilling] = useState(false);

  // Discount / Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState<number | "">("");
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);

  const handleApplyDiscount = async () => {
    if (!invoice) return;
    const normalizedCouponCode = normalizeStripeCouponCode(couponCode);
    if (!normalizedCouponCode) {
      toast.error("Please enter a coupon code");
      return;
    }
    const hasManualDiscountValue = discountValue !== "" && Number(discountValue) > 0;

    setIsApplyingDiscount(true);
    try {
      await applyCouponToInvoice({
        invoiceId: invoice._id,
        couponCode: normalizedCouponCode,
        ...(hasManualDiscountValue
          ? { discountType, discountValue: Number(discountValue) }
          : {}),
      });
      toast.success(invoice.couponCode ? "Discount replaced successfully" : "Discount applied successfully");
      setCouponCode("");
      setDiscountValue("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to apply discount"
      );
    } finally {
      setIsApplyingDiscount(false);
    }
  };

  const handleRemoveDiscount = async () => {
    if (!invoice) return;
    setIsApplyingDiscount(true);
    try {
      await removeDiscountFromInvoice({
        invoiceId: invoice._id,
      });
      toast.success("Discount removed successfully");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove discount"
      );
    } finally {
      setIsApplyingDiscount(false);
    }
  };
  const normalizedCouponPreview = normalizeStripeCouponCode(couponCode);

  useEffect(() => {
    if (!invoice) return;
    setBillingDueDate(invoice.dueDate);
    setBillingMethod(
      invoice.remainingBalanceCollectionMethod ?? "send_invoice",
    );
  }, [invoice]);

  const handleRetryInvoice = async () => {
    setIsRetrying(true);
    try {
      await retryInvoiceGeneration({ invoiceId });
      toast.success("Invoice generation retried. Check back shortly.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to retry invoice generation",
      );
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSaveBilling = async (reissue: boolean) => {
    if (!billingDueDate) {
      toast.error("Select a due date first");
      return;
    }
    if (canReissue && !reissue) {
      toast.error("Use Save & Reissue Invoice to update the live Stripe invoice");
      return;
    }

    setIsSavingBilling(true);
    try {
      await updateBillingSettings({
        invoiceId,
        dueDate: billingDueDate,
        remainingBalanceCollectionMethod: billingMethod,
      });

      if (reissue) {
        await reissueStripeInvoice({ invoiceId });
        toast.success("Billing settings saved and Stripe invoice reissued");
      } else {
        toast.success("Billing settings updated");
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update billing settings",
      );
    } finally {
      setIsSavingBilling(false);
    }
  };

  if (invoice === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (invoice === null) {
    return (
      <div className="space-y-6">
        <Link href="/admin/payments">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Payments
          </Button>
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Invoice Not Found</h3>
            <p className="text-muted-foreground mb-6">
              The invoice you&apos;re looking for doesn&apos;t exist.
            </p>
            <Link href="/admin/payments">
              <Button>Return to Payments</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasDeposit = invoice.depositAmount != null && invoice.depositAmount > 0;
  const canEditBilling =
    (invoice.paymentOption ?? "deposit") === "deposit" &&
    (invoice.remainingBalance ?? 0) > 0 &&
    invoice.status !== "paid";
  const canReissue = canEditBilling && Boolean(invoice.stripeInvoiceId);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/payments">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Payments
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold">{invoice.invoiceNumber}</h2>
              {getStatusBadge(invoice.status)}
            </div>
            <p className="text-muted-foreground">
              Created {formatDate(new Date(invoice._creationTime).toISOString())}
            </p>
          </div>
        </div>
        {invoice.stripeInvoiceUrl && (
          <a
            href={invoice.stripeInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline">
              <ExternalLink className="w-4 h-4 mr-2" />
              View in Stripe
            </Button>
          </a>
        )}
      </div>

      {/* Invoice Generation Error Banner */}
      {invoice.invoiceGenerationError && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-start gap-4 py-4">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-destructive">
                Stripe Invoice Generation Failed
              </p>
              <p className="text-sm text-muted-foreground mt-1 break-words">
                {invoice.invoiceGenerationError}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryInvoice}
              disabled={isRetrying}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRetrying ? "animate-spin" : ""}`} />
              {isRetrying ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      )}

      {canEditBilling && (
        <Card>
          <CardHeader>
            <CardTitle>Remaining Balance Billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="billing-due-date">Due date</Label>
                <Input
                  id="billing-due-date"
                  type="date"
                  value={billingDueDate}
                  onChange={(event) => setBillingDueDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Collection method</Label>
                <Select
                  value={billingMethod}
                  onValueChange={(value) =>
                    setBillingMethod(
                      value as "send_invoice" | "charge_automatically",
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="send_invoice">Send invoice</SelectItem>
                    <SelectItem value="charge_automatically">
                      Charge automatically
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {canReissue && (
              <p className="text-sm text-muted-foreground">
                This invoice already exists in Stripe. Reissue it to apply the updated terms there too.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {!canReissue && (
                <Button
                  variant="outline"
                  onClick={() => void handleSaveBilling(false)}
                  disabled={isSavingBilling}
                >
                  {isSavingBilling ? "Saving..." : "Save Billing Settings"}
                </Button>
              )}
              {canReissue && (
                <Button
                  onClick={() => void handleSaveBilling(true)}
                  disabled={isSavingBilling}
                >
                  {isSavingBilling ? "Reissuing..." : "Save & Reissue Invoice"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {invoice.status !== "paid" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Apply Discount / Coupon
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {invoice.couponCode ? (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 border rounded-md bg-primary/5">
                <div>
                  <p className="font-semibold text-primary">Active Discount: {invoice.couponCode}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Amount off: {formatCurrency(invoice.discountAmount || 0)}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRemoveDiscount}
                  disabled={isApplyingDiscount}
                >
                  Remove Discount
                </Button>
              </div>
            ) : null}
            <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="coupon-code">Coupon / Promo Code</Label>
                    <Input
                      id="coupon-code"
                      placeholder="e.g. SAVE20"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      className="uppercase"
                    />
                    {couponCode.trim() && (
                      <p className="text-xs text-muted-foreground">
                        Saves as{" "}
                        <span className="font-mono">
                          {normalizedCouponPreview || "COUPON"}
                        </span>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Enter an existing Stripe coupon code, or add a type and
                      value below to create a one-off discount.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="discount-type">Discount Type</Label>
                    <Select
                      value={discountType}
                      onValueChange={(val) => setDiscountType(val as "percent" | "amount")}
                    >
                      <SelectTrigger id="discount-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Percentage Off (%)</SelectItem>
                        <SelectItem value="amount">Fixed Amount Off ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-value">Discount Value</Label>
                  <div className="flex gap-3">
                    <Input
                      id="discount-value"
                      type="number"
                      placeholder={discountType === "percent" ? "Optional, e.g. 20" : "Optional, e.g. 15"}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value === "" ? "" : Number(e.target.value))}
                      min={1}
                    />
                    <Button
                      onClick={handleApplyDiscount}
                      disabled={isApplyingDiscount}
                      className="whitespace-nowrap"
                    >
                      {isApplyingDiscount
                        ? "Applying..."
                        : invoice.couponCode
                          ? "Replace Discount"
                          : "Apply Discount"}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <span className="text-xs text-muted-foreground w-full font-medium">Quick Presets:</span>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    className="text-xs h-7"
                    onClick={() => {
                      setCouponCode("10PERCENT");
                      setDiscountType("percent");
                      setDiscountValue(10);
                    }}
                  >
                    10% Off
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    className="text-xs h-7"
                    onClick={() => {
                      setCouponCode("20PERCENT");
                      setDiscountType("percent");
                      setDiscountValue(20);
                    }}
                  >
                    20% Off
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    className="text-xs h-7"
                    onClick={() => {
                      setCouponCode("25OFF");
                      setDiscountType("amount");
                      setDiscountValue(25);
                    }}
                  >
                    $25 Off
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    className="text-xs h-7"
                    onClick={() => {
                      setCouponCode("50OFF");
                      setDiscountType("amount");
                      setDiscountValue(50);
                    }}
                  >
                    $50 Off
                  </Button>
                </div>
              </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(invoice.total)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Due Date</CardTitle>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDate(invoice.dueDate)}</div>
          </CardContent>
        </Card>

        {hasDeposit && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Deposit</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(invoice.depositAmount!)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {invoice.depositPaid ? "Paid" : "Unpaid"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Remaining</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(invoice.remainingBalance ?? invoice.total - (invoice.depositAmount ?? 0))}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {invoice.paidDate && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Paid Date</CardTitle>
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatDate(invoice.paidDate)}</div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item: InvoiceLineItem, index: number) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{item.serviceName}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.totalPrice)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="text-right font-medium">
                  Subtotal
                </TableCell>
                <TableCell className="text-right">{formatCurrency(invoice.subtotal)}</TableCell>
              </TableRow>
              {invoice.couponCode && (
                <TableRow className="text-primary bg-primary/5">
                  <TableCell colSpan={3} className="text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5" />
                      Discount ({invoice.couponCode})
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold">-{formatCurrency(invoice.discountAmount || 0)}</TableCell>
                </TableRow>
              )}
              {invoice.giftCardApplied ? (
                <TableRow className="text-emerald-700 bg-emerald-500/5">
                  <TableCell colSpan={3} className="text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5" />
                      Gift card credit
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    -{formatCurrency(invoice.giftCardApplied)}
                  </TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                <TableCell colSpan={3} className="text-right font-medium">
                  Tax
                </TableCell>
                <TableCell className="text-right">{formatCurrency(invoice.tax)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right text-lg font-bold">
                  Total
                </TableCell>
                <TableCell className="text-right text-lg font-bold">
                  {formatCurrency(invoice.total)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Related Links */}
      <Card>
        <CardHeader>
          <CardTitle>Related</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {appointment?.scheduledDate && (
            <p className="text-sm text-muted-foreground">
              Scheduled for {formatDateString(appointment.scheduledDate)}
            </p>
          )}
          <div className="flex gap-3">
          <Link href={`/admin/appointments/${invoice.appointmentId}`}>
            <Button variant="outline" size="sm">
              <Calendar className="w-4 h-4 mr-2" />
              View Appointment
            </Button>
          </Link>
          <Link href={`/admin/customers/${invoice.userId}`}>
            <Button variant="outline" size="sm">
              View Customer
            </Button>
          </Link>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
