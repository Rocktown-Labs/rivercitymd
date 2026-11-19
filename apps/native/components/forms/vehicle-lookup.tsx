import * as React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAction } from "convex/react";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import {
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  Palette,
  Search,
  Trash2,
  X,
} from "lucide-react-native";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

export type VehicleClassification = {
  source: "fuelEconomy" | "vpic" | "manual" | "fallback";
  confidence: "high" | "medium" | "low";
  rawCategory?: string;
  needsAdminReview: boolean;
};

export type VehicleLookupValue = {
  year: string;
  make: string;
  model: string;
  color?: string;
  licensePlate?: string;
  size?: "small" | "medium" | "large";
  vehicleTypeId?: string;
  vehicleTypeName?: string;
  classification?: VehicleClassification;
};

export interface VehicleLookupProps {
  value: VehicleLookupValue;
  onChange: (value: VehicleLookupValue) => void;
  title?: string;
  showColor?: boolean;
  showLicensePlate?: boolean;
  onRemove?: () => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  onSelectVehicle?: (vehicle: VehicleLookupValue) => void;
}

export function VehicleLookup({
  value,
  onChange,
  title,
  showColor = true,
  showLicensePlate = false,
  onRemove,
  isExpanded,
  onToggleExpanded,
  onSelectVehicle,
}: VehicleLookupProps) {
  const [internalExpanded, setInternalExpanded] = React.useState(true);
  const isCardExpanded = isExpanded !== undefined ? isExpanded : internalExpanded;
  const toggleCard = onToggleExpanded || (() => setInternalExpanded((prev) => !prev));

  const [searchQuery, setSearchQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<
    Array<{
      year: number;
      make: string;
      model: string;
      label: string;
      source: "fuelEconomy" | "vpic";
      matchedTrim?: string;
    }>
  >([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isClassifying, setIsClassifying] = React.useState(false);
  const [isManualMode, setIsManualMode] = React.useState(false);

  const searchModels = useAction(api.vehicleTypes.searchModels);
  const classifyVehicle = useAction(api.vehicleTypes.classify);

  const isVehicleSelected = Boolean(
    value.year && /^\d{4}$/.test(value.year) && value.make?.trim() && value.model?.trim(),
  );

  // Debounced auto-complete search
  React.useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchModels({ query: trimmed });
        setSuggestions(results || []);
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, searchModels]);

  const handleSelectSuggestion = async (suggestion: {
    year: number;
    make: string;
    model: string;
    label: string;
  }) => {
    setSuggestions([]);
    setSearchQuery("");
    setIsClassifying(true);

    try {
      const classification = await classifyVehicle({
        year: suggestion.year,
        make: suggestion.make,
        model: suggestion.model,
      });

      const nextVehicle: VehicleLookupValue = {
        ...value,
        year: String(suggestion.year),
        make: suggestion.make,
        model: suggestion.model,
        size: classification.legacySize,
        vehicleTypeId: classification.vehicleTypeId,
        vehicleTypeName: classification.vehicleTypeName,
        classification: {
          source: classification.source,
          confidence: classification.confidence,
          rawCategory: classification.rawCategory,
          needsAdminReview: classification.needsAdminReview,
        },
      };

      onChange(nextVehicle);
      onSelectVehicle?.(nextVehicle);
    } catch {
      const nextVehicle: VehicleLookupValue = {
        ...value,
        year: String(suggestion.year),
        make: suggestion.make,
        model: suggestion.model,
        size: "medium",
      };
      onChange(nextVehicle);
      onSelectVehicle?.(nextVehicle);
    } finally {
      setIsClassifying(false);
    }
  };

  const handleManualClassify = async (year: string, make: string, model: string) => {
    if (!/^\d{4}$/.test(year) || !make.trim() || !model.trim()) return;

    setIsClassifying(true);
    try {
      const classification = await classifyVehicle({
        year: Number(year),
        make: make.trim(),
        model: model.trim(),
      });

      const nextVehicle: VehicleLookupValue = {
        ...value,
        year,
        make: make.trim(),
        model: model.trim(),
        size: classification.legacySize,
        vehicleTypeId: classification.vehicleTypeId,
        vehicleTypeName: classification.vehicleTypeName,
        classification: {
          source: classification.source,
          confidence: classification.confidence,
          rawCategory: classification.rawCategory,
          needsAdminReview: classification.needsAdminReview,
        },
      };

      onChange(nextVehicle);
      onSelectVehicle?.(nextVehicle);
    } catch {
      onChange({
        ...value,
        year,
        make: make.trim(),
        model: model.trim(),
      });
    } finally {
      setIsClassifying(false);
    }
  };

  const handleClearVehicle = () => {
    onChange({
      year: "",
      make: "",
      model: "",
      color: value.color,
      licensePlate: value.licensePlate,
      size: undefined,
      vehicleTypeId: undefined,
      vehicleTypeName: undefined,
      classification: undefined,
    });
    setSearchQuery("");
    setSuggestions([]);
    setIsManualMode(false);
  };

  return (
    <Card className="overflow-hidden border border-border">
      {/* Accordion Header */}
      <Pressable
        accessibilityRole="button"
        onPress={toggleCard}
        className="flex-row items-center justify-between p-4 bg-card active:bg-secondary/40"
      >
        <View className="flex-row items-center gap-3 flex-1">
          <View
            className={`h-7 w-7 items-center justify-center rounded-full ${
              isVehicleSelected ? "bg-emerald-600" : "bg-accent/10"
            }`}
          >
            {isVehicleSelected ? (
              <Check size={14} color="#fff" />
            ) : (
              <CarFront size={15} color={THEME.light.accent} />
            )}
          </View>

          <View className="flex-1">
            <Text className="font-bold text-sm">
              {title || (isVehicleSelected ? `${value.year} ${value.make} ${value.model}` : "Vehicle")}
            </Text>
            {!isCardExpanded && isVehicleSelected ? (
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {value.year} {value.make} {value.model}
                {value.vehicleTypeName ? ` · ${value.vehicleTypeName}` : ""}
                {value.color ? ` · ${value.color}` : ""}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="flex-row items-center gap-2">
          {!isCardExpanded && isVehicleSelected ? (
            <Badge variant="success" size="sm" label="Saved" />
          ) : null}

          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              onPress={(e) => {
                e.stopPropagation?.();
                onRemove();
              }}
              className="h-7 w-7 items-center justify-center rounded-full bg-destructive/10 active:bg-destructive/20"
            >
              <Trash2 size={13} color={THEME.light.destructive} />
            </Pressable>
          ) : null}

          {isCardExpanded ? (
            <ChevronUp size={18} color={THEME.light.mutedForeground} />
          ) : (
            <ChevronDown size={18} color={THEME.light.mutedForeground} />
          )}
        </View>
      </Pressable>

      {/* Accordion Body */}
      {isCardExpanded ? (
        <CardContent className="gap-3.5 p-4 pt-1 border-t border-border/50">
          {/* Selected Vehicle State */}
          {isVehicleSelected && !isManualMode ? (
            <View className="gap-3">
              <View className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-row items-center gap-2.5 flex-1">
                    <View className="h-6 w-6 items-center justify-center rounded-full bg-emerald-600">
                      <Check size={14} color="#fff" />
                    </View>
                    <View className="flex-1 gap-0.5">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-sm font-extrabold text-emerald-950 dark:text-emerald-100">
                          {value.year} {value.make} {value.model}
                        </Text>
                        {value.vehicleTypeName ? (
                          <Badge variant="accent" size="sm" label={value.vehicleTypeName} />
                        ) : null}
                      </View>
                      <Text className="text-xs text-emerald-800 dark:text-emerald-300">
                        Vehicle specifications & pricing type detected
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    onPress={handleClearVehicle}
                    className="rounded-full bg-emerald-500/20 p-1.5 active:bg-emerald-500/40"
                  >
                    <X size={14} color={THEME.light.foreground} />
                  </Pressable>
                </View>
              </View>

              {/* Optional Color Input */}
              {showColor ? (
                <Input
                  label="Vehicle Color (Optional)"
                  placeholder="e.g. Midnight Black, Pearl White"
                  value={value.color || ""}
                  onChangeText={(text) => onChange({ ...value, color: text })}
                  leftIcon={<Palette size={16} color={THEME.light.mutedForeground} />}
                />
              ) : null}

              {showLicensePlate ? (
                <Input
                  label="License Plate (Optional)"
                  placeholder="ABC-1234"
                  autoCapitalize="characters"
                  value={value.licensePlate || ""}
                  onChangeText={(text) => onChange({ ...value, licensePlate: text.toUpperCase() })}
                />
              ) : null}
            </View>
          ) : (
            /* Search & Selection Mode */
            <View className="gap-2.5">
              {!isManualMode ? (
                <View className="gap-2">
                  <Input
                    label="Search by Year, Make, Model"
                    placeholder="e.g. 2021 Toyota RAV4 or 2018 Ford F-150"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    leftIcon={
                      isSearching ? (
                        <ActivityIndicator size="small" color={THEME.light.accent} />
                      ) : (
                        <Search size={18} color={THEME.light.mutedForeground} />
                      )
                    }
                    rightIcon={
                      searchQuery ? (
                        <Pressable accessibilityRole="button" onPress={() => setSearchQuery("")}>
                          <X size={16} color={THEME.light.mutedForeground} />
                        </Pressable>
                      ) : undefined
                    }
                  />

                  {/* Suggestions List */}
                  {suggestions.length > 0 ? (
                    <View className="rounded-2xl border border-border bg-card p-1 shadow-lg">
                      {suggestions[0]?.matchedTrim ? (
                        <Text className="px-3 py-2 text-xs text-muted-foreground">
                          {suggestions[0].matchedTrim} is a trim. Choose your vehicle’s model below; trim availability varies by year.
                        </Text>
                      ) : null}
                      {suggestions.slice(0, 6).map((item, index) => (
                        <Pressable
                          key={`${item.year}-${item.make}-${item.model}-${index}`}
                          accessibilityRole="button"
                          onPress={() => void handleSelectSuggestion(item)}
                          className={`flex-row items-center justify-between rounded-xl p-3 active:bg-secondary ${
                            index < suggestions.length - 1 ? "border-b border-border/40" : ""
                          }`}
                        >
                          <View className="flex-1 gap-0.5">
                            <Text className="text-sm font-bold text-foreground">
                              {item.year} {item.make} {item.model}
                            </Text>
                            <Text className="text-xs text-muted-foreground">{item.label}</Text>
                          </View>
                          <Check size={16} color={THEME.light.accent} />
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                /* Manual Entry Form */
                <View className="gap-3 rounded-2xl border border-border bg-secondary/30 p-3.5">
                  <View className="flex-row gap-2.5">
                    <View className="w-24">
                      <Input
                        label="Year"
                        placeholder="2022"
                        keyboardType="numeric"
                        maxLength={4}
                        value={value.year}
                        onChangeText={(text) => {
                          const next = { ...value, year: text };
                          onChange(next);
                          if (text.length === 4 && value.make && value.model) {
                            void handleManualClassify(text, value.make, value.model);
                          }
                        }}
                      />
                    </View>
                    <View className="flex-1">
                      <Input
                        label="Make"
                        placeholder="Toyota"
                        value={value.make}
                        onChangeText={(text) => {
                          const next = { ...value, make: text };
                          onChange(next);
                          if (value.year && text && value.model) {
                            void handleManualClassify(value.year, text, value.model);
                          }
                        }}
                      />
                    </View>
                  </View>

                  <Input
                    label="Model"
                    placeholder="RAV4"
                    value={value.model}
                    onChangeText={(text) => {
                      const next = { ...value, model: text };
                      onChange(next);
                      if (value.year && value.make && text) {
                        void handleManualClassify(value.year, value.make, text);
                      }
                    }}
                  />

                  {showColor ? (
                    <Input
                      label="Color (Optional)"
                      placeholder="e.g. Midnight Black"
                      value={value.color || ""}
                      onChangeText={(text) => onChange({ ...value, color: text })}
                      leftIcon={<Palette size={16} color={THEME.light.mutedForeground} />}
                    />
                  ) : null}
                </View>
              )}

              {/* Toggle between Search and Manual Entry */}
              <View className="flex-row justify-end">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsManualMode(!isManualMode)}
                  className="py-1 px-2 active:opacity-70"
                >
                  <Text className="text-xs font-semibold text-accent">
                    {isManualMode ? "Search Vehicles by Make & Model" : "Enter Vehicle Manually"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {isClassifying ? (
            <View className="flex-row items-center gap-2 rounded-xl bg-accent/10 p-3">
              <ActivityIndicator size="small" color={THEME.light.accent} />
              <Text className="text-xs font-semibold text-accent">
                Detecting vehicle category and pricing rules...
              </Text>
            </View>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
