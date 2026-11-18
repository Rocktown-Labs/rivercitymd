import * as React from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { useAction, useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import {
  CalendarClock,
  CarFront,
  ExternalLink,
  MapPin,
  PauseCircle,
  PlayCircle,
} from "lucide-react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { openBrowser } from "@/lib/browser";
import { ProfilePortalNav } from "@/components/profile-portal-nav";

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "past_due") return "destructive" as const;
  if (status === "pending_payment") return "warning" as const;
  return "secondary" as const;
}

export default function SubscriptionsScreen() {
  const subscriptions = useQuery(api.subscriptions.getByUser, { today: new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) });
  const createPortalSession = useAction(api.subscriptions.createCustomerPortalSession);
  const [isOpeningPortal, setIsOpeningPortal] = React.useState(false);

  const handleManageSubscription = async () => {
    setIsOpeningPortal(true);
    try {
      const url = await createPortalSession({});
      await openBrowser(url);
    } catch (error) {
      Alert.alert(
        "Unable to open billing",
        error instanceof Error ? error.message : "Please try again later.",
      );
    } finally {
      setIsOpeningPortal(false);
    }
  };

  return (
    <Screen>
      <ProfilePortalNav />
      <ScreenHeader
        eyebrow="Customer Portal"
        title="Subscriptions"
        description="Manage recurring service plans and billing."
      />

      {subscriptions === undefined ? (
        <View className="items-center gap-2 py-12">
          <ActivityIndicator size="small" color={THEME.light.accent} />
          <Text className="text-xs text-muted-foreground">Loading subscriptions...</Text>
        </View>
      ) : subscriptions.length === 0 ? (
        <EmptyState
          title="No subscriptions yet"
          description="Recurring service plans will appear here once you have one."
        />
      ) : (
        <View className="gap-3">
          {subscriptions.map((subscription) => (
            <Card key={subscription._id} className="border border-border">
              <CardContent className="gap-4 p-5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-lg font-bold">
                      {subscription.frequency === "biweekly" ? "Biweekly" : "Monthly"} service
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      ${subscription.totalPrice.toFixed(2)} per visit
                    </Text>
                  </View>
                  <Badge
                    variant={statusVariant(subscription.status)}
                    label={subscription.status.replace("_", " ").toUpperCase()}
                  />
                </View>

                <View className="gap-2 border-t border-border/60 pt-3">
                  <View className="flex-row items-center gap-2">
                    {subscription.status === "paused" ? (
                      <PauseCircle size={16} color={THEME.light.mutedForeground} />
                    ) : (
                      <PlayCircle size={16} color={THEME.light.accent} />
                    )}
                    <Text className="text-sm text-muted-foreground">
                      {subscription.serviceNames.join(", ") || "Selected services"}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <CarFront size={16} color={THEME.light.mutedForeground} />
                    <Text className="flex-1 text-sm text-muted-foreground">
                      {subscription.vehicleNames.join(", ") || "Selected vehicles"}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <CalendarClock size={16} color={THEME.light.mutedForeground} />
                    <Text className="text-sm text-muted-foreground">
                      {subscription.preferredTime} · {subscription.nextAppointmentDate ?? "Next date pending"}
                    </Text>
                  </View>
                  <View className="flex-row items-start gap-2">
                    <MapPin size={16} color={THEME.light.mutedForeground} />
                    <Text className="flex-1 text-sm text-muted-foreground">
                      {subscription.location.street}, {subscription.location.city}, {subscription.location.state} {subscription.location.zip}
                    </Text>
                  </View>
                </View>

                <Button
                  variant="outline"
                  disabled={isOpeningPortal}
                  onPress={() => void handleManageSubscription()}
                  className="flex-row items-center justify-center gap-2"
                >
                  {isOpeningPortal ? <ActivityIndicator size="small" color={THEME.light.foreground} /> : <ExternalLink size={16} color={THEME.light.foreground} />}
                  <Text className="font-semibold">Manage Billing</Text>
                </Button>
              </CardContent>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
