import * as React from "react";
import { View } from "react-native";
import { Host, Switch as ExpoSwitch } from "@expo/ui";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  containerClassName?: string;
}

export function Switch({
  label,
  description,
  containerClassName,
  value = false,
  onValueChange = () => {},
  disabled = false,
}: SwitchProps) {
  return (
    <View
      className={cn(
        "flex-row items-center justify-between gap-4 rounded-xl border border-border bg-card p-4",
        containerClassName,
      )}
    >
      <View className="flex-1 gap-0.5">
        {label ? <Text className="font-semibold">{label}</Text> : null}
        {description ? (
          <Text className="text-xs leading-4 text-muted-foreground">
            {description}
          </Text>
        ) : null}
      </View>
      <Host matchContents>
        <ExpoSwitch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
        />
      </Host>
    </View>
  );
}
