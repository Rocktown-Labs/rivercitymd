"use client";

import * as React from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

type GiftCardVisualProps = {
  amount: number;
  code?: string | null;
  codeLast4?: string;
  balance?: number;
  recipientName?: string;
  purchaserName?: string;
  message?: string;
  status?: string;
  interactive?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
};

const SIZES = {
  sm: "max-w-[300px]",
  md: "max-w-[420px]",
  lg: "max-w-[520px]",
} as const;

export function GiftCardVisual({
  amount,
  code,
  codeLast4,
  balance,
  recipientName,
  purchaserName,
  message,
  status,
  interactive = true,
  className,
  size = "md",
}: GiftCardVisualProps) {
  const [flipped, setFlipped] = React.useState(false);
  const [tilt, setTilt] = React.useState({ x: 0, y: 0 });
  const frameRef = React.useRef<HTMLDivElement>(null);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -7, y: px * 9 });
  };

  const resetTilt = () => setTilt({ x: 0, y: 0 });

  const displayCode = code || (codeLast4 ? `•••• •••• •••• ${codeLast4}` : undefined);
  const displayBalance = balance ?? amount;

  return (
    <div
      className={cn("w-full [perspective:1400px]", SIZES[size], className)}
      ref={frameRef}
      onMouseMove={handleMove}
      onMouseLeave={resetTilt}
    >
      <div
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          interactive
            ? flipped
              ? "Gift card details. Tap to see the front."
              : "Gift card. Tap to reveal the balance and code."
            : "Gift card"
        }
        onClick={() => interactive && setFlipped((value) => !value)}
        onKeyDown={(event) => {
          if (!interactive) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setFlipped((value) => !value);
          }
        }}
        className={cn(
          "relative aspect-[1.586] w-full rounded-[22px] transition-transform duration-500 [transform-style:preserve-3d]",
          interactive && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a227] focus-visible:ring-offset-4",
        )}
        style={{
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y + (flipped ? 180 : 0)}deg)`,
        }}
      >
        <CardFront amount={amount} status={status} size={size} />
        <CardBack
          amount={amount}
          balance={displayBalance}
          code={displayCode}
          recipientName={recipientName}
          purchaserName={purchaserName}
          message={message}
          status={status}
        />
      </div>
      {interactive ? (
        <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {flipped ? "Tap to flip back" : "Tap to reveal balance"}
        </p>
      ) : null}
    </div>
  );
}

function CardFront({
  amount,
  status,
  size,
}: {
  amount: number;
  status?: string;
  size: "sm" | "md" | "lg";
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[22px] border border-[#c9a227]/30 bg-[#141210] text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.75)] [backface-visibility:hidden]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(201,162,39,0.14), transparent 38%), radial-gradient(circle at 90% 90%, rgba(255,255,255,0.06), transparent 42%), linear-gradient(145deg, #1b1815 0%, #0d0c0b 100%)",
      }}
    >
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(rgba(255,255,255,0.7)_0.5px,transparent_0.5px)] [background-size:4px_4px]" />
      <div className="relative flex h-full flex-col justify-between p-[6%]">
        <div className="flex items-start justify-between gap-3">
          <Image
            src="/BoldRiverCityMobileDetailingLogo.png"
            alt="River City Mobile Detailing"
            width={130}
            height={125}
            className={cn(
              "min-h-0 w-auto shrink-0 object-contain",
              size === "sm" ? "h-14" : size === "lg" ? "h-24" : "h-20",
            )}
            priority
          />
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/45">
              River City
            </p>
            <p className="text-[8px] uppercase tracking-[0.18em] text-white/30">
              Mobile Detailing
            </p>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#c9a227]">
            Gift Card
          </p>
          <p className="mt-1 font-serif text-[clamp(2.2rem,7vw,3.6rem)] leading-none tracking-tight text-white">
            ${amount.toFixed(0)}
          </p>
        </div>

        <div className="flex items-end justify-between gap-3">
          <p className="text-[8px] uppercase tracking-[0.2em] text-white/35">
            {status === "pending_payment" ? "Awaiting payment" : "Valid indefinitely"}
          </p>
          <p className="text-[8px] uppercase tracking-[0.2em] text-[#c9a227]/80">
            Little Rock, AR
          </p>
        </div>
      </div>
    </div>
  );
}

function CardBack({
  amount,
  balance,
  code,
  recipientName,
  purchaserName,
  message,
  status,
}: {
  amount: number;
  balance: number;
  code?: string;
  recipientName?: string;
  purchaserName?: string;
  message?: string;
  status?: string;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[22px] border border-black/10 bg-[#f4efe6] text-[#1a1714] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)] [backface-visibility:hidden] [transform:rotateY(180deg)]"
      style={{
        backgroundImage:
          "linear-gradient(145deg, #faf6ee 0%, #efe7d8 100%)",
      }}
    >
      <div className="absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(26,23,20,0.18)_0.4px,transparent_0.4px)] [background-size:5px_5px]" />
      <div className="relative flex h-full flex-col justify-between p-[5.5%]">
        <div className="flex items-center justify-between border-b border-[#1a1714]/15 pb-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-[#8a6a12]">
            Gift Card
          </p>
          <p className="text-[8px] uppercase tracking-[0.18em] text-[#1a1714]/45">
            {status === "depleted" ? "Balance used" : "Balance"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[9px]">
          <Field label="To" value={recipientName || "________________"} />
          <Field label="From" value={purchaserName || "________________"} />
          <Field label="Amount" value={`$${amount.toFixed(2)}`} />
          <Field label="Available" value={`$${balance.toFixed(2)}`} />
        </div>

        <div className="rounded-lg border border-dashed border-[#1a1714]/25 bg-white/35 px-3 py-2">
          <p className="text-[7px] font-semibold uppercase tracking-[0.22em] text-[#1a1714]/45">
            Code
          </p>
          <p className="mt-0.5 font-mono text-[clamp(0.68rem,2.5vw,0.95rem)] font-bold tracking-[0.12em] text-[#1a1714]">
            {code || "Available after purchase"}
          </p>
        </div>

        {message ? (
          <p className="line-clamp-2 text-[8px] italic leading-relaxed text-[#1a1714]/60">
            &ldquo;{message}&rdquo;
          </p>
        ) : (
          <p className="text-[8px] uppercase tracking-[0.16em] text-[#1a1714]/40">
            Redeem at rivercitymd.com/gift-cards
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[7px] font-semibold uppercase tracking-[0.2em] text-[#1a1714]/40">
        {label}
      </p>
      <p className="truncate border-b border-[#1a1714]/25 pb-0.5 text-[9px] font-medium">
        {value}
      </p>
    </div>
  );
}
