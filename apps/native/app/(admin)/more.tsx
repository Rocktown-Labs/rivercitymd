import * as React from "react";
import { Pressable, View } from "react-native";
import { useClerk } from "@clerk/expo";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import {
  AlertCircle,
  BarChart3,
  BriefcaseBusiness,
  CreditCard,
  FileText,
  LogOut,
  MapPinned,
  Settings,
  Star,
  Tag,
  Users,
} from "lucide-react-native";

import { Screen, ScreenHeader } from "@/components/screen";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { THEME } from "@/lib/theme";
import { useAppView } from "@/lib/app-view";

export default function AdminMoreScreen() {
  const { signOut } = useClerk();
  const { setViewMode } = useAppView();
  const currentUser = useQuery(api.users.getCurrentUser);
  const isAdmin = currentUser?.role === "admin";

  const unpaidInvoicesCount = useQuery(api.invoices.getUnpaidInvoicesCountAdmin, isAdmin ? {} : "skip") ?? 0;
  const newReviewsCount = useQuery(api.reviews.getNewReviewsCount, isAdmin ? {} : "skip") ?? 0;
  const pendingTripLogsCount = useQuery(api.tripLogs.getPendingRequiredCount, isAdmin ? {} : "skip") ?? 0;
  const outOfAreaRequestCount = useQuery(api.bookingDrafts.getOutOfAreaRequestCount, isAdmin ? {} : "skip") ?? 0;

  const menuItems = [
    {
      title: "Analytics",
      description: "Revenue, bookings, retention, and top service trends.",
      icon: <BarChart3 size={20} color={THEME.light.accent} />,
      route: "/analytics",
      badgeCount: 0,
      badgeVariant: "secondary" as const,
    },
    {
      title: "Payments & Invoices",
      description: "Track customer billing, unpaid invoices, and Stripe deposits.",
      icon: <CreditCard size={20} color={THEME.light.accent} />,
      route: "/(admin)/payments",
      badgeCount: unpaidInvoicesCount,
      badgeVariant: "destructive" as const,
    },
    {
      title: "Coupons",
      description: "Create and manage Stripe discount codes.",
      icon: <Tag size={20} color={THEME.light.accent} />,
      route: "/(admin)/coupons",
      badgeCount: 0,
      badgeVariant: "secondary" as const,
    },
    {
      title: "Memberships",
      description: "Pause, resume, or cancel Maintenance Club subscriptions.",
      icon: <BriefcaseBusiness size={20} color={THEME.light.accent} />,
      route: "/(admin)/subscriptions",
      badgeCount: 0,
      badgeVariant: "secondary" as const,
    },
    {
      title: "Out-of-Area Requests",
      description: "Review expansion leads and manual service requests.",
      icon: <MapPinned size={20} color={THEME.light.accent} />,
      route: "/(admin)/out-of-area",
      badgeCount: outOfAreaRequestCount,
      badgeVariant: "accent" as const,
    },
    {
      title: "Customer Reviews",
      description: "Read service feedback, star ratings, and testimonials.",
      icon: <Star size={20} color={THEME.light.accent} />,
      route: "/(admin)/reviews",
      badgeCount: newReviewsCount,
      badgeVariant: "accent" as const,
    },
    {
      title: "Trip Logs & Mileage",
      description: "Log vehicle miles, technician travel times, and gas expenses.",
      icon: <FileText size={20} color={THEME.light.accent} />,
      route: "/(admin)/logs",
      badgeCount: pendingTripLogsCount,
      badgeVariant: "warning" as const,
    },
    {
      title: "Business Settings",
      description: "Configure operating hours, deposit amounts, travel fee origin, and pet fees.",
      icon: <Settings size={20} color={THEME.light.accent} />,
      route: "/(admin)/settings",
      badgeCount: 0,
      badgeVariant: "secondary" as const,
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Administration"
        title="More Management"
        description="Access financial records, trip logs, customer reviews, and business settings."
      />

      <View className="gap-3">
        {menuItems.map((item, i) => (
          <Card key={i} className="border border-border">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(item.route as any)}
              className="flex-row items-center gap-4 p-4 active:bg-secondary/40"
            >
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-accent/10">
                {item.icon}
              </View>
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-2">
                  <Text className="font-bold text-base">{item.title}</Text>
                  {item.badgeCount > 0 ? (
                    <Badge
                      variant={item.badgeVariant}
                      size="sm"
                      label={item.badgeCount > 99 ? "99+" : String(item.badgeCount)}
                    />
                  ) : null}
                </View>
                <Text className="text-xs text-muted-foreground leading-4">{item.description}</Text>
              </View>
            </Pressable>
          </Card>
        ))}
      </View>

      {isAdmin ? (
        <Button
          variant="outline"
          onPress={() => {
            setViewMode("customer");
            router.replace("/(tabs)");
          }}
          className="flex-row items-center justify-center gap-2"
        >
          <Users size={16} color={THEME.light.foreground} />
          <Text className="font-semibold">Switch to Customer View</Text>
        </Button>
      ) : null}

      {/* Sign Out */}
      <Button
        variant="destructive"
        onPress={() => void signOut()}
        className="flex-row items-center justify-center gap-2 self-start mt-2"
      >
        <LogOut size={16} color="#fff" />
        <Text className="font-bold text-white">Sign Out</Text>
      </Button>
    </Screen>
  );
}
