import type { Metadata } from "next";
import { Suspense } from "react";

import Navbar from "@/components/home/navbar";
import { GiftCardSuccessClient } from "@/components/gift-cards/gift-card-success-client";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function GiftCardSuccessPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pb-20">
        <div className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 lg:px-8">
          <Suspense fallback={null}>
            <GiftCardSuccessClient />
          </Suspense>
        </div>
      </main>
    </>
  );
}
