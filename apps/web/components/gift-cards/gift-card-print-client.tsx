"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowLeft, Loader2, Printer, TriangleAlert } from "lucide-react";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function GiftCardPrintClient() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const card = useQuery(
    api.giftCards.getByAccessToken,
    token ? { token } : "skip",
  );

  React.useEffect(() => {
    if (!card || card.status === "pending_payment") return;
    const previous = document.title;
    document.title = `Gift Card ${card.codeLast4} — River City`;
    return () => {
      document.title = previous;
    };
  }, [card]);

  if (!token) {
    return <ErrorState message="This print link is missing its access token." />;
  }
  if (card === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (card === null || card.status === "voided") {
    return <ErrorState message="We couldn't find an active gift card for this link." />;
  }
  if (card.status === "pending_payment") {
    return <ErrorState message="This gift card is still awaiting payment." />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: letter; margin: 0.45in; }
          body { background: white !important; }
          .print-sheet { box-shadow: none !important; border: none !important; padding: 0 !important; }
          .print-card { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/dashboard/gift-cards"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            My Gift Cards
          </Link>
          <h1 className="font-serif text-3xl">Print your gift card</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Print on cardstock or letter paper, cut along the dashed line, and
            hand it to the recipient. The code and PIN are ready to use.
          </p>
        </div>
        <Button
          onClick={() => window.print()}
          className="bg-[#1a1714] text-white hover:bg-[#2a2520]"
        >
          <Printer className="mr-2 h-4 w-4" />
          Print Card
        </Button>
      </div>

      <Card className="print-sheet border-border/60 bg-white p-4 sm:p-8">
        <CardContent className="space-y-8 p-0">
          <div className="print-card">
            <p className="no-print mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Front
            </p>
            <PrintFront amount={card.amount} />
          </div>

          <div className="print-card border-t border-dashed border-border pt-8">
            <p className="no-print mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Back
            </p>
            <PrintBack
              amount={card.amount}
              balance={card.availableBalance}
              code={card.code}
              pin={card.pin}
              recipientName={card.recipientName}
              purchaserName={card.purchaserName}
              message={card.message}
            />
          </div>
        </CardContent>
      </Card>

      <p className="no-print mt-6 text-center text-xs text-muted-foreground">
        Tip: print at 100% scale. The card is sized like a standard credit card.
      </p>
    </div>
  );
}

function PrintFront({ amount }: { amount: number }) {
  return (
    <div
      className="relative mx-auto flex aspect-[1.586] w-full max-w-[5in] flex-col justify-between overflow-hidden rounded-2xl border border-black/20 p-6 text-white"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(201,162,39,0.18), transparent 38%), linear-gradient(145deg, #1b1815 0%, #0d0c0b 100%)",
      }}
    >
      <div className="flex items-start justify-between">
        <Image
          src="/BoldRiverCityMobileDetailingLogo.png"
          alt="River City Mobile Detailing"
          width={80}
          height={77}
          className="h-14 w-auto object-contain"
        />
        <p className="text-right text-[8px] uppercase tracking-[0.2em] text-white/40">
          River City
          <br />
          Mobile Detailing
        </p>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.34em] text-[#c9a227]">
          Gift Card
        </p>
        <p className="mt-1 font-serif text-6xl leading-none">${amount.toFixed(0)}</p>
      </div>
      <div className="flex items-end justify-between text-[8px] uppercase tracking-[0.18em] text-white/35">
        <span>Valid indefinitely</span>
        <span className="text-[#c9a227]/80">Little Rock, AR</span>
      </div>
    </div>
  );
}

function PrintBack({
  amount,
  balance,
  code,
  pin,
  recipientName,
  purchaserName,
  message,
}: {
  amount: number;
  balance: number;
  code: string | null;
  pin?: string;
  recipientName?: string;
  purchaserName?: string;
  message?: string;
}) {
  return (
    <div className="relative mx-auto aspect-[1.586] w-full max-w-[5in] overflow-hidden rounded-2xl border border-black/20 bg-[#f4efe6] p-5 text-[#1a1714]">
      <div className="flex items-center justify-between border-b border-[#1a1714]/15 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6a12]">
          Gift Card
        </p>
        <p className="text-[8px] uppercase tracking-[0.18em] text-[#1a1714]/45">
          Balance ${balance.toFixed(2)}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
        <PrintField label="To" value={recipientName || "________________"} />
        <PrintField label="From" value={purchaserName || "________________"} />
        <PrintField label="Amount" value={`$${amount.toFixed(2)}`} />
        <PrintField label="Expires" value="Never" />
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-[#1a1714]/25 bg-white/40 px-3 py-2">
        <p className="text-[8px] font-semibold uppercase tracking-[0.2em] text-[#1a1714]/45">
          Code
        </p>
        <p className="font-mono text-base font-bold tracking-[0.12em]">
          {code ?? "See email"}
        </p>
        {pin ? (
          <p className="mt-1 text-[9px] text-[#1a1714]/60">
            PIN: <span className="font-mono font-bold tracking-[0.2em]">{pin}</span>{" "}
            — share separately if you want extra protection
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="line-clamp-2 max-w-[65%] text-[8px] italic leading-relaxed text-[#1a1714]/60">
          {message ? `“${message}”` : "Redeem at rivercitymd.com/gift-cards"}
        </p>
        <Image
          src="/BoldRiverCityMobileDetailingLogo.png"
          alt=""
          width={44}
          height={42}
          className="h-9 w-auto object-contain opacity-70"
        />
      </div>
    </div>
  );
}

function PrintField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[7px] font-semibold uppercase tracking-[0.2em] text-[#1a1714]/40">
        {label}
      </p>
      <p className="truncate border-b border-[#1a1714]/25 pb-0.5 text-[10px] font-medium">
        {value}
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-xl border-border/60">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <TriangleAlert className="h-8 w-8 text-destructive" />
        <h1 className="font-serif text-2xl">Print link unavailable</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard/gift-cards">Go to My Gift Cards</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
