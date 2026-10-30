"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Calendar, Car, User, Star, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    title: "Appointments",
    icon: Calendar,
    href: "/dashboard/appointments",
  },
  {
    title: "Vehicles",
    icon: Car,
    href: "/dashboard/vehicles",
  },
  {
    title: "Gift Cards",
    icon: Gift,
    href: "/dashboard/gift-cards",
  },
  {
    title: "Reviews",
    icon: Star,
    href: "/dashboard/reviews",
  },
  {
    title: "Profile",
    icon: User,
    href: "/dashboard/profile",
  },
];

export default function DashboardMobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors relative",
                isActive ? "text-accent" : "text-muted-foreground",
              )}
            >
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-accent rounded-b-full" />
              )}
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
