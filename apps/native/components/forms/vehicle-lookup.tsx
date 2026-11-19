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
import {
  VehicleCategoryPicker,
  type VehicleCategory,
} from "./vehicle-category-picker";
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
  const isCardExpanded =
    isExpanded !== undefined ? isExpanded : internalExpanded;
  const toggleCard =
    onToggleExpanded || (() => setInternalExpanded((prev) => !prev));

  const [searchQuery, setSearchQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<
    Array<{
      year: number;
      make: string;
      model: string;
      label: string;
      source: "fuelEconomy" | "vpic";
      matchedTrim?: string;
      similarModelMatch?: boolean;
    }>
  >([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isClassifying, setIsClassifying] = React.useState(false);
  const [isManualMode, setIsManualMode] = React.useState(false);

  const valueRef = React.useRef(value);
  valueRef.current = value;
  const selectionVersion = React.useRef(0);
  const searchVersion = React.useRef(0);
  const manualTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  React.useEffect(
    () => () => {
      selectionVersion.current++;
      searchVersion.current++;
      clearTimeout(manualTimer.current);
    },
    [],
  );

  const searchModels = useAction(api.vehicleTypes.searchModels);
  const classifyVehicle = useAction(api.vehicleTypes.classify);

  const isVehicleSelected = Boolean(
    value.year &&
    /^\d{4}$/.test(value.year) &&
    Number(value.year) >= 1900 &&
    Number(value.year) <= new Date().getFullYear() + 1 &&
    value.make?.trim() &&
    value.model?.trim(),
  );

  // Ignore in-flight results after another query, clear, or unmount.
  React.useEffect(() => {
    const version = ++searchVersion.current;
    let cancelled = false;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3 || isManualMode) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchModels({ query: trimmed });
        if (!cancelled && version === searchVersion.current)
          setSuggestions(results);
      } catch {
        if (!cancelled && version === searchVersion.current) setSuggestions([]);
      } finally {
        if (!cancelled && version === searchVersion.current)
          setIsSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, searchModels, isManualMode]);

  const publish = (next: VehicleLookupValue) => {
    valueRef.current = next;
    onChange(next);
  };
  const invalidateClassification = () => {
    selectionVersion.current++;
    clearTimeout(manualTimer.current);
    setIsClassifying(false);
  };
  const classifySelection = async (next: VehicleLookupValue) => {
    const version = ++selectionVersion.current;
    publish(next);
    if (next.classification?.source === "manual" && next.vehicleTypeId) return;
    if (
      !/^\d{4}$/.test(next.year) ||
      Number(next.year) < 1900 ||
      Number(next.year) > new Date().getFullYear() + 1 ||
      !next.make.trim() ||
      !next.model.trim()
    )
      return;
    setIsClassifying(true);
    try {
      const result = await classifyVehicle({
        year: Number(next.year),
        make: next.make.trim(),
        model: next.model.trim(),
      });
      if (
        version !== selectionVersion.current ||
        valueRef.current.year !== next.year ||
        valueRef.current.make !== next.make ||
        valueRef.current.model !== next.model
      )
        return;
      const resolved = {
        ...valueRef.current,
        vehicleTypeId: result.vehicleTypeId,
        vehicleTypeName: result.vehicleTypeName,
        size: result.vehicleTypeId ? result.legacySize : undefined,
        classification: {
          source: result.source,
          confidence: result.confidence,
          rawCategory: result.rawCategory,
          needsAdminReview: result.needsAdminReview,
        },
      };
      publish(resolved);
      if (resolved.vehicleTypeId) onSelectVehicle?.(resolved);
    } catch {
      if (
        version !== selectionVersion.current ||
        valueRef.current.year !== next.year ||
        valueRef.current.make !== next.make ||
        valueRef.current.model !== next.model
      )
        return;
      publish({
        ...valueRef.current,
        size: undefined,
        vehicleTypeId: undefined,
        vehicleTypeName: undefined,
        classification: {
          source: "fallback",
          confidence: "low",
          needsAdminReview: true,
        },
      });
    } finally {
      if (version === selectionVersion.current) setIsClassifying(false);
    }
  };
  const handleSelectSuggestion = async (suggestion: {
    year: number;
    make: string;
    model: string;
    label: string;
  }) => {
    clearTimeout(manualTimer.current);
    searchVersion.current++;
    setSuggestions([]);
    setSearchQuery("");
    await classifySelection({
      ...valueRef.current,
      year: String(suggestion.year),
      make: suggestion.make,
      model: suggestion.model,
      size: undefined,
      vehicleTypeId: undefined,
      vehicleTypeName: undefined,
      classification: undefined,
    });
  };
  const handleManualEdit = (patch: Partial<VehicleLookupValue>) => {
    invalidateClassification();
    const next = {
      ...valueRef.current,
      ...patch,
      size: undefined,
      vehicleTypeId: undefined,
      vehicleTypeName: undefined,
      classification: undefined,
    };
    publish(next);
    if (/^\d{4}$/.test(next.year) && next.make.trim() && next.model.trim()) {
      manualTimer.current = setTimeout(() => void classifySelection(valueRef.current), 350);
    }
  };
  const selectCategory = (type: VehicleCategory | undefined) => {
    invalidateClassification();
    const next: VehicleLookupValue = {
      ...valueRef.current,
      vehicleTypeId: type?._id,
      vehicleTypeName: type?.name,
      size: type?.legacySize,
      classification: type
        ? {
            source: "manual",
            confidence: "high",
            rawCategory: "Manual customer category selection",
            needsAdminReview: false,
          }
        : undefined,
    };
    publish(next);
    if (type) onSelectVehicle?.(next);
  };

  const handleClearVehicle = () => {
    invalidateClassification();
    searchVersion.current++;
    publish({
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
              {title ||
                (isVehicleSelected
                  ? `${value.year} ${value.make} ${value.model}`
                  : "Vehicle")}
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
            <Badge
              variant="success"
              size="sm"
              label={value.vehicleTypeId ? "Selected" : "Choose category"}
            />
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
                          <Badge
                            variant="accent"
                            size="sm"
                            label={value.vehicleTypeName}
                          />
                        ) : null}
                      </View>
                      <Text className="text-xs text-emerald-800 dark:text-emerald-300">
                        {value.vehicleTypeId
                          ? "Vehicle category selected"
                          : "Choose a category below for accurate pricing"}
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
                  onChangeText={(text) =>
                    publish({ ...valueRef.current, color: text })
                  }
                  leftIcon={
                    <Palette size={16} color={THEME.light.mutedForeground} />
                  }
                />
              ) : null}

              {showLicensePlate ? (
                <Input
                  label="License Plate (Optional)"
                  placeholder="ABC-1234"
                  autoCapitalize="characters"
                  value={value.licensePlate || ""}
                  onChangeText={(text) =>
                    publish({
                      ...valueRef.current,
                      licensePlate: text.toUpperCase(),
                    })
                  }
                />
              ) : null}
            </View>
          ) : (
            /* Search & Selection Mode */
            <View className="gap-2.5">
              {!isManualMode ? (
                <View className="gap-2">
                  <Input
                    label="Search by Make, Model or Trim"
                    placeholder="e.g. Yukon Denali, STX, or 2021 Toyota RAV4"
                    value={searchQuery}
                    onChangeText={(text) => {
                      invalidateClassification();
                      searchVersion.current++;
                      setSearchQuery(text);
                    }}
                    leftIcon={
                      isSearching ? (
                        <ActivityIndicator
                          size="small"
                          color={THEME.light.accent}
                        />
                      ) : (
                        <Search size={18} color={THEME.light.mutedForeground} />
                      )
                    }
                    rightIcon={
                      searchQuery ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setSearchQuery("")}
                        >
                          <X size={16} color={THEME.light.mutedForeground} />
                        </Pressable>
                      ) : undefined
                    }
                  />

                  {/* Suggestions List */}
                  {suggestions.length > 0 ? (
                    <View className="rounded-2xl border border-border bg-card p-1 shadow-lg">
                      {suggestions.some((suggestion) => suggestion.similarModelMatch) ? (
                        <Text className="px-3 py-2 text-xs text-muted-foreground">
                          Similar model names found. Choose the vehicle that matches yours.
                        </Text>
                      ) : null}
                      {suggestions[0]?.matchedTrim ? (
                        <Text className="px-3 py-2 text-xs text-muted-foreground">
                          {suggestions[0].matchedTrim} can match several
                          vehicles. Choose your model and body below; trim
                          availability varies by year.
                        </Text>
                      ) : null}
                      {suggestions.map((item, index) => (
                        <Pressable
                          key={`${item.year}-${item.make}-${item.model}-${index}`}
                          accessibilityRole="button"
                          onPress={() => void handleSelectSuggestion(item)}
                          className={`flex-row items-center justify-between rounded-xl p-3 active:bg-secondary ${
                            index < suggestions.length - 1
                              ? "border-b border-border/40"
                              : ""
                          }`}
                        >
                          <View className="flex-1 gap-0.5">
                            <Text className="text-sm font-bold text-foreground">
                              {item.year} {item.make} {item.model}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              {item.label}
                            </Text>
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
                        onChangeText={(text) =>
                          handleManualEdit({ year: text })
                        }
                      />
                    </View>
                    <View className="flex-1">
                      <Input
                        label="Make"
                        placeholder="Toyota"
                        value={value.make}
                        onChangeText={(text) =>
                          handleManualEdit({ make: text })
                        }
                      />
                    </View>
                  </View>

                  <Input
                    label="Model"
                    placeholder="RAV4"
                    value={value.model}
                    onChangeText={(text) => handleManualEdit({ model: text })}
                  />

                  {showColor ? (
                    <Input
                      label="Color (Optional)"
                      placeholder="e.g. Midnight Black"
                      value={value.color || ""}
                      onChangeText={(text) =>
                        publish({ ...valueRef.current, color: text })
                      }
                      leftIcon={
                        <Palette
                          size={16}
                          color={THEME.light.mutedForeground}
                        />
                      }
                    />
                  ) : null}
                </View>
              )}

              {/* Toggle between Search and Manual Entry */}
              <View className="flex-row justify-end">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    invalidateClassification();
                    searchVersion.current++;
                    setIsManualMode(!isManualMode);
                  }}
                  className="py-1 px-2 active:opacity-70"
                >
                  <Text className="text-xs font-semibold text-accent">
                    {isManualMode
                      ? "Search Vehicles by Make & Model"
                      : "Enter Vehicle Manually"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {(isManualMode || isVehicleSelected) && (
            <VehicleCategoryPicker
              value={value.vehicleTypeId}
              onSelect={selectCategory}
              disabled={!isVehicleSelected}
            />
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
