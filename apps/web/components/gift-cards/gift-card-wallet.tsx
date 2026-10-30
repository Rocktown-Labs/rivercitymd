"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Gift,
  History,
  Loader2,
  Printer,
  Sparkles,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GiftCardVisual } from "@/components/gift-cards/gift-card-visual";

type WalletCard = {
  _id: Id<"giftCards">;
  status: string;
  amount: number;
  balance: number;
  availableBalance: number;
  codeLast4: string;
  pinRequired: boolean;
  deliveryMethod: "self" | "email" | "print";
  purchaserName: string;
  recipientName?: string;
  recipientEmailMasked?: string;
  message?: string;
  claimed: boolean;
  claimedAt?: number;
  issuedAt?: number;
  createdAt: number;
  accessToken: string;
};

export function GiftCardWallet() {
  const wallet = useQuery(api.giftCards.getMyGiftCards);
  const claimPending = useMutation(api.giftCards.claimPendingForCurrentUser);
  const claimByCode = useMutation(api.giftCards.claimByCode);
  const [selectedId, setSelectedId] = React.useState<Id<"giftCards"> | null>(
    null,
  );
  const [activityId, setActivityId] = React.useState<Id<"giftCards"> | null>(
    null,
  );
  const [code, setCode] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [isClaiming, setIsClaiming] = React.useState(false);

  React.useEffect(() => {
    void claimPending({}).catch(() => undefined);
  }, [claimPending]);

  const revealed = useQuery(
    api.giftCards.revealGiftCardCode,
    selectedId ? { giftCardId: selectedId } : "skip",
  );
  const activity = useQuery(
    api.giftCards.getMyGiftCardTransactions,
    activityId ? { giftCardId: activityId } : "skip",
  );

  const owned = (wallet?.owned ?? []) as WalletCard[];
  const purchased = (wallet?.purchased ?? []) as WalletCard[];
  const totalAvailable = owned.reduce(
    (sum, card) => sum + card.availableBalance,
    0,
  );

  const handleClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      toast.error("Enter a gift card code.");
      return;
    }
    setIsClaiming(true);
    try {
      await claimByCode({ code: code.trim(), pin: pin.trim() || undefined });
      setCode("");
      setPin("");
      toast.success("Gift card added to your account");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "We couldn't claim that card.",
      );
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="overflow-hidden border-[#c9a227]/30 bg-[#1a1714] text-white">
          <CardContent className="relative flex h-full flex-col justify-between gap-8 p-7">
            <div
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 85% 15%, rgba(201,162,39,0.55), transparent 35%), radial-gradient(circle at 15% 85%, rgba(255,255,255,0.18), transparent 40%)",
              }}
            />
            <div className="relative flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c9a227]">
                  Gift card balance
                </p>
                <p className="mt-3 font-serif text-5xl leading-none">
                  ${totalAvailable.toFixed(2)}
                </p>
                <p className="mt-3 max-w-xs text-xs leading-relaxed text-white/55">
                  Use your balance on any service or outstanding invoice. Any
                  remainder stays on the card.
                </p>
              </div>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#c9a227]/15 text-[#c9a227]">
                <Sparkles className="h-6 w-6" />
              </span>
            </div>
            <div className="relative flex flex-wrap gap-2">
              <Button asChild className="bg-[#c9a227] text-[#1a1714] hover:bg-[#d8b23a]">
                <Link href="/gift-cards">
                  <Gift className="mr-2 h-4 w-4" />
                  Buy a Gift Card
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link href="/book">
                  Book a Detail
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/80">
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-sm font-semibold">Redeem a gift card</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Have a code? Add it to your account so it&apos;s ready at checkout.
              </p>
            </div>
            <form onSubmit={handleClaim} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wallet-code">Code</Label>
                <Input
                  id="wallet-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="RC-XXXX-XXXX-XXXX-XXXX"
                  className="font-mono tracking-[0.08em]"
                  autoCapitalize="characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wallet-pin">PIN (if any)</Label>
                <Input
                  id="wallet-pin"
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="4-digit PIN"
                  inputMode="numeric"
                  maxLength={4}
                  className="max-w-[160px] text-center font-mono tracking-[0.3em]"
                />
              </div>
              <Button type="submit" disabled={isClaiming} className="w-full">
                {isClaiming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Tag className="mr-2 h-4 w-4" />
                )}
                {isClaiming ? "Adding..." : "Add to My Account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="owned" className="space-y-5">
        <TabsList>
          <TabsTrigger value="owned">
            My cards ({owned.length})
          </TabsTrigger>
          <TabsTrigger value="purchased">
            Purchased for others ({purchased.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="owned">
          {owned.length ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {owned.map((card) => (
                <WalletCardItem
                  key={card._id}
                  card={card}
                  onReveal={() => setSelectedId(card._id)}
                  onActivity={() => setActivityId(card._id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No gift cards yet"
              description="Buy one for yourself or redeem a code above."
            />
          )}
        </TabsContent>

        <TabsContent value="purchased">
          {purchased.length ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {purchased.map((card) => (
                <WalletCardItem
                  key={card._id}
                  card={card}
                  purchasedForOther
                  onReveal={() => setSelectedId(card._id)}
                  onActivity={() => setActivityId(card._id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nothing purchased for others yet"
              description="Send a gift card by email or print one at home."
            />
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gift card code</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Keep this private. Anyone with the code can use the remaining
              balance.
            </p>
            <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-4 text-center">
              <p className="font-mono text-lg font-bold tracking-[0.14em]">
                {revealed ?? "Loading..."}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activityId)}
        onOpenChange={(open) => !open && setActivityId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gift card activity</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {activity?.length ? (
              activity.map((tx) => (
                <div
                  key={tx._id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium capitalize">{tx.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tx.createdAt).toLocaleDateString()}
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
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WalletCardItem({
  card,
  purchasedForOther,
  onReveal,
  onActivity,
}: {
  card: WalletCard;
  purchasedForOther?: boolean;
  onReveal: () => void;
  onActivity: () => void;
}) {
  return (
    <div className="space-y-3">
      <GiftCardVisual
        amount={card.amount}
        balance={card.availableBalance}
        codeLast4={card.codeLast4}
        recipientName={card.recipientName}
        purchaserName={card.purchaserName}
        message={card.message}
        status={card.status}
        size="sm"
        interactive={false}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {purchasedForOther
              ? card.recipientName || card.recipientEmailMasked || "Recipient"
              : `$${card.availableBalance.toFixed(2)} available`}
          </p>
          <p className="text-xs text-muted-foreground">
            {card.status === "active"
              ? "Active"
              : card.status === "depleted"
                ? "Used"
                : card.status === "voided"
                  ? "Voided"
                  : "Pending"}{" "}
            · ends {card.codeLast4}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onReveal}
            aria-label="Reveal gift card code"
          >
            <Gift className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onActivity}
            aria-label="Gift card activity"
          >
            <History className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Print gift card">
            <Link href={`/gift-cards/print/${card.accessToken}`}>
              <Printer className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed border-border/70 bg-card/50">
      <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
        <Gift className="h-8 w-8 text-muted-foreground" />
        <p className="font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        <Button asChild variant="outline">
          <Link href="/gift-cards">Buy a Gift Card</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
