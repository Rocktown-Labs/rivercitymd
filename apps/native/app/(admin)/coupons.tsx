import * as React from "react";
import { Alert, Pressable, View } from "react-native";
import { useAction } from "convex/react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ArrowLeft, Plus, Tag, Trash2 } from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

type StripeCoupon = {
  id: string;
  name: string | null;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  max_redemptions: number | null;
  times_redeemed: number;
  valid: boolean;
};

export default function AdminCouponsScreen() {
  const listCoupons = useAction(api.payments.listStripeCoupons);
  const createCoupon = useAction(api.payments.createStripeCoupon);
  const deleteCoupon = useAction(api.payments.deleteStripeCoupon);

  const [coupons, setCoupons] = React.useState<StripeCoupon[] | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [discountType, setDiscountType] = React.useState<"percent" | "amount">(
    "percent",
  );
  const [discountValue, setDiscountValue] = React.useState("");
  const [duration, setDuration] = React.useState<"once" | "forever">("once");

  const loadCoupons = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listCoupons();
      setCoupons(data as StripeCoupon[]);
    } catch (error) {
      Alert.alert(
        "Could not load coupons",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [listCoupons]);

  React.useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  const handleCreate = async () => {
    const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const value = Number(discountValue);
    if (!normalizedCode) {
      Alert.alert("Coupon code required", "Enter a code like SUMMER20.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert("Invalid discount", "Enter a discount greater than zero.");
      return;
    }
    setIsSubmitting(true);
    try {
      await createCoupon({
        couponCode: normalizedCode,
        discountType,
        discountValue: value,
        duration,
      });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setIsCreateOpen(false);
      setCode("");
      setDiscountValue("");
      setDiscountType("percent");
      setDuration("once");
      await loadCoupons();
    } catch (error) {
      Alert.alert(
        "Could not create coupon",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (couponId: string) => {
    Alert.alert("Delete coupon?", `Coupon ${couponId} will stop working.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingId(couponId);
          try {
            await deleteCoupon({ couponId });
            await loadCoupons();
          } catch (error) {
            Alert.alert(
              "Could not delete coupon",
              error instanceof Error ? error.message : "Please try again.",
            );
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="flex-row items-center gap-1.5 active:opacity-70"
        >
          <ArrowLeft size={18} color={THEME.light.foreground} />
          <Text className="text-sm font-semibold">More Menu</Text>
        </Pressable>
        <Button
          size="sm"
          onPress={() => setIsCreateOpen(true)}
          className="flex-row items-center gap-1.5"
        >
          <Plus size={14} color={THEME.light.primaryForeground} />
          <Text className="font-bold text-primary-foreground">New Coupon</Text>
        </Button>
      </View>

      <ScreenHeader
        eyebrow="Promotions"
        title="Coupons"
        description="Create and manage Stripe discount codes for invoices and bookings."
      />

      {isLoading ? (
        <View className="items-center gap-2 py-16">
          <Text className="text-sm text-muted-foreground">
            Loading coupons...
          </Text>
        </View>
      ) : coupons?.length ? (
        <View className="gap-3">
          {coupons.map((coupon) => (
            <Card key={coupon.id} className="border border-border">
              <CardContent className="gap-3 p-4">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="font-bold text-base">{coupon.id}</Text>
                      <Badge
                        variant={coupon.valid ? "success" : "secondary"}
                        size="sm"
                        label={coupon.valid ? "Active" : "Archived"}
                      />
                    </View>
                    <Text className="text-xs text-muted-foreground">
                      {coupon.duration === "once"
                        ? "One-time use"
                        : "Forever"}{" "}
                      · {coupon.times_redeemed} redemption
                      {coupon.times_redeemed === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    <Text className="text-2xl font-extrabold text-accent">
                      {coupon.percent_off
                        ? `${coupon.percent_off}%`
                        : `$${coupon.amount_off ?? 0}`}
                    </Text>
                    <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      off
                    </Text>
                  </View>
                </View>
                <View className="flex-row items-center justify-between border-t border-border pt-2">
                  <Text className="text-xs text-muted-foreground">
                    {coupon.max_redemptions
                      ? `${coupon.max_redemptions} max`
                      : "Unlimited"}
                  </Text>
                  {coupon.valid ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => handleDelete(coupon.id)}
                      disabled={deletingId === coupon.id}
                      className="flex-row items-center gap-1.5 rounded-lg px-2 py-1 active:bg-destructive/10"
                    >
                      <Trash2 size={14} color={THEME.light.destructive} />
                      <Text className="text-xs font-semibold text-destructive">
                        {deletingId === coupon.id ? "Deleting..." : "Delete"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </CardContent>
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          title="No coupons yet"
          description="Create a discount code for a promotion, win-back, or invoice."
        />
      )}

      <Modal
        visible={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create coupon"
        description="Creates a Stripe coupon that can be applied to invoices and bookings."
      >
        <View className="gap-4">
          <Input
            label="Coupon code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            placeholder="SUMMER20"
          />
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Discount type
            </Text>
            <View className="flex-row gap-2">
              {(["percent", "amount"] as const).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setDiscountType(type)}
                  className={`flex-1 rounded-xl border px-3 py-2 ${
                    discountType === type
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-center text-xs font-bold ${
                      discountType === type ? "text-accent" : "text-foreground"
                    }`}
                  >
                    {type === "percent" ? "Percent" : "Amount"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Input
            label={discountType === "percent" ? "Percent off" : "Amount off ($)"}
            value={discountValue}
            onChangeText={setDiscountValue}
            keyboardType="decimal-pad"
            placeholder={discountType === "percent" ? "20" : "15"}
          />
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Duration
            </Text>
            <View className="flex-row gap-2">
              {(["once", "forever"] as const).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setDuration(option)}
                  className={`flex-1 rounded-xl border px-3 py-2 ${
                    duration === option
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-center text-xs font-bold ${
                      duration === option ? "text-accent" : "text-foreground"
                    }`}
                  >
                    {option === "once" ? "One-time" : "Forever"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Button
            onPress={handleCreate}
            disabled={isSubmitting}
            className="w-full flex-row items-center justify-center gap-2"
          >
            <Tag size={16} color={THEME.light.primaryForeground} />
            <Text className="font-bold text-primary-foreground">
              {isSubmitting ? "Creating..." : "Create Coupon"}
            </Text>
          </Button>
        </View>
      </Modal>
    </Screen>
  );
}
