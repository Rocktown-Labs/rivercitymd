"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Car,
  Settings,
  BarChart3,
  CreditCard,
  LogOut,
  MapPinned,
  RefreshCw,
  Star,
  FileText,
  FlaskConical,
  Gift,
  Ticket,
} from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";

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
    title: "Subscriptions",
    icon: RefreshCw,
    href: "/admin/subscriptions",
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
];

export default function AdminSidebar() {
  const pathname = usePathname();
  useAuth();
  const pendingAppointmentsCount = useQuery(api.appointments.getPendingCount) ?? 0;
  const newCustomersCount = useQuery(api.users.getNewCustomersCount) ?? 0;
  const unpaidInvoicesCount = useQuery(api.invoices.getUnpaidInvoicesCountAdmin) ?? 0;
  const newReviewsCount = useQuery(api.reviews.getNewReviewsCount) ?? 0;
  const pendingTripLogsCount = useQuery(api.tripLogs.getPendingRequiredCount) ?? 0;
  const subscriptionAlertCount = useQuery(api.subscriptions.getActiveCount) ?? 0;
  const outOfAreaRequestCount = useQuery(api.bookingDrafts.getOutOfAreaRequestCount) ?? 0;

  return (
    <Sidebar>
      <SidebarHeader className="border-sidebar-border p-4 border-b-0">
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
              Admin Dashboard
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
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
                // Get count for specific menu items
                let count = 0;
                if (item.href === "/admin/appointments") {
                  count = pendingAppointmentsCount;
                } else if (item.href === "/admin/customers") {
                  count = newCustomersCount;
                } else if (item.href === "/admin/payments") {
                  count = unpaidInvoicesCount;
                } else if (item.href === "/admin/reviews") {
                  count = newReviewsCount;
                } else if (item.href === "/admin/logs") {
                  count = pendingTripLogsCount;
                } else if (item.href === "/admin/out-of-area") {
                  count = outOfAreaRequestCount;
                } else if (item.href === "/admin/subscriptions") {
                  count = subscriptionAlertCount;
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
