"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { SignOutButton } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import {
  LayoutDashboard,
  Calendar,
  Car,
  User,
  Star,
  FileText,
  Gift,
  LogOut,
  RefreshCw,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const menuItems = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    title: "My Appointments",
    icon: Calendar,
    href: "/dashboard/appointments",
  },
  {
    title: "My Vehicles",
    icon: Car,
    href: "/dashboard/vehicles",
  },
  {
    title: "My Reviews",
    icon: Star,
    href: "/dashboard/reviews",
  },
  {
    title: "My Invoices",
    icon: FileText,
    href: "/dashboard/invoices",
  },
  {
    title: "Gift Cards",
    icon: Gift,
    href: "/dashboard/gift-cards",
  },
  {
    title: "My Subscription",
    icon: RefreshCw,
    href: "/dashboard/subscriptions",
  },
  {
    title: "Profile",
    icon: User,
    href: "/dashboard/profile",
  },
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  useAuth();
  const confirmedAppointmentsCount =
    useQuery(api.appointments.getConfirmedAppointmentsCount) ?? 0;
  const unpaidInvoicesCount = useQuery(api.invoices.getUnpaidInvoicesCount) ?? 0;
  const pendingReviewsCount = useQuery(api.reviews.getPendingReviewsCount) ?? 0;

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border py-2">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-8 h-8">
            <Image
              src="/BoldRiverCityMobileDetailingLogo.png"
              alt="River City Mobile Detail"
              fill
              className="object-contain"
            />
          </div>
          <div>
            <div className="font-bold text-sm">River City MD</div>
            <div className="text-xs text-sidebar-foreground/60">
              Customer Portal
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                // Get count for specific menu items
                let count = 0;
                if (item.href === "/dashboard/appointments") {
                  count = confirmedAppointmentsCount;
                } else if (item.href === "/dashboard/invoices") {
                  count = unpaidInvoicesCount;
                } else if (item.href === "/dashboard/reviews") {
                  count = pendingReviewsCount;
                }

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href} className="relative w-full">
                        <Icon className="w-4 h-4" />
                        <span>{item.title}</span>
                        {count > 0 && (
                          <Badge
                            variant="destructive"
                            className="absolute right-2 h-5 min-w-5 px-1.5 flex items-center justify-center text-xs"
                          >
                            {count > 99 ? "99+" : count}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <SignOutButton redirectUrl="/">
          <Button variant="ghost" className="w-full justify-start" size="sm">
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </SignOutButton>
      </SidebarFooter>
    </Sidebar>
  );
}
