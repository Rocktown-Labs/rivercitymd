"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Calendar,
  Car,
  CreditCard,
  Ellipsis,
  FileText,
  FlaskConical,
  Gift,
  LayoutDashboard,
  MapPinned,
  Settings,
  Star,
  Users,
  Ticket,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    href: "/admin",
  },
  {
    title: "Appointments",
    icon: Calendar,
    href: "/admin/appointments",
  },
  {
    title: "Customers",
    icon: Users,
    href: "/admin/customers",
  },
  {
    title: "Services",
    icon: Car,
    href: "/admin/services",
  },
  {
    title: "Analytics",
    icon: BarChart3,
    href: "/admin/analytics",
  },
  {
    title: "Logs",
    icon: FileText,
    href: "/admin/logs",
  },
  {
    title: "Out-of-Area",
    icon: MapPinned,
    href: "/admin/out-of-area",
  },
  {
    title: "Payments",
    icon: CreditCard,
    href: "/admin/payments",
  },
  {
    title: "Coupons",
    icon: Ticket,
    href: "/admin/coupons",
  },
  {
    title: "Gift Cards",
    icon: Gift,
    href: "/admin/gift-cards",
  },
  {
    title: "Reviews",
    icon: Star,
    href: "/admin/reviews",
  },
  {
    title: "Settings",
    icon: Settings,
    href: "/admin/settings",
  },
  {
    title: "Test",
    icon: FlaskConical,
    href: "/admin/test",
  },
] as const;

const PRIMARY_NAV_ITEMS = navItems.slice(0, 4);
const OVERFLOW_NAV_ITEMS = navItems.slice(4);

export default function AdminMobileNav() {
  const pathname = usePathname();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const pendingAppointmentsCount = useQuery(api.appointments.getPendingCount) ?? 0;
  const newCustomersCount = useQuery(api.users.getNewCustomersCount) ?? 0;
  const unpaidInvoicesCount = useQuery(api.invoices.getUnpaidInvoicesCountAdmin) ?? 0;
  const newReviewsCount = useQuery(api.reviews.getNewReviewsCount) ?? 0;
  const pendingTripLogsCount = useQuery(api.tripLogs.getPendingRequiredCount) ?? 0;
  const outOfAreaRequestCount = useQuery(api.bookingDrafts.getOutOfAreaRequestCount) ?? 0;

  const getItemCount = (href: string) => {
    if (href === "/admin/appointments") return pendingAppointmentsCount;
    if (href === "/admin/customers") return newCustomersCount;
    if (href === "/admin/payments") return unpaidInvoicesCount;
    if (href === "/admin/reviews") return newReviewsCount;
    if (href === "/admin/logs") return pendingTripLogsCount;
    if (href === "/admin/out-of-area") return outOfAreaRequestCount;
    return 0;
  };

  const isRouteActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const isMoreActive = OVERFLOW_NAV_ITEMS.some((item) => isRouteActive(item.href));
  const moreBadgeCount = OVERFLOW_NAV_ITEMS.reduce(
    (total, item) => total + getItemCount(item.href),
    0,
  );

  return (
    <>
      <nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background md:hidden">
        <div className="grid h-16 grid-cols-5 px-1 pb-[env(safe-area-inset-bottom)]">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = isRouteActive(item.href);
            const count = getItemCount(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive ? "text-accent" : "text-muted-foreground",
                )}
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 h-1 w-10 -translate-x-1/2 rounded-b-full bg-accent" />
                )}
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {count > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center px-1 text-[10px]"
                    >
                      {count > 99 ? "99+" : count}
                    </Badge>
                  )}
                </div>
                <span>{item.title}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            className={cn(
              "relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
              isMoreActive ? "text-accent" : "text-muted-foreground",
            )}
          >
            {isMoreActive && (
              <div className="absolute top-0 left-1/2 h-1 w-10 -translate-x-1/2 rounded-b-full bg-accent" />
            )}
            <div className="relative">
              <Ellipsis className="h-5 w-5" />
              {moreBadgeCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center px-1 text-[10px]"
                >
                  {moreBadgeCount > 99 ? "99+" : moreBadgeCount}
                </Badge>
              )}
            </div>
            <span>More</span>
          </button>
        </div>
      </nav>

      <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[70vh] rounded-t-2xl px-0 pb-[max(env(safe-area-inset-bottom),1rem)] md:hidden"
        >
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Open additional admin screens</SheetDescription>
          </SheetHeader>

          <div className="space-y-1 overflow-y-auto px-4 pb-2">
            {OVERFLOW_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = isRouteActive(item.href);
              const count = getItemCount(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMoreOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-3 text-sm transition-colors",
                    isActive
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </span>
                  {count > 0 ? (
                    <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px]">
                      {count > 99 ? "99+" : count}
                    </Badge>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
