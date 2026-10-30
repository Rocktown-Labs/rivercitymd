"use client";

import Link from "next/link";
import { ArrowRight, Gift, Mail, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GiftCardVisual } from "@/components/gift-cards/gift-card-visual";

const PRESETS = [100, 200, 300, 400, 500];

export function GiftCardsSection() {
  return (
    <div className="mx-auto mt-12 max-w-6xl overflow-hidden rounded-2xl border border-[#c9a227]/25 bg-[#1a1714] text-white">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="mx-auto w-full max-w-[360px] lg:mx-0">
          <GiftCardVisual amount={100} size="md" />
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

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((amount) => (
              <Link
                key={amount}
                href={`/gift-cards?amount=${amount}`}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-[#c9a227] hover:bg-[#c9a227]/10"
              >
                ${amount}
              </Link>
            ))}
            <Link
              href="/gift-cards"
              className="rounded-xl border border-[#c9a227]/50 bg-[#c9a227]/10 px-4 py-2 text-sm font-semibold text-[#c9a227] transition-colors hover:bg-[#c9a227]/20"
            >
              Custom
            </Link>
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

          <Button asChild size="lg" className="bg-[#c9a227] text-[#1a1714] hover:bg-[#d8b23a]">
            <Link href="/gift-cards">
              Send a Gift Card
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
