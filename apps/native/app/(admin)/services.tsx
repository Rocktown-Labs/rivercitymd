import * as React from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { Host, Switch as ExpoSwitch } from "@expo/ui";
import { Clock, Search } from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Doc, Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

const CATEGORY_TABS = [
  { label: "All", value: "all" },
  { label: "Packages", value: "standard" },
  { label: "Add-ons", value: "addon" },
  { label: "Subscriptions", value: "subscription" },
] as const;

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function AdminServicesScreen() {
  const services = useQuery(api.services.list, {});
  const updateServiceMutation = useMutation(api.services.update);

  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedService, setSelectedService] =
    React.useState<Doc<"services"> | null>(null);
  const [isUpdating, setIsUpdating] = React.useState(false);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [smallPrice, setSmallPrice] = React.useState("");
  const [mediumPrice, setMediumPrice] = React.useState("");
  const [largePrice, setLargePrice] = React.useState("");
  const [duration, setDuration] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [vehiclePrices, setVehiclePrices] = React.useState<
    Array<{
      vehicleTypeId: Id<"vehicleTypes">;
      vehicleTypeName: string;
      price: string;
      duration: string;
      isAvailable: boolean;
    }>
  >([]);

  React.useEffect(() => {
    if (!selectedService) return;
    setName(selectedService.name);
    setDescription(selectedService.description);
    setSmallPrice(String(selectedService.basePriceSmall ?? ""));
    setMediumPrice(String(selectedService.basePriceMedium ?? ""));
    setLargePrice(String(selectedService.basePriceLarge ?? ""));
    setDuration(String(selectedService.duration ?? ""));
    setIsActive(selectedService.isActive);
    setVehiclePrices(
      ((selectedService as any).vehiclePrices ?? []).map((row: any) => ({
        vehicleTypeId: row.vehicleTypeId,
        vehicleTypeName: row.vehicleType?.name ?? "Vehicle",
        price: String(row.price ?? ""),
        duration: String(row.duration ?? selectedService.duration ?? ""),
        isAvailable: row.isAvailable ?? true,
      })),
    );
  }, [selectedService]);

  const filteredServices = (services || []).filter((service) => {
    const matchesCategory =
      activeCategory === "all" ||
      (service.serviceType || "standard") === activeCategory;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      service.name.toLowerCase().includes(q) ||
      service.description.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const handleSaveService = async () => {
    if (!selectedService) return;
    setIsUpdating(true);
    try {
      await updateServiceMutation({
        serviceId: selectedService._id,
        name: name.trim(),
        description: description.trim(),
        basePriceSmall: toNumber(smallPrice, 0),
        basePriceMedium: toNumber(mediumPrice, 0),
        basePriceLarge: toNumber(largePrice, 0),
        duration: toNumber(duration, selectedService.duration),
        serviceType: selectedService.serviceType,
        vehiclePrices: vehiclePrices.map((row) => ({
          vehicleTypeId: row.vehicleTypeId,
          vehicleTypeName: row.vehicleTypeName,
          price: toNumber(row.price, 0),
          duration: toNumber(row.duration, selectedService.duration),
          isAvailable: row.isAvailable,
        })),
        isActive,
      });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setSelectedService(null);
      Alert.alert("Service updated", "The service and pricing are saved.");
    } catch (error) {
      Alert.alert(
        "Could not update service",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Catalog"
        title="Services & Pricing"
        description="Manage detailing packages, add-ons, durations, and vehicle size pricing."
      />

      <Input
        placeholder="Search services"
        value={searchQuery}
        onChangeText={setSearchQuery}
        leftIcon={<Search size={18} color={THEME.light.mutedForeground} />}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-1"
        contentContainerStyle={{ paddingHorizontal: 4, gap: 6 }}
      >
        {CATEGORY_TABS.map((tab) => {
          const isSelected = activeCategory === tab.value;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="button"
              onPress={() => setActiveCategory(tab.value)}
              className={`rounded-full px-4 py-2 border ${
                isSelected
                  ? "border-accent bg-accent"
                  : "border-border bg-card active:bg-secondary"
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  isSelected ? "text-accent-foreground" : "text-foreground"
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {filteredServices.length ? (
        <View className="gap-3">
          {filteredServices.map((service) => (
            <Card key={service._id} className="border border-border">
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedService(service)}
                className="p-4 gap-3 active:bg-secondary/30"
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="font-bold text-base">{service.name}</Text>
                      <Badge
                        variant={service.isActive ? "success" : "destructive"}
                        size="sm"
                        label={service.isActive ? "Active" : "Inactive"}
                      />
                    </View>
                    <Text
                      className="text-xs text-muted-foreground leading-4"
                      numberOfLines={2}
                    >
                      {service.description}
                    </Text>
                  </View>
                  <Text className="font-extrabold text-base text-accent">
                    $
                    {service.basePriceMedium?.toFixed(2) ||
                      service.basePrice?.toFixed(2) ||
                      "0.00"}
                  </Text>
                </View>

                <View className="flex-row items-center justify-between border-t border-border pt-2.5">
                  <View className="flex-row gap-2">
                    {service.basePriceSmall ? (
                      <Badge
                        variant="secondary"
                        size="sm"
                        label={`Sm: $${service.basePriceSmall}`}
                      />
                    ) : null}
                    {service.basePriceMedium ? (
                      <Badge
                        variant="secondary"
                        size="sm"
                        label={`Med: $${service.basePriceMedium}`}
                      />
                    ) : null}
                    {service.basePriceLarge ? (
                      <Badge
                        variant="secondary"
                        size="sm"
                        label={`Lg: $${service.basePriceLarge}`}
                      />
                    ) : null}
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Clock size={13} color={THEME.light.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">
                      {service.duration} mins
                    </Text>
                  </View>
                </View>
              </Pressable>
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          title="No services found"
          description="Services in this category will appear here."
        />
      )}

      <Modal
        visible={Boolean(selectedService)}
        onClose={() => setSelectedService(null)}
        title={selectedService?.name || "Service Details"}
        description={
          selectedService?.serviceType
            ? `${selectedService.serviceType.toUpperCase()} Tier`
            : "Package"
        }
      >
        {selectedService ? (
          <ScrollView
            contentContainerStyle={{ gap: 16, paddingBottom: 12 }}
            style={{ maxHeight: 540 }}
            keyboardShouldPersistTaps="handled"
          >
            <Input
              label="Service name"
              value={name}
              onChangeText={setName}
              placeholder="Service name"
            />
            <Input
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="What is included?"
              multiline
              className="h-24"
            />
            <View className="flex-row gap-2">
              <View className="flex-1 gap-1">
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Small
                </Text>
                <Input
                  value={smallPrice}
                  onChangeText={setSmallPrice}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Medium
                </Text>
                <Input
                  value={mediumPrice}
                  onChangeText={setMediumPrice}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Large
                </Text>
                <Input
                  value={largePrice}
                  onChangeText={setLargePrice}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
            </View>

            {vehiclePrices.length ? (
              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Per-vehicle-type pricing
                </Text>
                {vehiclePrices.map((row, index) => (
                  <View
                    key={row.vehicleTypeId}
                    className="gap-2 rounded-xl border border-border p-3"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold">
                        {row.vehicleTypeName}
                      </Text>
                      <Host matchContents>
                        <ExpoSwitch
                          value={row.isAvailable}
                          onValueChange={(value) =>
                            setVehiclePrices((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, isAvailable: value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Host>
                    </View>
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <Input
                          label="Price"
                          value={row.price}
                          onChangeText={(value) =>
                            setVehiclePrices((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, price: value }
                                  : item,
                              ),
                            )
                          }
                          keyboardType="decimal-pad"
                          placeholder="0"
                        />
                      </View>
                      <View className="flex-1">
                        <Input
                          label="Minutes"
                          value={row.duration}
                          onChangeText={(value) =>
                            setVehiclePrices((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, duration: value }
                                  : item,
                              ),
                            )
                          }
                          keyboardType="number-pad"
                          placeholder="60"
                        />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <Input
              label="Duration (minutes)"
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              placeholder="60"
            />
            <Switch
              label="Available for Online Booking"
              description="When active, customers can select this service in the booking flow."
              value={isActive}
              onValueChange={setIsActive}
            />
            <Button
              onPress={handleSaveService}
              disabled={isUpdating}
              className="w-full flex-row items-center justify-center gap-2"
            >
              <Text className="font-bold text-primary-foreground">
                {isUpdating ? "Saving..." : "Save Service"}
              </Text>
            </Button>
          </ScrollView>
        ) : null}
      </Modal>
    </Screen>
  );
}
