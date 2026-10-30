import type { Metadata } from "next";

import Navbar from "@/components/home/navbar";
import { GiftCardPurchaseClient } from "@/components/gift-cards/gift-card-purchase-client";

export const metadata: Metadata = {
  title: "Gift Cards — River City Mobile Detailing",
  description:
    "Give the gift of a clean car. Buy a River City Mobile Detailing gift card, send it by email, or print it at home.",
};

export default async function GiftCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string; canceled?: string }>;
}) {
  const { amount, canceled } = await searchParams;
  const initialAmount = Number(amount);
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(201,162,39,0.08),_transparent_45%)] pb-20">
        <div className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 lg:px-8">
          <div className="mb-10 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8a6a12]">
              River City Gift Cards
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
              A clean car, wrapped in gold.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Choose an amount, add a note, and send it by email or print it at
              home. They can use it on any service or outstanding invoice. It
              never expires.
            </p>
          </div>
          <GiftCardPurchaseClient
            canceled={canceled === "1"}
            initialAmount={
              Number.isFinite(initialAmount) &&
              initialAmount >= 100 &&
              initialAmount <= 500 &&
              initialAmount % 100 === 0
                ? initialAmount
                : undefined
            }
          />
        </div>
      </main>
    </>
  );
}
