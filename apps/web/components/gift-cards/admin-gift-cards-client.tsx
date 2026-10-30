"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Banknote,
  Check,
  Copy,
  CreditCard,
  Gift,
  Loader2,
  Mail,
  Plus,
  Printer,
  Search,
  Send,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

const PRESETS = [100, 200, 300, 400, 500];

export function AdminGiftCardsClient() {
  const stats = useQuery(api.giftCards.getAdminStats);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const cards = useQuery(api.giftCards.listAdmin, {
    status: statusFilter,
    search: search || undefined,
  });
  const [sellOpen, setSellOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<Id<"giftCards"> | null>(
    null,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Payments
          </p>
          <h1 className="mt-1 font-serif text-3xl">Gift Cards</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Sell gift cards in person or online, track outstanding balances, and
            apply credit to a customer&apos;s invoice.
          </p>
        </div>
        <Button
          onClick={() => setSellOpen(true)}
          className="bg-[#1a1714] text-white hover:bg-[#2a2520]"
        >
          <Plus className="mr-2 h-4 w-4" />
          Sell Gift Card
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding balance"
          value={`$${(stats?.outstanding ?? 0).toFixed(2)}`}
          hint="Unspent customer credit"
          icon={<Gift className="h-4 w-4" />}
        />
        <StatCard
          label="Active cards"
          value={String(stats?.activeCount ?? 0)}
          hint="With a balance"
          icon={<CreditCard className="h-4 w-4" />}
        />
        <StatCard
          label="Sold this month"
          value={`$${(stats?.soldThisMonth ?? 0).toFixed(2)}`}
          hint="Issued gift cards"
          icon={<Banknote className="h-4 w-4" />}
        />
        <StatCard
          label="Redeemed this month"
          value={`$${(stats?.redeemedThisMonth ?? 0).toFixed(2)}`}
          hint="Applied to orders"
          icon={<Check className="h-4 w-4" />}
        />
      </div>

      <Card className="border-border/60">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search code, purchaser, or recipient"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending_payment">Pending payment</SelectItem>
                <SelectItem value="depleted">Used</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Card</TableHead>
                  <TableHead>Purchaser</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards === undefined ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : cards.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      No gift cards match this view.
                    </TableCell>
                  </TableRow>
                ) : (
                  cards.map((card) => (
                    <TableRow
                      key={card._id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(card._id)}
                    >
                      <TableCell>
                        <div className="font-mono text-sm font-semibold">
                          •••• {card.codeLast4}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {card.deliveryMethod === "email"
                            ? "Email"
                            : card.deliveryMethod === "print"
                              ? "Print"
                              : "Account"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">
                          {card.purchaserName}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {card.purchaserEmail || "No email"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {card.recipientName || "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {card.claimedByName
                            ? `Claimed by ${card.claimedByName}`
                            : card.recipientEmail || "Unclaimed"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${card.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ${card.availableBalance.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={card.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(card.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SellGiftCardDialog open={sellOpen} onOpenChange={setSellOpen} />
      <GiftCardDetailDialog
        giftCardId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center justify-between text-muted-foreground">
          <p className="text-xs font-semibold uppercase tracking-[0.14em]">
            {label}
          </p>
          <span className="text-[#8a6a12]">{icon}</span>
        </div>
        <p className="font-serif text-3xl">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "pending_payment"
      ? "Pending"
      : status === "active"
        ? "Active"
        : status === "depleted"
          ? "Used"
          : "Voided";
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "active" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
        status === "pending_payment" && "border-amber-500/30 bg-amber-500/10 text-amber-800",
        status === "depleted" && "border-border bg-secondary text-muted-foreground",
        status === "voided" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </Badge>
  );
}

function SellGiftCardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createAdminSale = useAction(api.giftCards.createAdminSale);
  const [amount, setAmount] = React.useState(100);
  const [customMode, setCustomMode] = React.useState(false);
  const [customAmount, setCustomAmount] = React.useState("");
  const [deliveryMethod, setDeliveryMethod] = React.useState<
    "self" | "email" | "print"
  >("self");
  const [paymentMethod, setPaymentMethod] = React.useState<
    "stripe" | "cash" | "comp"
  >("stripe");
  const [purchaserName, setPurchaserName] = React.useState("");
  const [purchaserEmail, setPurchaserEmail] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    url?: string;
    code?: string;
    accessToken: string;
    status: string;
  } | null>(null);

  const resolvedAmount = customMode ? Number(customAmount) : amount;

  const reset = () => {
    setResult(null);
    setPurchaserName("");
    setPurchaserEmail("");
    setRecipientName("");
    setRecipientEmail("");
    setPin("");
    setNotes("");
    setCustomMode(false);
    setCustomAmount("");
    setAmount(100);
    setDeliveryMethod("self");
    setPaymentMethod("stripe");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !Number.isFinite(resolvedAmount) ||
      resolvedAmount < 100 ||
      resolvedAmount > 1000 ||
      resolvedAmount % 100 !== 0
    ) {
      toast.error("Choose $100–$1,000 in $100 increments.");
      return;
    }
    if (!purchaserName.trim()) {
      toast.error("Enter the purchaser's name.");
      return;
    }
    if (deliveryMethod === "email" && !recipientEmail.trim()) {
      toast.error("Enter the recipient email or switch to print/account.");
      return;
    }
    setIsSubmitting(true);
    try {
      const sale = await createAdminSale({
        amount: resolvedAmount,
        deliveryMethod,
        paymentMethod,
        purchaserName: purchaserName.trim(),
        purchaserEmail: purchaserEmail.trim() || undefined,
        recipientName: recipientName.trim() || undefined,
        recipientEmail: recipientEmail.trim() || undefined,
        pin: pin.trim() || undefined,
        notes: notes.trim() || undefined,
        origin: window.location.origin,
      });
      setResult({
        url: sale.url,
        code: sale.code,
        accessToken: sale.accessToken,
        status: sale.status,
      });
      toast.success(
        sale.status === "active"
          ? "Gift card issued"
          : "Checkout link ready to share",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sell gift card",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sell a gift card</DialogTitle>
          <DialogDescription>
            Take payment now with a Stripe link, record cash, or issue a
            complimentary card. The card activates after payment.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="font-semibold text-emerald-800">
                {result.status === "active"
                  ? "Gift card issued"
                  : "Checkout link ready"}
              </p>
              <p className="mt-1 text-sm text-emerald-800/80">
                {result.status === "active"
                  ? "The card is active and ready to use or print."
                  : "Send this link to the purchaser. The card activates automatically after payment."}
              </p>
            </div>

            {result.url ? (
              <div className="space-y-2">
                <Label>Payment link</Label>
                <div className="flex gap-2">
                  <Input value={result.url} readOnly className="font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.url!);
                      toast.success("Link copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <a href={result.url} target="_blank" rel="noreferrer">
                    Open checkout
                  </a>
                </Button>
              </div>
            ) : null}

            {result.code ? (
              <div className="space-y-2">
                <Label>Gift card code</Label>
                <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-4 text-center font-mono text-lg font-bold tracking-[0.14em]">
                  {result.code}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              {result.status === "active" ? (
                <Button asChild variant="outline" className="flex-1">
                  <a
                    href={`/gift-cards/print/${result.accessToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print card
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  reset();
                }}
              >
                Sell another
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Amount</Label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAmount(preset);
                      setCustomMode(false);
                    }}
                    className={cn(
                      "h-9 rounded-lg border px-3 text-sm font-semibold",
                      !customMode && amount === preset
                        ? "border-[#c9a227] bg-[#c9a227]/10"
                        : "border-border",
                    )}
                  >
                    ${preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomMode(true)}
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm font-semibold",
                    customMode ? "border-[#c9a227] bg-[#c9a227]/10" : "border-border",
                  )}
                >
                  Custom
                </button>
              </div>
              {customMode ? (
                <Input
                  type="number"
                  min={100}
                  max={1000}
                  step={100}
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  placeholder="$100–$1,000"
                />
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Delivery</Label>
                <Select
                  value={deliveryMethod}
                  onValueChange={(value) =>
                    setDeliveryMethod(value as "self" | "email" | "print")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Hand to customer / account</SelectItem>
                    <SelectItem value="email">Email to recipient</SelectItem>
                    <SelectItem value="print">Print at home</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(value) =>
                    setPaymentMethod(value as "stripe" | "cash" | "comp")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stripe">Stripe checkout link</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="comp">Complimentary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Purchaser name</Label>
                <Input
                  value={purchaserName}
                  onChange={(event) => setPurchaserName(event.target.value)}
                  placeholder="Who is paying?"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Purchaser email (optional)</Label>
                <Input
                  type="email"
                  value={purchaserEmail}
                  onChange={(event) => setPurchaserEmail(event.target.value)}
                  placeholder="Receipt email"
                />
              </div>
            </div>

            {deliveryMethod !== "self" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Recipient name (optional)</Label>
                  <Input
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Who is it for?"
                  />
                </div>
                {deliveryMethod === "email" ? (
                  <div className="space-y-1.5">
                    <Label>Recipient email</Label>
                    <Input
                      type="email"
                      value={recipientEmail}
                      onChange={(event) => setRecipientEmail(event.target.value)}
                      placeholder="them@example.com"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>PIN (optional)</Label>
                <Input
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="4 digits"
                  maxLength={4}
                  inputMode="numeric"
                  className="max-w-[160px] text-center font-mono tracking-[0.3em]"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Internal note (optional)</Label>
                <Input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Door knock, event, etc."
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#1a1714] text-white hover:bg-[#2a2520]"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {isSubmitting
                ? "Creating..."
                : paymentMethod === "stripe"
                  ? "Create Checkout Link"
                  : "Issue Gift Card"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GiftCardDetailDialog({
  giftCardId,
  onOpenChange,
}: {
  giftCardId: Id<"giftCards"> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useQuery(
    api.giftCards.getAdminDetail,
    giftCardId ? { giftCardId } : "skip",
  );
  const customers = useQuery(api.users.listWithStats, {});
  const invoices = useQuery(api.invoices.listWithDetails, {});
  const resend = useAction(api.giftCards.resendGiftCardEmail);
  const applyToInvoice = useAction(api.payments.applyGiftCardToInvoice);
  const assign = useMutation(api.giftCards.assignGiftCardToCustomer);
  const adjust = useMutation(api.giftCards.adjustGiftCardBalance);
  const voidCard = useMutation(api.giftCards.voidGiftCard);
  const markCashPaid = useMutation(api.giftCards.markCashPaid);

  const [customerId, setCustomerId] = React.useState("");
  const [invoiceId, setInvoiceId] = React.useState("");
  const [adjustAmount, setAdjustAmount] = React.useState("");
  const [adjustNote, setAdjustNote] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);

  React.useEffect(() => {
    setCustomerId("");
    setInvoiceId("");
    setAdjustAmount("");
    setAdjustNote("");
  }, [giftCardId]);

  const handleResend = async (audience: "recipient" | "purchaser") => {
    if (!giftCardId) return;
    setIsBusy(true);
    try {
      await resend({ giftCardId, audience });
      toast.success("Email resent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resend");
    } finally {
      setIsBusy(false);
    }
  };

  const handleAssign = async () => {
    if (!giftCardId || !customerId) return;
    setIsBusy(true);
    try {
      await assign({
        giftCardId,
        userId: customerId as Id<"users">,
      });
      toast.success("Gift card assigned to customer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign");
    } finally {
      setIsBusy(false);
    }
  };

  const handleApply = async () => {
    if (!giftCardId || !invoiceId || !detail) return;
    setIsBusy(true);
    try {
      const result = await applyToInvoice({
        invoiceId: invoiceId as Id<"invoices">,
        code: detail.code,
        pin: detail.pin,
      });
      toast.success(
        `Applied $${result.appliedAmount.toFixed(2)} — $${result.newRemainingBalance.toFixed(2)} remaining`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not apply gift card",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleAdjust = async () => {
    if (!giftCardId) return;
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter a positive or negative adjustment.");
      return;
    }
    setIsBusy(true);
    try {
      await adjust({
        giftCardId,
        amount,
        note: adjustNote.trim() || "Admin adjustment",
      });
      setAdjustAmount("");
      setAdjustNote("");
      toast.success("Balance adjusted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not adjust");
    } finally {
      setIsBusy(false);
    }
  };

  const handleVoid = async () => {
    if (!giftCardId) return;
    const reason = window.prompt("Reason for voiding this gift card?");
    if (!reason) return;
    setIsBusy(true);
    try {
      await voidCard({ giftCardId, reason });
      toast.success("Gift card voided");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not void");
    } finally {
      setIsBusy(false);
    }
  };

  const unpaidInvoices = (invoices ?? []).filter(
    (invoice: {
      status: string;
      remainingBalance?: number;
      total: number;
      depositPaid?: boolean;
      paymentOption?: string;
    }) =>
      invoice.status !== "paid" &&
      (invoice.depositPaid || invoice.paymentOption !== "deposit") &&
      ((invoice.remainingBalance ?? invoice.total) > 0),
  );

  return (
    <Dialog open={Boolean(giftCardId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Gift card details</DialogTitle>
          <DialogDescription>
            Review the ledger, resend delivery, assign the card, or apply it to
            an invoice.
          </DialogDescription>
        </DialogHeader>

        {!detail ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#c9a227]/30 bg-[#1a1714] p-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c9a227]">
                    Code
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold tracking-[0.12em]">
                    {detail.code}
                  </p>
                  {detail.pin ? (
                    <p className="mt-1 text-xs text-white/60">
                      PIN: <span className="font-mono tracking-[0.2em]">{detail.pin}</span>
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                    Available
                  </p>
                  <p className="font-serif text-3xl">
                    ${detail.availableBalance.toFixed(2)}
                  </p>
                  <p className="text-xs text-white/45">
                    of ${detail.amount.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="Status" value={<StatusBadge status={detail.status} />} />
              <Info
                label="Payment"
                value={`${detail.paymentMethod} · ${detail.source.replaceAll("_", " ")}`}
              />
              <Info label="Purchaser" value={`${detail.purchaserName}${detail.purchaserEmail ? ` (${detail.purchaserEmail})` : ""}`} />
              <Info
                label="Recipient"
                value={
                  detail.claimedUser
                    ? `${detail.claimedUser.name || detail.claimedUser.email} (claimed)`
                    : detail.recipientName || detail.recipientEmail || "Unclaimed"
                }
              />
              <Info
                label="Reserved"
                value={`$${detail.reservedBalance.toFixed(2)}`}
              />
              <Info
                label="Created"
                value={new Date(detail.createdAt).toLocaleString()}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {detail.recipientEmail ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void handleResend("recipient")}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Resend recipient email
                </Button>
              ) : null}
              {detail.purchaserEmail ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void handleResend("purchaser")}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Resend receipt
                </Button>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/gift-cards/print/${detail.accessToken}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print card
                </a>
              </Button>
              {detail.status === "pending_payment" &&
              detail.paymentMethod === "cash" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    setIsBusy(true);
                    void markCashPaid({ giftCardId: detail._id })
                      .then(() => toast.success("Marked paid"))
                      .catch((error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Could not mark paid",
                        ),
                      )
                      .finally(() => setIsBusy(false));
                  }}
                >
                  <Banknote className="mr-2 h-4 w-4" />
                  Mark cash paid
                </Button>
              ) : null}
            </div>

            <div className="grid gap-4 rounded-xl border border-border/60 p-4 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Assign to customer</p>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {(customers ?? [])
                      .slice(0, 100)
                      .map(
                        (customer: {
                          _id: string;
                          name?: string;
                          email?: string;
                        }) => (
                          <SelectItem key={customer._id} value={customer._id}>
                            {customer.name || customer.email || "Unknown"}
                          </SelectItem>
                        ),
                      )}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!customerId || isBusy}
                  onClick={() => void handleAssign()}
                >
                  <UserRound className="mr-2 h-4 w-4" />
                  Assign
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Apply to an invoice</p>
                <Select value={invoiceId} onValueChange={setInvoiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an unpaid invoice" />
                  </SelectTrigger>
                  <SelectContent>
                    {unpaidInvoices.slice(0, 100).map(
                      (invoice: {
                        _id: string;
                        invoiceNumber: string;
                        customer: string;
                        remainingBalance?: number;
                        total: number;
                      }) => (
                        <SelectItem key={invoice._id} value={invoice._id}>
                          {invoice.invoiceNumber} · {invoice.customer} · $
                          {(invoice.remainingBalance ?? invoice.total).toFixed(
                            2,
                          )}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!invoiceId || isBusy}
                  onClick={() => void handleApply()}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Apply credit
                </Button>
              </div>
            </div>

            <div className="grid gap-4 rounded-xl border border-border/60 p-4 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Adjust balance</p>
                <Input
                  type="number"
                  value={adjustAmount}
                  onChange={(event) => setAdjustAmount(event.target.value)}
                  placeholder="e.g. 25 or -10"
                />
                <Input
                  value={adjustNote}
                  onChange={(event) => setAdjustNote(event.target.value)}
                  placeholder="Reason"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void handleAdjust()}
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  Save adjustment
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Danger zone</p>
                <p className="text-xs text-muted-foreground">
                  Voiding removes the remaining balance. Refund the Stripe
                  charge separately if the purchase is being refunded.
                </p>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isBusy || detail.status === "voided"}
                  onClick={() => void handleVoid()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Void gift card
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Activity</p>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {detail.transactions.length ? (
                  detail.transactions.map(
                    (tx: {
                      _id: string;
                      type: string;
                      amount: number;
                      createdAt: number;
                      note?: string;
                    }) => (
                    <div
                      key={tx._id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium capitalize">{tx.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleString()}
                          {tx.note ? ` · ${tx.note}` : ""}
                        </p>
                      </div>
                      <p
                        className={
                          tx.amount < 0
                            ? "font-semibold text-destructive"
                            : "font-semibold text-emerald-600"
                        }
                      >
                        {tx.amount < 0 ? "-" : "+"}$
                        {Math.abs(tx.amount).toFixed(2)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No activity.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
