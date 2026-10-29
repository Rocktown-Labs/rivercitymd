import * as React from "react";
import { Alert, Pressable, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  CalendarClock,
  Pause,
  Play,
  X,
} from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

export default function AdminSubscriptionsScreen() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const isAdmin = currentUser?.role === "admin";
  const subscriptions = useQuery(
    api.subscriptions.list,
    isAdmin ? {} : "skip",
  );
  const pauseSubscription = useMutation(api.subscriptions.pause);
  const resumeSubscription = useMutation(api.subscriptions.resume);
  const cancelSubscription = useMutation(api.subscriptions.cancel);
  const [actionId, setActionId] = React.useState<Id<"subscriptions"> | null>(
    null,
  );

  const runAction = async (
    id: Id<"subscriptions">,
    action: "pause" | "resume" | "cancel",
  ) => {
    setActionId(id);
    try {
      if (action === "pause") await pauseSubscription({ subscriptionId: id });
      if (action === "resume") await resumeSubscription({ subscriptionId: id });
      if (action === "cancel") await cancelSubscription({ subscriptionId: id });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      Alert.alert(
        `Could not ${action} subscription`,
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setActionId(null);
    }
  };

  const confirmCancel = (id: Id<"subscriptions">) => {
    Alert.alert(
      "Cancel membership?",
      "This cancels the Stripe subscription and future recurring appointments.",
      [
        { text: "Keep Membership", style: "cancel" },
        {
          text: "Cancel Membership",
          style: "destructive",
          onPress: () => void runAction(id, "cancel"),
        },
      ],
    );
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        className="flex-row items-center gap-1.5 self-start active:opacity-70"
      >
        <ArrowLeft size={18} color={THEME.light.foreground} />
        <Text className="text-sm font-semibold">More Menu</Text>
      </Pressable>

      <ScreenHeader
        eyebrow="Recurring Revenue"
        title="Memberships"
        description="Pause, resume, or cancel Maintenance Club subscriptions."
      />

      {subscriptions?.length ? (
        <View className="gap-3">
          {subscriptions.map((subscription: any) => (
            <Card key={subscription._id} className="border border-border">
              <CardContent className="gap-3 p-4">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-0.5">
                    <Text className="font-bold text-base">
                      {subscription.userName}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {subscription.userEmail || "No email"}
                    </Text>
                  </View>
                  <Badge
                    variant={
                      subscription.status === "active"
                        ? "success"
                        : subscription.status === "paused"
                          ? "warning"
                          : subscription.status === "cancelled"
                            ? "destructive"
                            : "secondary"
                    }
                    size="sm"
                    label={subscription.status.replaceAll("_", " ")}
                  />
                </View>

                <View className="gap-1 border-t border-border pt-2.5">
                  <Text className="text-xs font-semibold">
                    {subscription.serviceNames?.join(", ") ||
                      "Maintenance Club"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {subscription.vehicleNames?.join(", ") || "No vehicles"}
                  </Text>
                  <View className="flex-row items-center gap-3 pt-1">
                    <View className="flex-row items-center gap-1">
                      <CalendarClock
                        size={13}
                        color={THEME.light.mutedForeground}
                      />
                      <Text className="text-xs text-muted-foreground">
                        {subscription.frequency}
                      </Text>
                    </View>
                    <Text className="text-xs font-bold text-accent">
                      ${subscription.totalPrice?.toFixed(2) ?? "0.00"} / cycle
                    </Text>
                  </View>
                </View>

                {subscription.status !== "cancelled" ? (
                  <View className="flex-row gap-2 border-t border-border pt-2.5">
                    {subscription.status === "active" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 flex-row items-center justify-center gap-1.5"
                        disabled={actionId === subscription._id}
                        onPress={() =>
                          void runAction(subscription._id, "pause")
                        }
                      >
                        <Pause size={13} color={THEME.light.foreground} />
                        <Text className="text-xs font-semibold">Pause</Text>
                      </Button>
                    ) : null}
                    {subscription.status === "paused" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 flex-row items-center justify-center gap-1.5"
                        disabled={actionId === subscription._id}
                        onPress={() =>
                          void runAction(subscription._id, "resume")
                        }
                      >
                        <Play size={13} color={THEME.light.foreground} />
                        <Text className="text-xs font-semibold">Resume</Text>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 flex-row items-center justify-center gap-1.5"
                      disabled={actionId === subscription._id}
                      onPress={() => confirmCancel(subscription._id)}
                    >
                      <X size={13} color={THEME.light.destructive} />
                      <Text className="text-xs font-semibold text-destructive">
                        Cancel
                      </Text>
                    </Button>
                  </View>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          title="No memberships yet"
          description="Maintenance Club subscriptions will appear here."
        />
      )}
    </Screen>
  );
}
