"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { ArrowRight, Check, Gift, Loader2, Mail, Printer, UserRound } from "lucide-react";
import { toast } from "sonner";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GiftCardVisual } from "@/components/gift-cards/gift-card-visual";

const PRESETS = [100, 200, 300, 400, 500];

type ForWhom = "self" | "other";
type Delivery = "email" | "print";

export function GiftCardPurchaseClient({
  initialAmount,
  canceled,
}: {
  initialAmount?: number;
  canceled?: boolean;
}) {
  const { user, isLoaded } = useUser();
  const createPurchase = useAction(api.giftCards.createPurchase);
  const [showCanceled, setShowCanceled] = React.useState(Boolean(canceled));

  const [forWhom, setForWhom] = React.useState<ForWhom>("other");
  const [delivery, setDelivery] = React.useState<Delivery>("email");
  const [amount, setAmount] = React.useState(initialAmount ?? 100);
  const [customMode, setCustomMode] = React.useState(false);
  const [customAmount, setCustomAmount] = React.useState("");
  const [purchaserName, setPurchaserName] = React.useState("");
  const [purchaserEmail, setPurchaserEmail] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientEmail, setRecipientEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [pinEnabled, setPinEnabled] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!isLoaded || !user) return;
    setPurchaserName((current) => current || user.fullName || "");
    setPurchaserEmail(
      (current) => current || user.primaryEmailAddress?.emailAddress || "",
    );
  }, [isLoaded, user]);

  const resolvedAmount = customMode ? Number(customAmount) : amount;
  const amountIsValid =
    Number.isFinite(resolvedAmount) &&
    resolvedAmount >= 100 &&
    resolvedAmount <= 1000 &&
    resolvedAmount % 100 === 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!amountIsValid) {
      toast.error("Choose an amount between $100 and $1,000 in $100 increments.");
      return;
    }
    if (!purchaserName.trim() || !purchaserEmail.trim()) {
      toast.error("Enter your name and email so we can send the receipt.");
      return;
    }
    if (forWhom === "other" && delivery === "email" && !recipientEmail.trim()) {
      toast.error("Enter the recipient's email, or choose Print it myself.");
      return;
    }
    if (pinEnabled && !/^\d{4}$/.test(pin.trim())) {
      toast.error("The PIN must be exactly 4 digits.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createPurchase({
        amount: resolvedAmount,
        deliveryMethod:
          forWhom === "self" ? "self" : delivery === "email" ? "email" : "print",
        purchaserName: purchaserName.trim(),
        purchaserEmail: purchaserEmail.trim(),
        recipientName:
          forWhom === "other" ? recipientName.trim() || undefined : undefined,
        recipientEmail:
          forWhom === "other" && delivery === "email"
            ? recipientEmail.trim()
            : undefined,
        message: message.trim() || undefined,
        pin: pinEnabled ? pin.trim() : undefined,
        origin: window.location.origin,
      });
      window.location.href = result.url;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't start your gift card purchase.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start">
      <form onSubmit={handleSubmit} className="space-y-7">
        {showCanceled ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
            <p>
              Checkout was canceled. Your card wasn&apos;t charged — you can
              pick up where you left off.
            </p>
            <button
              type="button"
              onClick={() => setShowCanceled(false)}
              className="text-xs font-semibold underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <Card className="border-border/60 bg-card/80 shadow-sm backdrop-blur">
          <CardContent className="space-y-6 p-5 sm:p-7">
            <div className="space-y-3">
              <Label>Who is this for?</Label>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceCard
                  active={forWhom === "self"}
                  onClick={() => setForWhom("self")}
                  icon={<UserRound className="h-4 w-4" />}
                  title="Myself"
                  description="Stored in your account"
                />
                <ChoiceCard
                  active={forWhom === "other"}
                  onClick={() => setForWhom("other")}
                  icon={<Gift className="h-4 w-4" />}
                  title="Someone else"
                  description="Email or print it"
                />
              </div>
            </div>

            {forWhom === "other" ? (
              <div className="space-y-3">
                <Label>How should they receive it?</Label>
                <div className="grid grid-cols-2 gap-3">
                  <ChoiceCard
                    active={delivery === "email"}
                    onClick={() => setDelivery("email")}
                    icon={<Mail className="h-4 w-4" />}
                    title="Email it"
                    description="Send the digital card"
                  />
                  <ChoiceCard
                    active={delivery === "print"}
                    onClick={() => setDelivery("print")}
                    icon={<Printer className="h-4 w-4" />}
                    title="Print it myself"
                    description="No recipient email needed"
                  />
                </div>
                {delivery === "print" ? (
                  <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                    After payment you&apos;ll get a print-ready front and back
                    card with the code. Hand it to them whenever you&apos;re ready.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                We&apos;ll attach the card to your account using your email. You
                can print it or use it at checkout anytime.
              </p>
            )}

            <div className="space-y-3">
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
                      "h-10 min-w-[72px] rounded-xl border px-4 text-sm font-semibold transition-colors",
                      !customMode && amount === preset
                        ? "border-[#c9a227] bg-[#c9a227]/10 text-foreground"
                        : "border-border bg-background hover:border-[#c9a227]/60",
                    )}
                  >
                    ${preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomMode(true)}
                  className={cn(
                    "h-10 rounded-xl border px-4 text-sm font-semibold transition-colors",
                    customMode
                      ? "border-[#c9a227] bg-[#c9a227]/10 text-foreground"
                      : "border-border bg-background hover:border-[#c9a227]/60",
                  )}
                >
                  Custom
                </button>
              </div>
              {customMode ? (
                <div className="space-y-1.5">
                  <Input
                    type="number"
                    min={100}
                    max={1000}
                    step={100}
                    value={customAmount}
                    onChange={(event) => setCustomAmount(event.target.value)}
                    placeholder="Enter $100–$1,000"
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    $100 increments, up to $1,000.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="purchaser-name">Your name</Label>
                <Input
                  id="purchaser-name"
                  value={purchaserName}
                  onChange={(event) => setPurchaserName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="purchaser-email">Your email</Label>
                <Input
                  id="purchaser-email"
                  type="email"
                  value={purchaserEmail}
                  onChange={(event) => setPurchaserEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
            </div>

            {forWhom === "other" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="recipient-name">Their name (optional)</Label>
                  <Input
                    id="recipient-name"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Recipient name"
                  />
                </div>
                {delivery === "email" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="recipient-email">Their email</Label>
                    <Input
                      id="recipient-email"
                      type="email"
                      value={recipientEmail}
                      onChange={(event) => setRecipientEmail(event.target.value)}
                      placeholder="them@example.com"
                    />
                  </div>
                ) : (
                  <div className="flex items-end">
                    <p className="pb-2 text-xs text-muted-foreground">
                      No email needed for a printed card.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="gift-message">Message (optional)</Label>
              <Textarea
                id="gift-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add a short note for them."
                maxLength={240}
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Add a 4-digit PIN</p>
                <p className="text-xs text-muted-foreground">
                  Optional extra protection. Share it separately.
                </p>
              </div>
              <Switch checked={pinEnabled} onCheckedChange={setPinEnabled} />
            </div>
            {pinEnabled ? (
              <Input
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="4-digit PIN"
                inputMode="numeric"
                maxLength={4}
                className="h-11 max-w-[180px] text-center font-mono text-lg tracking-[0.35em]"
              />
            ) : null}

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              className="w-full bg-[#1a1714] text-white hover:bg-[#2a2520]"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              {isSubmitting
                ? "Starting secure checkout..."
                : `Continue to payment — $${amountIsValid ? resolvedAmount.toFixed(0) : "—"}`}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Secure checkout by Stripe. Gift cards never expire and have no
              cash value.
            </p>
          </CardContent>
        </Card>
      </form>

      <div className="lg:sticky lg:top-24">
        <GiftCardVisual
          amount={amountIsValid ? resolvedAmount : 100}
          recipientName={
            forWhom === "other" ? recipientName.trim() || undefined : purchaserName.trim() || "You"
          }
          purchaserName={purchaserName.trim() || undefined}
          message={message.trim() || undefined}
          size="lg"
        />
        <div className="mx-auto mt-8 max-w-md space-y-3 rounded-2xl border border-border/60 bg-card/70 p-5 text-sm">
          <p className="font-semibold">How it works</p>
          <Step
            number="1"
            text={
              forWhom === "self"
                ? "Buy it and it lands in your account."
                : delivery === "email"
                  ? "We email them a branded digital card."
                  : "You get a print-ready card to hand over."
            }
          />
          <Step number="2" text="They claim it with their email, or use the code at checkout." />
          <Step number="3" text="Apply it to any service or outstanding invoice. Any remainder stays on the card." />
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-[#c9a227] bg-[#c9a227]/10"
          : "border-border bg-background hover:border-[#c9a227]/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-[#1a1714] text-[#c9a227]" : "bg-secondary text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {active ? <Check className="h-3.5 w-3.5 text-[#8a6a12]" /> : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a1714] text-[10px] font-bold text-[#c9a227]">
        {number}
      </span>
      <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
