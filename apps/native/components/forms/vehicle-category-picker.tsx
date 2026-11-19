import { Host, Picker } from "@expo/ui";
import { useQuery } from "convex/react";
import { View } from "react-native";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Doc } from "@rivercitymd/backend/convex/_generated/dataModel";
import { Text } from "@/components/ui/text";

export type VehicleCategory = Pick<
  Doc<"vehicleTypes">,
  "_id" | "name" | "legacySize"
>;

export function VehicleCategoryPicker({
  value,
  onSelect,
  disabled = false,
}: {
  value?: string;
  onSelect: (type: VehicleCategory | undefined) => void;
  disabled?: boolean;
}) {
  const types = useQuery(api.vehicleTypes.list, {});
  return (
    <View className="gap-2">
      <Text className="text-xs font-semibold">Vehicle category</Text>
      <Host matchContents style={{ minHeight: 44 }}>
        <Picker
          selectedValue={value ?? ""}
          onValueChange={(id: string) =>
            onSelect(types?.find((type) => type._id === id))
          }
          enabled={!disabled && Boolean(types?.length)}
          testID="vehicle-category-picker"
        >
          <Picker.Item label="Choose a category" value="" />
          {(types ?? []).map((type) => (
            <Picker.Item key={type._id} label={type.name} value={type._id} />
          ))}
        </Picker>
      </Host>
      {!value && (
        <Text className="text-xs text-muted-foreground">
          Select the category that fits your vehicle for accurate pricing.
        </Text>
      )}
    </View>
  );
}
