"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { CheckCircle2, Gift, Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GiftCardVisual } from "@/components/gift-cards/gift-card-visual";

export function GiftCardClaimClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const codeParam = searchParams.get("code") ?? "";
  const { isLoaded, isSignedIn, user } = useUser();
  const claimByToken = useMutation(api.giftCards.claimByToken);
  const claimByCode = useMutation(api.giftCards.claimByCode);

  const context = useQuery(
    api.giftCards.getByClaimToken,
    token ? { token } : "skip",
  );
  const [code, setCode] = React.useState(codeParam);
  const [pin, setPin] = React.useState("");
  const [isClaiming, setIsClaiming] = React.useState(false);
  const [claimed, setClaimed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const attemptedToken = React.useRef(false);

  React.useEffect(() => {
    if (!token || !isLoaded || !isSignedIn) return;
    if (context?.claimedByCurrentUser) {
      setClaimed(true);
      return;
    }
    if (!context?.canClaim) return;
    if (attemptedToken.current) return;
    attemptedToken.current = true;
    setIsClaiming(true);
    void claimByToken({ token })
      .then(() => {
        setClaimed(true);
        toast.success("Gift card added to your account");
      })
      .catch((claimError) => {
        setError(
          claimError instanceof Error
            ? claimError.message
            : "We couldn't claim this gift card.",
        );
      })
      .finally(() => setIsClaiming(false));
  }, [
    claimByToken,
    context?.canClaim,
    context?.claimedByCurrentUser,
    isLoaded,
    isSignedIn,
    token,
  ]);

  const handleCodeClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      toast.error("Enter the gift card code.");
      return;
    }
    setIsClaiming(true);
    setError(null);
    try {
      await claimByCode({
        code: code.trim(),
        pin: pin.trim() || undefined,
      });
      setClaimed(true);
      toast.success("Gift card added to your account");
    } catch (claimError) {
      setError(
        claimError instanceof Error
          ? claimError.message
          : "We couldn't claim this gift card.",
      );
    } finally {
      setIsClaiming(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (claimed) {
    return (
      <Card className="mx-auto max-w-xl border-border/60">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <h1 className="font-serif text-3xl">Gift card claimed</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            It&apos;s in your account and ready to use at checkout. Any
            remaining balance stays on the card.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="bg-[#1a1714] text-white hover:bg-[#2a2520]">
              <Link href="/dashboard/gift-cards">View My Gift Cards</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/book">Book a Detail</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const redirectPath = token
    ? `/gift-cards/claim?token=${encodeURIComponent(token)}`
    : `/gift-cards/claim?code=${encodeURIComponent(code)}`;
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(redirectPath)}`;

  return (
    <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:items-center">
      <div>
        <GiftCardVisual
          amount={context?.amount ?? 100}
          recipientName={context?.recipientName}
          purchaserName={context?.purchaserName}
          message={context?.message}
          size="lg"
          interactive={false}
        />
      </div>

      <Card className="border-border/60 bg-card/80">
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a6a12]">
              You&apos;ve got a gift
            </p>
            <h1 className="font-serif text-3xl">
              {context?.purchaserName
                ? `${context.purchaserName} sent you a gift card`
                : "Claim your gift card"}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {context
                ? `$${context.amount.toFixed(0)} for River City Mobile Detailing. Claim it with the email it was sent to, or enter the code below.`
                : "Sign in with the email the card was sent to, or enter the code and PIN from your gift card."}
            </p>
          </div>

          {context?.claimExpired ? (
            <Notice tone="warning">
              This claim link has expired. Enter the code and PIN below, or ask
              the sender to resend the card.
            </Notice>
          ) : null}

          {context?.claimed && !context.claimedByCurrentUser ? (
            <Notice tone="error">
              This gift card has already been claimed by someone else.
            </Notice>
          ) : null}

          {error ? <Notice tone="error">{error}</Notice> : null}

          {isSignedIn ? (
            <>
              {context?.canClaim ? (
                <div className="flex items-center gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  {isClaiming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Gift className="h-4 w-4" />
                  )}
                  {isClaiming
                    ? "Adding it to your account..."
                    : `Claiming as ${user?.primaryEmailAddress?.emailAddress ?? "your account"}`}
                </div>
              ) : null}

              <form onSubmit={handleCodeClaim} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="gift-code">Gift card code</Label>
                  <Input
                    id="gift-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="RC-XXXX-XXXX-XXXX-XXXX"
                    className="font-mono tracking-[0.08em]"
                    autoCapitalize="characters"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gift-pin">PIN (if your card has one)</Label>
                  <Input
                    id="gift-pin"
                    value={pin}
                    onChange={(event) =>
                      setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder="4-digit PIN"
                    inputMode="numeric"
                    maxLength={4}
                    className="max-w-[180px] text-center font-mono tracking-[0.3em]"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isClaiming}
                  className="w-full bg-[#1a1714] text-white hover:bg-[#2a2520]"
                >
                  {isClaiming ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LockKeyhole className="mr-2 h-4 w-4" />
                  )}
                  {isClaiming ? "Claiming..." : "Claim Gift Card"}
                </Button>
              </form>
            </>
          ) : (
            <div className="space-y-3">
              <Button asChild className="w-full bg-[#1a1714] text-white hover:bg-[#2a2520]">
                <Link href={signInHref}>Sign in to claim</Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Use the email the gift card was sent to. New here? You can
                create an account from the sign-in page.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "error"
          ? "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          : "flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800"
      }
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
