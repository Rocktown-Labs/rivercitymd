"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Gift, Mail, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GiftCardVisual } from "@/components/gift-cards/gift-card-visual";
import { cn } from "@/lib/utils";

const PRESETS = [100, 200, 300, 400, 500];

export function GiftCardsSection() {
  const router = useRouter();
  const [selectedAmount, setSelectedAmount] = React.useState(100);
  const [customMode, setCustomMode] = React.useState(false);
  const [customAmount, setCustomAmount] = React.useState("");

  const resolvedAmount = customMode ? Number(customAmount) : selectedAmount;
  const amountIsValid =
    Number.isFinite(resolvedAmount) &&
    resolvedAmount >= 100 &&
    resolvedAmount <= 1000 &&
    resolvedAmount % 100 === 0;

  const handlePurchase = () => {
    if (!amountIsValid) return;
    router.push(`/gift-cards?amount=${resolvedAmount}`);
  };

  return (
    <div className="mx-auto mt-12 max-w-6xl overflow-hidden rounded-2xl border border-[#c9a227]/25 bg-[#1a1714] text-white">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="mx-auto w-full max-w-[360px] lg:mx-0">
          <GiftCardVisual
            amount={amountIsValid ? resolvedAmount : selectedAmount}
            size="md"
          />
        </div>

        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#c9a227]/30 bg-[#c9a227]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#c9a227]">
            <Gift className="h-3.5 w-3.5" />
            Gift Cards
          </div>
          <div>
            <h3 className="font-serif text-3xl leading-tight sm:text-4xl">
              Give the gift of a clean car.
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60">
              A River City gift card covers any detail, add-on, or outstanding
              invoice. Send it by email or print it at home. It never expires.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Choose an amount
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomMode(false);
                  }}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
                    !customMode && selectedAmount === amount
                      ? "border-[#c9a227] bg-[#c9a227]/15 text-[#f4d77a]"
                      : "border-white/15 bg-white/5 text-white hover:border-[#c9a227] hover:bg-[#c9a227]/10",
                  )}
                >
                  ${amount}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
                  customMode
                    ? "border-[#c9a227] bg-[#c9a227]/15 text-[#f4d77a]"
                    : "border-white/15 bg-white/5 text-white hover:border-[#c9a227] hover:bg-[#c9a227]/10",
                )}
              >
                Custom
              </button>
            </div>

            {customMode ? (
              <div className="max-w-[220px]">
                <Input
                  type="number"
                  min={100}
                  max={1000}
                  step={100}
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  placeholder="Enter $100–$1,000"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                />
                {!amountIsValid ? (
                  <p className="mt-1 text-[11px] text-[#f4d77a]/80">
                    Enter $100–$1,000 in $100 increments.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-white/45">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Email delivery
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              Print at home
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Gift className="h-3.5 w-3.5" />
              Stored in your account
            </span>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              size="lg"
              disabled={!amountIsValid}
              onClick={handlePurchase}
              className="bg-[#c9a227] text-[#1a1714] hover:bg-[#d8b23a] disabled:opacity-50"
            >
              Purchase Gift Card
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="text-[11px] text-white/40">
              You&apos;ll choose email or print delivery next.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
