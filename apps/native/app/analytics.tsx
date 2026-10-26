import * as React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import {
  ArrowLeft,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

export default function AnalyticsScreen() {
  const analytics = useQuery(api.analytics.getDashboardAnalytics, {
    months: 6,
  });
  const monthlyStats = useQuery(api.analytics.getMonthlyStats);

  if (!analytics || !monthlyStats) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-3 py-20">
          <ActivityIndicator size="small" color={THEME.light.accent} />
          <Text className="text-sm text-muted-foreground">
            Loading analytics...
          </Text>
        </View>
      </Screen>
    );
  }

  const maxRevenue = Math.max(
    1,
    ...analytics.monthlyData.map((month) => month.revenue),
  );

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        className="flex-row items-center gap-1.5 self-start active:opacity-70"
      >
        <ArrowLeft size={18} color={THEME.light.foreground} />
        <Text className="text-sm font-semibold">Back</Text>
      </Pressable>

      <ScreenHeader
        eyebrow="Business Intelligence"
        title="Analytics"
        description="Revenue, bookings, customer retention, and service trends."
      />

      <View className="flex-row gap-3">
        <GlassSurface style={{ flex: 1, borderRadius: 20, padding: 14 }}>
          <View className="gap-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold text-muted-foreground">
                Revenue
              </Text>
              <DollarSign size={16} color={THEME.light.accent} />
            </View>
            <Text className="text-2xl font-extrabold">
              ${monthlyStats.totalRevenue.toLocaleString()}
            </Text>
            <Text className="text-[11px] font-semibold text-emerald-600">
              {monthlyStats.revenueChange}% vs last month
            </Text>
          </View>
        </GlassSurface>
        <GlassSurface style={{ flex: 1, borderRadius: 20, padding: 14 }}>
          <View className="gap-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold text-muted-foreground">
                Bookings
              </Text>
              <Users size={16} color={THEME.light.accent} />
            </View>
            <Text className="text-2xl font-extrabold">
              {monthlyStats.bookingsCount}
            </Text>
            <Text className="text-[11px] font-semibold text-emerald-600">
              {monthlyStats.bookingsChange}% vs last month
            </Text>
          </View>
        </GlassSurface>
      </View>

      <Card className="border border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue by month</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <View className="h-40 flex-row items-end gap-2">
            {analytics.monthlyData.map((month) => {
              const height = Math.max(
                6,
                Math.round((month.revenue / maxRevenue) * 140),
              );
              return (
                <View key={month.month} className="flex-1 items-center gap-1.5">
                  <Text className="text-[9px] font-semibold text-muted-foreground">
                    ${Math.round(month.revenue / 100) / 10}k
                  </Text>
                  <View
                    style={{ height }}
                    className="w-full rounded-t-lg bg-accent"
                  />
                  <Text className="text-[10px] font-semibold text-muted-foreground">
                    {month.month}
                  </Text>
                </View>
              );
            })}
          </View>
        </CardContent>
      </Card>

      <View className="flex-row gap-3">
        <Card className="flex-1 border border-border">
          <CardContent className="gap-1 p-4">
            <Text className="text-xs font-semibold text-muted-foreground">
              New customers
            </Text>
            <Text className="text-2xl font-extrabold">
              {analytics.customerInsights.newCustomers}
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              This month
            </Text>
          </CardContent>
        </Card>
        <Card className="flex-1 border border-border">
          <CardContent className="gap-1 p-4">
            <Text className="text-xs font-semibold text-muted-foreground">
              Retention
            </Text>
            <Text className="text-2xl font-extrabold">
              {analytics.customerInsights.retentionRate}%
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              Returning customers
            </Text>
          </CardContent>
        </Card>
        <Card className="flex-1 border border-border">
          <CardContent className="gap-1 p-4">
            <Text className="text-xs font-semibold text-muted-foreground">
              Deposits
            </Text>
            <Text className="text-2xl font-extrabold">
              ${Math.round(analytics.totalDeposits)}
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              {analytics.depositsChange}% vs last month
            </Text>
          </CardContent>
        </Card>
      </View>

      <Card className="border border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top services this month</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          {analytics.topServices.map((service) => (
            <View
              key={service.name}
              className="flex-row items-center justify-between border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-semibold">{service.name}</Text>
                <Text className="text-xs text-muted-foreground">
                  {service.bookings} booking
                  {service.bookings === 1 ? "" : "s"}
                </Text>
              </View>
              <Badge
                variant={service.trend === "up" ? "success" : "destructive"}
                size="sm"
                label={`${service.change}`}
              />
              {service.trend === "up" ? (
                <TrendingUp
                  size={16}
                  color="#16a34a"
                  style={{ marginLeft: 6 }}
                />
              ) : (
                <TrendingDown
                  size={16}
                  color="#dc2626"
                  style={{ marginLeft: 6 }}
                />
              )}
            </View>
          ))}
        </CardContent>
      </Card>
    </Screen>
  );
}
