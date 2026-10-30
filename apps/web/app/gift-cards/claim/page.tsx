import type { Metadata } from "next";
import { Suspense } from "react";

import Navbar from "@/components/home/navbar";
import { GiftCardClaimClient } from "@/components/gift-cards/gift-card-claim-client";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function GiftCardClaimPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pb-20">
        <div className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 lg:px-8">
          <Suspense fallback={null}>
            <GiftCardClaimClient />
          </Suspense>
        </div>
      </main>
    </>
  );
}
