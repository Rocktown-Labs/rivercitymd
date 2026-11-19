import * as React from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { router } from "expo-router";
import { CarFront, Palette, Plus, Tag } from "lucide-react-native";

import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Text } from "@/components/ui/text";
import { VehicleLookup, type VehicleLookupValue } from "@/components/forms/vehicle-lookup";
import { THEME } from "@/lib/theme";

export default function VehiclesScreen() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const vehicles = useQuery(
    api.vehicles.getByUser,
    currentUser ? { userId: currentUser._id } : "skip",
  );
  const createVehicle = useMutation(api.vehicles.create);

  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [newVehicle, setNewVehicle] = React.useState<VehicleLookupValue>({
    year: "",
    make: "",
    model: "",
    size: "medium",
  });

  const handleSaveVehicle = async () => {
    if (!currentUser) return;
    if (!/^\d{4}$/.test(newVehicle.year) || !newVehicle.make.trim() || !newVehicle.model.trim()) {
      Alert.alert("Incomplete Details", "Please provide a valid 4-digit Year, Make, and Model.");
      return;
    }

    if (!newVehicle.vehicleTypeId) {
      Alert.alert(
        "Choose a category",
        "Select your vehicle category for accurate pricing.",
      );
      return;
    }
    setIsSaving(true);
    try {
      await createVehicle({
        userId: currentUser._id,
        year: Number(newVehicle.year),
        make: newVehicle.make.trim(),
        model: newVehicle.model.trim(),
        color: newVehicle.color?.trim() || undefined,
        licensePlate: newVehicle.licensePlate?.trim() || undefined,
        size: newVehicle.size || "medium",
        vehicleTypeId: newVehicle.vehicleTypeId as Id<"vehicleTypes"> | undefined,
        classification: newVehicle.classification,
      });

      setIsAddModalOpen(false);
      setNewVehicle({ year: "", make: "", model: "", size: "medium" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add vehicle";
      Alert.alert("Error", message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <ScreenHeader
          eyebrow="Your Garage"
          title="Vehicles"
          description="Keep your vehicle details ready for faster bookings and accurate pricing."
        />
      </View>

      <Button
        variant="default"
        onPress={() => setIsAddModalOpen(true)}
        className="flex-row items-center justify-center gap-2 self-start mb-2"
      >
        <Plus size={16} color={THEME.light.primaryForeground} />
        <Text className="font-bold text-primary-foreground">Add Vehicle</Text>
      </Button>

      {vehicles?.length ? (
        <View className="gap-3">
          {vehicles.map((vehicle) => (
            <Pressable
              key={vehicle._id}
              accessibilityRole="button"
              onPress={() => router.push(`/vehicles/${vehicle._id}`)}
              className="active:opacity-90"
            >
              <Card className="border border-border">
                <CardContent className="flex-row items-center gap-4 p-4">
                  <View className="h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                    <CarFront size={24} color={THEME.light.accent} />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-lg font-bold">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </Text>
                      <Badge
                        variant="accent"
                        size="sm"
                        label={vehicle.vehicleType?.name || vehicle.size || "Standard"}
                      />
                    </View>

                    <View className="flex-row items-center gap-3 mt-0.5">
                      {vehicle.color ? (
                        <View className="flex-row items-center gap-1">
                          <Palette size={13} color={THEME.light.mutedForeground} />
                          <Text className="text-xs text-muted-foreground">{vehicle.color}</Text>
                        </View>
                      ) : null}
                      {vehicle.licensePlate ? (
                        <View className="flex-row items-center gap-1">
                          <Tag size={13} color={THEME.light.mutedForeground} />
                          <Text className="text-xs text-muted-foreground">{vehicle.licensePlate}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </CardContent>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : (
        <EmptyState
          title="Your garage is empty"
          description="Add your vehicles here with live model lookup so pricing and service duration are always exact."
        />
      )}

      {/* Add Vehicle Modal Sheet */}
      <Modal
        visible={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Vehicle to Garage"
        description="Search by make and model to automatically classify size and specifications."
      >
        <View className="gap-4">
          <VehicleLookup
            value={newVehicle}
            onChange={setNewVehicle}
            showColor
            showLicensePlate
          />

          <View className="flex-row gap-3 pt-2">
            <Button
              variant="outline"
              onPress={() => setIsAddModalOpen(false)}
              className="flex-1"
              disabled={isSaving}
            >
              <Text className="font-semibold">Cancel</Text>
            </Button>
            <Button
              variant="default"
              onPress={handleSaveVehicle}
              className="flex-2"
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={THEME.light.primaryForeground} />
              ) : (
                <Text className="font-bold text-primary-foreground">Save Vehicle</Text>
              )}
            </Button>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
