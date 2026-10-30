"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { CheckCircle2, Loader2, Printer, TriangleAlert } from "lucide-react";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GiftCardVisual } from "@/components/gift-cards/gift-card-visual";

export function GiftCardSuccessClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const card = useQuery(
    api.giftCards.getByAccessToken,
    token ? { token } : "skip",
  );

  if (!token) {
    return <ErrorState message="This gift card link is missing its access token." />;
  }

  if (card === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (card === null) {
    return <ErrorState message="We couldn't find this gift card." />;
  }

  if (card.status === "pending_payment") {
    return (
      <Card className="mx-auto max-w-xl border-border/60">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#8a6a12]" />
          <h1 className="font-serif text-2xl">Finalizing your gift card</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Stripe is confirming the payment. This usually takes a few seconds.
            This page will update automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (card.status === "voided") {
    return <ErrorState message="This gift card purchase was cancelled or refunded." />;
  }

  const printUrl = `/gift-cards/print/${token}`;
  const isEmailDelivery = card.deliveryMethod === "email";

  return (
    <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Payment received
            </p>
            <h1 className="font-serif text-3xl">Your gift card is ready</h1>
          </div>
        </div>

        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          {isEmailDelivery
            ? `We emailed the card to ${card.recipientEmailMasked ?? "the recipient"}. They can claim it with that email or use the code at checkout.`
            : card.deliveryMethod === "self"
              ? "The card is attached to your account. Use it at checkout or print it for safekeeping."
              : "Print the card below and hand it to the recipient. The code is ready to use."}
        </p>

        <Card className="border-border/60 bg-card/80">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Code
                </p>
                <p className="mt-1 font-mono text-lg font-bold tracking-[0.12em]">
                  {card.code ?? "Available once active"}
                </p>
              </div>
              <span className="rounded-full bg-[#c9a227]/10 px-3 py-1 text-xs font-semibold text-[#8a6a12]">
                ${card.availableBalance.toFixed(2)} available
              </span>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Amount" value={`$${card.amount.toFixed(2)}`} />
              <Detail
                label="Delivery"
                value={
                  card.deliveryMethod === "email"
                    ? "Email"
                    : card.deliveryMethod === "self"
                      ? "My account"
                      : "Print at home"
                }
              />
              <Detail
                label="Purchased by"
                value={card.purchaserName || "You"}
              />
              {card.recipientName ? (
                <Detail label="Recipient" value={card.recipientName} />
              ) : null}
            </div>

            {card.pin ? (
              <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  PIN — share separately
                </p>
                <p className="mt-1 font-mono text-xl font-bold tracking-[0.3em]">
                  {card.pin}
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1 bg-[#1a1714] text-white hover:bg-[#2a2520]">
                <Link href={printUrl}>
                  <Printer className="mr-2 h-4 w-4" />
                  View &amp; Print Card
                </Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href="/dashboard/gift-cards">Go to My Gift Cards</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Keep this page private. Anyone with the code can use the remaining
          balance. Gift cards never expire.
        </p>
      </div>

      <div className="lg:sticky lg:top-24">
        <GiftCardVisual
          amount={card.amount}
          balance={card.availableBalance}
          code={card.code}
          recipientName={card.recipientName}
          purchaserName={card.purchaserName}
          message={card.message}
          status={card.status}
          size="lg"
        />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-xl border-border/60">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <TriangleAlert className="h-8 w-8 text-destructive" />
        <h1 className="font-serif text-2xl">Gift card unavailable</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button asChild variant="outline">
          <Link href="/gift-cards">Buy a gift card</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
