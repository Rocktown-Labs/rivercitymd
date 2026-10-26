import { api } from "@rivercitymd/backend/convex/_generated/api";
import { useUser } from "@clerk/expo";
import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { CalendarDays, CarFront, ChevronRight, Clock, MapPin, Plus, Star } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { BrandMark } from "@/components/brand-mark";
import { Screen, ScreenHeader } from "@/components/screen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import { THEME } from "@/lib/theme";

function formatAppointmentDate(date: string, time: string) {
  const value = new Date(`${date}T${time}`);
  if (Number.isNaN(value.getTime())) return `${date} · ${time}`;
  return value.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function OverviewScreen() {
  const { user } = useUser();
  const currentUser = useQuery(api.users.getCurrentUser);
  const appointments = useQuery(api.appointments.list, currentUser ? {} : "skip");
  const nextAppointment = appointments
    ?.filter(
      (appointment) =>
        appointment.status !== "cancelled" &&
        appointment.status !== "completed" &&
        new Date(`${appointment.scheduledDate}T${appointment.scheduledTime}`).getTime() >=
          Date.now(),
    )
    .sort((a, b) =>
      `${a.scheduledDate}T${a.scheduledTime}`.localeCompare(
        `${b.scheduledDate}T${b.scheduledTime}`,
      ),
    )[0];

  const displayName = currentUser?.name || user?.firstName || "there";

  return (
    <Screen>
      {/* Brand Header */}
      <GlassSurface style={{ borderRadius: 22, padding: 12 }}>
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-3">
            <BrandMark />
            <View className="gap-0.5">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">
                RiverCityMD
              </Text>
              <Text className="text-base font-semibold">Customer Portal</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Book a detail"
            onPress={() => router.push("/book")}
            className="flex-row items-center gap-1.5 rounded-full bg-accent px-3 py-2 active:opacity-80"
          >
            <Plus size={15} color="#fff" />
            <Text className="text-xs font-bold text-white">Book</Text>
          </Pressable>
        </View>
      </GlassSurface>

      <ScreenHeader
        eyebrow="Mobile Detailing Service"
        title={`Good morning, ${displayName.split(" ")[0]}.`}
        description="We bring showroom-level mobile car detailing straight to your driveway."
      />

      {/* Next Appointment Spotlight */}
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text variant="h3" className="text-xl font-bold">Next Appointment</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(tabs)/appointments")}
            className="rounded-full px-2 py-1 active:bg-secondary"
          >
            <Text className="text-sm font-semibold text-accent">View all</Text>
          </Pressable>
        </View>

        {nextAppointment ? (
          <View className="gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/appointments/${nextAppointment._id}`)}
              className="active:opacity-90"
            >
              <Card className="border border-border">
                <CardContent className="gap-4 py-5">
                  <View className="flex-row items-start justify-between gap-4">
                    <View className="flex-1 gap-1">
                      <Text className="text-lg font-bold">
                        {formatAppointmentDate(
                          nextAppointment.scheduledDate,
                          nextAppointment.scheduledTime,
                        )}
                      </Text>
                      <View className="flex-row items-center gap-2 mt-0.5">
                        <Clock size={14} color={THEME.light.mutedForeground} />
                        <Text className="text-sm text-muted-foreground">
                          {nextAppointment.scheduledTime} · {nextAppointment.duration} mins
                        </Text>
                      </View>
                    </View>
                    <Badge
                      variant={nextAppointment.status === "confirmed" ? "success" : "warning"}
                      size="default"
                      label={nextAppointment.status === "confirmed" ? "Confirmed" : "Pending"}
                    />
                  </View>

                  <View className="flex-row items-center justify-between border-t border-border pt-3">
                    <View className="flex-row items-center gap-2 flex-1 mr-2">
                      <MapPin size={16} color={THEME.light.mutedForeground} />
                      <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
                        {nextAppointment.location.street}, {nextAppointment.location.city}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={THEME.light.mutedForeground} />
                  </View>
                </CardContent>
              </Card>
            </Pressable>

            {/* Easy way to start a new booking request even if one is scheduled */}
            <Button
              variant="outline"
              size="lg"
              onPress={() => router.push("/book")}
              className="w-full flex-row items-center justify-center gap-2"
            >
              <Plus size={16} color={THEME.light.foreground} />
              <Text className="font-bold">Book Another Detail</Text>
            </Button>
          </View>
        ) : (
          <Card className="border-dashed">
            <CardContent className="gap-4 py-6 items-center justify-center text-center">
              <View className="items-center gap-1">
                <Text className="font-bold text-base text-center">Nothing on the calendar yet</Text>
                <Text className="text-sm text-muted-foreground text-center max-w-xs">
                  Your next mobile detailing session will appear here once booked.
                </Text>
              </View>
              <Button
                variant="default"
                size="lg"
                onPress={() => router.push("/book")}
                className="flex-row items-center justify-center gap-2 px-8 self-center"
              >
                <Plus size={18} color={THEME.light.primaryForeground} />
                <Text className="font-bold text-primary-foreground">Start a Booking</Text>
              </Button>
            </CardContent>
          </Card>
        )}
      </View>

      {/* Quick Access */}
      <View className="gap-3">
        <Text variant="h3" className="text-xl font-bold">Quick Access</Text>
        <View className="flex-row gap-3">
          <QuickAccess
            icon={<CalendarDays size={21} color={THEME.light.accent} />}
            label="Appointments"
            onPress={() => router.push("/(tabs)/appointments")}
          />
          <QuickAccess
            icon={<CarFront size={21} color={THEME.light.accent} />}
            label="My Garage"
            onPress={() => router.push("/(tabs)/vehicles")}
          />
          <QuickAccess
            icon={<Star size={21} color={THEME.light.accent} />}
            label="Reviews"
            onPress={() => router.push("/(tabs)/reviews")}
          />
        </View>
      </View>
    </Screen>
  );
}

function QuickAccess({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-24 flex-1 gap-2 rounded-2xl border border-border bg-card px-1.5 py-3.5 active:bg-secondary justify-center items-center"
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-accent/10">{icon}</View>
      <Text className="text-[11px] font-bold text-center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
