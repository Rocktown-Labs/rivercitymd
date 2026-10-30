import { GiftCardWallet } from "@/components/gift-cards/gift-card-wallet";

export default function DashboardGiftCardsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Wallet
        </p>
        <h1 className="mt-1 font-serif text-3xl">Gift Cards</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Your available balance, cards you bought for others, and every
          redemption in one place.
        </p>
      </div>
      <GiftCardWallet />
    </div>
  );
}
