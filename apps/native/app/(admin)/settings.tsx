import * as React from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useAction, useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { Host, Switch as ExpoSwitch } from "@expo/ui";
import {
  ArrowLeft,
  Clock,
  CreditCard,
  Dog,
  MapPin,
  Navigation,
  Pencil,
  Settings,
  X,
} from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType = "default",
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  placeholder?: string;
}) {
  return (
    <View className="flex-1 gap-1">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Input
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        className="h-10"
      />
    </View>
  );
}

const DAYS = [
  { dayOfWeek: 0, label: "Sun" },
  { dayOfWeek: 1, label: "Mon" },
  { dayOfWeek: 2, label: "Tue" },
  { dayOfWeek: 3, label: "Wed" },
  { dayOfWeek: 4, label: "Thu" },
  { dayOfWeek: 5, label: "Fri" },
  { dayOfWeek: 6, label: "Sat" },
] as const;

type BusinessHour = {
  dayOfWeek: number;
  label: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

export default function AdminSettingsScreen() {
  const businessInfo = useQuery(api.business.get);
  const depositSettings = useQuery(api.depositSettings.get);
  const petFeeSettings = useQuery(api.petFeeSettings.get);
  const travelFeeSettings = useQuery(api.travelFeeSettings.get);
  const businessHours = useQuery(api.availability.getBusinessHours);

  const updateBusiness = useMutation(api.business.update);
  const updateDeposit = useMutation(api.depositSettings.upsert);
  const updatePetFees = useMutation(api.petFeeSettings.upsert);
  const setBusinessHours = useMutation(api.availability.setBusinessHours);
  const validateTravelOrigin = useAction(
    api.travelFeeSettings.validateOriginAndUpsert,
  );

  const [isEditing, setIsEditing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [hours, setHours] = React.useState<BusinessHour[]>(() =>
    DAYS.map((day) => ({
      ...day,
      startTime: "08:00",
      endTime: "18:00",
      isActive: day.dayOfWeek !== 0,
    })),
  );

  const [businessName, setBusinessName] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [cityStateZip, setCityStateZip] = React.useState("");
  const [country, setCountry] = React.useState("US");
  const [depositAmount, setDepositAmount] = React.useState("50");
  const [petSmall, setPetSmall] = React.useState("40");
  const [petMedium, setPetMedium] = React.useState("50");
  const [petLarge, setPetLarge] = React.useState("60");
  const [petTime, setPetTime] = React.useState("30");
  const [petActive, setPetActive] = React.useState(true);
  const [originStreet, setOriginStreet] = React.useState("");
  const [originCity, setOriginCity] = React.useState("Little Rock");
  const [originState, setOriginState] = React.useState("AR");
  const [originZip, setOriginZip] = React.useState("72201");
  const [freeRadius, setFreeRadius] = React.useState("20");
  const [shortMax, setShortMax] = React.useState("30");
  const [midMax, setMidMax] = React.useState("45");
  const [longMax, setLongMax] = React.useState("60");
  const [shortFee, setShortFee] = React.useState("0");
  const [midFee, setMidFee] = React.useState("0");
  const [longFee, setLongFee] = React.useState("0");
  const [overageRate, setOverageRate] = React.useState("0");
  const [shortBuffer, setShortBuffer] = React.useState("15");
  const [midBuffer, setMidBuffer] = React.useState("30");
  const [longBuffer, setLongBuffer] = React.useState("45");
  const [travelActive, setTravelActive] = React.useState(true);

  React.useEffect(() => {
    if (isEditing) return;
    if (businessInfo) {
      setBusinessName(businessInfo.name ?? "");
      setOwner(businessInfo.owner ?? "");
      setAddress(businessInfo.address ?? "");
      setCityStateZip(businessInfo.cityStateZip ?? "");
      setCountry(businessInfo.country ?? "US");
    }
    if (depositSettings) {
      setDepositAmount(String(depositSettings.amountPerVehicle ?? 50));
    }
    if (petFeeSettings) {
      setPetSmall(String(petFeeSettings.basePriceSmall ?? 40));
      setPetMedium(String(petFeeSettings.basePriceMedium ?? 50));
      setPetLarge(String(petFeeSettings.basePriceLarge ?? 60));
      setPetTime(String(petFeeSettings.timeAddMinutes ?? 30));
      setPetActive(petFeeSettings.isActive ?? true);
    }
    if (travelFeeSettings) {
      setOriginStreet(travelFeeSettings.originStreet ?? "");
      setOriginCity(travelFeeSettings.originCity ?? "Little Rock");
      setOriginState(travelFeeSettings.originState ?? "AR");
      setOriginZip(travelFeeSettings.originZip ?? "72201");
      setFreeRadius(String(travelFeeSettings.freeRadiusMiles ?? 20));
      setShortMax(String(travelFeeSettings.shortRangeMaxMiles ?? 30));
      setMidMax(String(travelFeeSettings.midRangeMaxMiles ?? 45));
      setLongMax(String(travelFeeSettings.longRangeMaxMiles ?? 60));
      setShortFee(String(travelFeeSettings.shortRangeFee ?? 0));
      setMidFee(String(travelFeeSettings.midRangeFee ?? 0));
      setLongFee(String(travelFeeSettings.longRangeFee ?? 0));
      setOverageRate(
        String(travelFeeSettings.perMileRateAfterLongRange ?? 0),
      );
      setShortBuffer(
        String(travelFeeSettings.shortRangeBufferMinutes ?? 15),
      );
      setMidBuffer(String(travelFeeSettings.midRangeBufferMinutes ?? 30));
      setLongBuffer(
        String(travelFeeSettings.longRangeBufferMinutes ?? 45),
      );
      setTravelActive(travelFeeSettings.isActive ?? true);
    }
  }, [
    businessInfo,
    depositSettings,
    petFeeSettings,
    travelFeeSettings,
    isEditing,
  ]);

  React.useEffect(() => {
    if (!businessHours) return;
    setHours(
      DAYS.map((day) => {
        const existing = businessHours.find(
          (item) => item.dayOfWeek === day.dayOfWeek,
        );
        return {
          ...day,
          startTime: existing?.startTime ?? "08:00",
          endTime: existing?.endTime ?? "18:00",
          isActive: existing?.isActive ?? day.dayOfWeek !== 0,
        };
      }),
    );
  }, [businessHours]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateBusiness({
        id: businessInfo?._id,
        name: businessName.trim(),
        owner: owner.trim(),
        address: address.trim(),
        cityStateZip: cityStateZip.trim(),
        country: country.trim(),
      });
      await updateDeposit({
        amountPerVehicle: toNumber(depositAmount, 50),
      });
      await updatePetFees({
        basePriceSmall: toNumber(petSmall, 40),
        basePriceMedium: toNumber(petMedium, 50),
        basePriceLarge: toNumber(petLarge, 60),
        timeAddMinutes: toNumber(petTime, 30),
        isActive: petActive,
      });
      await setBusinessHours({
        schedule: hours.map((hour) => ({
          dayOfWeek: hour.dayOfWeek,
          startTime: hour.startTime,
          endTime: hour.endTime,
          isActive: hour.isActive,
        })),
      });

      try {
        await validateTravelOrigin({
          originStreet: originStreet.trim(),
          originCity: originCity.trim(),
          originState: originState.trim().toUpperCase(),
          originZip: originZip.trim(),
          freeRadiusMiles: toNumber(freeRadius, 20),
          shortRangeMaxMiles: toNumber(shortMax, 30),
          midRangeMaxMiles: toNumber(midMax, 45),
          longRangeMaxMiles: toNumber(longMax, 60),
          shortRangeFee: toNumber(shortFee, 0),
          midRangeFee: toNumber(midFee, 0),
          longRangeFee: toNumber(longFee, 0),
          perMileRateAfterLongRange: toNumber(overageRate, 0),
          shortRangeBufferMinutes: toNumber(shortBuffer, 15),
          midRangeBufferMinutes: toNumber(midBuffer, 30),
          longRangeBufferMinutes: toNumber(longBuffer, 45),
          isActive: travelActive,
        });
      } catch (travelError) {
        Alert.alert(
          "Travel settings not saved",
          travelError instanceof Error
            ? `Business, deposit, and pet fees were saved. Travel settings failed: ${travelError.message}`
            : "Business, deposit, and pet fees were saved, but travel settings could not be updated.",
        );
        setIsEditing(false);
        return;
      }

      setIsEditing(false);
      Alert.alert("Settings saved", "Your business settings are updated.");
    } catch (error) {
      Alert.alert(
        "Could not save settings",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
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
          variant={isEditing ? "outline" : "default"}
          size="sm"
          onPress={() => setIsEditing((value) => !value)}
          className="flex-row items-center gap-1.5"
        >
          {isEditing ? (
            <X size={14} color={THEME.light.foreground} />
          ) : (
            <Pencil size={14} color={THEME.light.primaryForeground} />
          )}
          <Text className={isEditing ? "font-semibold" : "font-bold text-primary-foreground"}>
            {isEditing ? "Cancel" : "Edit"}
          </Text>
        </Button>
      </View>

      <ScreenHeader
        eyebrow="Configuration"
        title="Business Settings"
        description="Manage your business profile, deposits, pet fees, and travel rules."
      />

      <Card className="border border-border">
        <CardHeader className="flex-row items-center gap-3 pb-2">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
            <MapPin size={18} color={THEME.light.accent} />
          </View>
          <View className="flex-1">
            <CardTitle className="text-base">
              {businessInfo?.name || "River City Mobile Detailing"}
            </CardTitle>
            <Text className="text-xs text-muted-foreground">
              {businessInfo?.cityStateZip || "Central Arkansas"}
            </Text>
          </View>
        </CardHeader>
        {isEditing ? (
          <CardContent className="gap-3 p-4">
            <Field
              label="Business name"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="River City Mobile Detailing"
            />
            <Field
              label="Owner"
              value={owner}
              onChangeText={setOwner}
              placeholder="Owner name"
            />
            <Field
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="Street address"
            />
            <View className="flex-row gap-2">
              <Field
                label="City, state ZIP"
                value={cityStateZip}
                onChangeText={setCityStateZip}
                placeholder="Little Rock, AR 72201"
              />
              <Field
                label="Country"
                value={country}
                onChangeText={setCountry}
                placeholder="US"
              />
            </View>
          </CardContent>
        ) : null}
      </Card>

      <Card className="border border-border">
        <CardContent className="gap-2.5 p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <CreditCard size={18} color={THEME.light.accent} />
              <Text className="font-bold text-sm">Online Booking Deposit</Text>
            </View>
            <Badge variant="accent" size="sm" label="Active" />
          </View>
          <Text className="text-xs text-muted-foreground">
            Collected per vehicle during online checkout to secure appointment
            slots.
          </Text>
          {isEditing ? (
            <Field
              label="Deposit per vehicle"
              value={depositAmount}
              onChangeText={setDepositAmount}
              keyboardType="decimal-pad"
            />
          ) : (
            <View className="flex-row items-center justify-between border-t border-border pt-2 mt-1">
              <Text className="text-xs text-muted-foreground">Deposit Rate</Text>
              <Text className="text-base font-extrabold text-accent">
                ${depositSettings?.amountPerVehicle ?? 50}.00 / vehicle
              </Text>
            </View>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardContent className="gap-2.5 p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Dog size={18} color={THEME.light.accent} />
              <Text className="font-bold text-sm">Pet Hair Extraction Fees</Text>
            </View>
            <Badge
              variant={petFeeSettings?.isActive ? "success" : "secondary"}
              size="sm"
              label={petFeeSettings?.isActive ? "Enabled" : "Disabled"}
            />
          </View>
          <Text className="text-xs text-muted-foreground">
            Applied per vehicle when pet hair extraction is selected.
          </Text>
          {isEditing ? (
            <View className="gap-3">
              <View className="flex-row gap-2">
                <Field
                  label="Small"
                  value={petSmall}
                  onChangeText={setPetSmall}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Standard"
                  value={petMedium}
                  onChangeText={setPetMedium}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Large"
                  value={petLarge}
                  onChangeText={setPetLarge}
                  keyboardType="decimal-pad"
                />
              </View>
              <View className="flex-row gap-2">
                <Field
                  label="Extra minutes"
                  value={petTime}
                  onChangeText={setPetTime}
                  keyboardType="number-pad"
                />
                <View className="flex-1 justify-end">
                  <Switch
                    label="Pet fees active"
                    value={petActive}
                    onValueChange={setPetActive}
                    containerClassName="p-3"
                  />
                </View>
              </View>
            </View>
          ) : (
            <View className="gap-1.5 border-t border-border pt-2 mt-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Small Vehicle Fee</Text>
                <Text className="text-xs font-bold">${petFeeSettings?.basePriceSmall ?? 40}.00</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Standard / Mid-Size Fee</Text>
                <Text className="text-xs font-bold">${petFeeSettings?.basePriceMedium ?? 50}.00</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Large SUV / Truck Fee</Text>
                <Text className="text-xs font-bold">${petFeeSettings?.basePriceLarge ?? 60}.00</Text>
              </View>
            </View>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardContent className="gap-2.5 p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Navigation size={18} color={THEME.light.accent} />
              <Text className="font-bold text-sm">Travel Fee Rules</Text>
            </View>
            <Badge
              variant={travelFeeSettings?.isActive ? "success" : "secondary"}
              size="sm"
              label={travelFeeSettings?.isActive ? "Enabled" : "Disabled"}
            />
          </View>
          {isEditing ? (
            <View className="gap-3">
              <Field
                label="Origin street"
                value={originStreet}
                onChangeText={setOriginStreet}
                placeholder="Origin address"
              />
              <View className="flex-row gap-2">
                <Field label="City" value={originCity} onChangeText={setOriginCity} />
                <Field label="State" value={originState} onChangeText={setOriginState} />
                <Field
                  label="ZIP"
                  value={originZip}
                  onChangeText={setOriginZip}
                  keyboardType="number-pad"
                />
              </View>
              <View className="flex-row gap-2">
                <Field
                  label="Free radius"
                  value={freeRadius}
                  onChangeText={setFreeRadius}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Tier 1 max"
                  value={shortMax}
                  onChangeText={setShortMax}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Tier 2 max"
                  value={midMax}
                  onChangeText={setMidMax}
                  keyboardType="decimal-pad"
                />
              </View>
              <View className="flex-row gap-2">
                <Field
                  label="Tier 3 max"
                  value={longMax}
                  onChangeText={setLongMax}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Overage / mile"
                  value={overageRate}
                  onChangeText={setOverageRate}
                  keyboardType="decimal-pad"
                />
              </View>
              <View className="flex-row gap-2">
                <Field
                  label="Tier 1 fee"
                  value={shortFee}
                  onChangeText={setShortFee}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Tier 2 fee"
                  value={midFee}
                  onChangeText={setMidFee}
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Tier 3 fee"
                  value={longFee}
                  onChangeText={setLongFee}
                  keyboardType="decimal-pad"
                />
              </View>
              <View className="flex-row gap-2">
                <Field
                  label="Tier 1 buffer"
                  value={shortBuffer}
                  onChangeText={setShortBuffer}
                  keyboardType="number-pad"
                />
                <Field
                  label="Tier 2 buffer"
                  value={midBuffer}
                  onChangeText={setMidBuffer}
                  keyboardType="number-pad"
                />
                <Field
                  label="Tier 3 buffer"
                  value={longBuffer}
                  onChangeText={setLongBuffer}
                  keyboardType="number-pad"
                />
              </View>
              <Switch
                label="Travel fees active"
                value={travelActive}
                onValueChange={setTravelActive}
              />
            </View>
          ) : (
            <View className="gap-1.5 border-t border-border pt-2 mt-1">
              <Text className="text-xs text-muted-foreground">
                {travelFeeSettings?.originStreet
                  ? `${travelFeeSettings.originStreet}, `
                  : ""}
                {travelFeeSettings?.originCity || "Little Rock"},{" "}
                {travelFeeSettings?.originState || "AR"}{" "}
                {travelFeeSettings?.originZip || "72201"}
              </Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Free radius</Text>
                <Text className="text-xs font-bold">
                  {travelFeeSettings?.freeRadiusMiles ?? 20} miles
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Tier fees</Text>
                <Text className="text-xs font-bold">
                  ${travelFeeSettings?.shortRangeFee ?? 0} / $
                  {travelFeeSettings?.midRangeFee ?? 0} / $
                  {travelFeeSettings?.longRangeFee ?? 0}
                </Text>
              </View>
            </View>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardContent className="gap-3 p-4">
          <View className="flex-row items-center gap-2">
            <Clock size={18} color={THEME.light.accent} />
            <Text className="font-bold text-sm">Business Hours</Text>
          </View>
          {isEditing ? (
            <View className="gap-2">
              {hours.map((hour) => (
                <View
                  key={hour.dayOfWeek}
                  className="flex-row items-center gap-2"
                >
                  <Text className="w-9 text-xs font-semibold">
                    {hour.label}
                  </Text>
                  <Host matchContents>
                    <ExpoSwitch
                      value={hour.isActive}
                      onValueChange={(value) =>
                        setHours((prev) =>
                          prev.map((item) =>
                            item.dayOfWeek === hour.dayOfWeek
                              ? { ...item, isActive: value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Host>
                  <Input
                    value={hour.startTime}
                    onChangeText={(value) =>
                      setHours((prev) =>
                        prev.map((item) =>
                          item.dayOfWeek === hour.dayOfWeek
                            ? { ...item, startTime: value }
                            : item,
                        ),
                      )
                    }
                    placeholder="08:00"
                    className="h-10 flex-1"
                  />
                  <Input
                    value={hour.endTime}
                    onChangeText={(value) =>
                      setHours((prev) =>
                        prev.map((item) =>
                          item.dayOfWeek === hour.dayOfWeek
                            ? { ...item, endTime: value }
                            : item,
                        ),
                      )
                    }
                    placeholder="18:00"
                    className="h-10 flex-1"
                  />
                </View>
              ))}
            </View>
          ) : (
            <View className="gap-1.5">
              {hours
                .filter((hour) => hour.isActive)
                .map((hour) => (
                  <View
                    key={hour.dayOfWeek}
                    className="flex-row items-center justify-between"
                  >
                    <Text className="text-xs text-muted-foreground">
                      {hour.label}
                    </Text>
                    <Text className="text-xs font-semibold">
                      {hour.startTime} – {hour.endTime}
                    </Text>
                  </View>
                ))}
            </View>
          )}
        </CardContent>
      </Card>

      {isEditing ? (
        <Button
          size="lg"
          onPress={handleSave}
          disabled={isSaving}
          className="w-full flex-row items-center justify-center gap-2"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={THEME.light.primaryForeground} />
          ) : (
            <Text className="font-bold text-primary-foreground">
              Save Settings
            </Text>
          )}
        </Button>
      ) : null}

      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Clock size={16} color={THEME.light.mutedForeground} />
        <Text className="flex-1 text-xs text-muted-foreground">
          Changes apply to new bookings immediately. Stripe products update in
          the background.
        </Text>
      </View>
    </Screen>
  );
}
