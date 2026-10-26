import { useQuery } from "convex/react";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { DynamicColorIOS, Platform } from "react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";

const tintColor =
  Platform.OS === "ios"
    ? DynamicColorIOS({ light: "#2a8fa8", dark: "#4db3c9" })
    : "#2a8fa8";

export default function TabsLayout() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const appointments = useQuery(
    api.appointments.list,
    currentUser ? {} : "skip",
  );
  const activeAppointmentCount = appointments?.filter(
    (appointment) =>
      appointment.status !== "cancelled" && appointment.status !== "completed",
  ).length;

  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={tintColor}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="rectangle.grid.2x2.fill" md="dashboard" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="appointments">
        <NativeTabs.Trigger.Label>Appointments</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="event" />
        {activeAppointmentCount ? (
          <NativeTabs.Trigger.Badge>
            {String(activeAppointmentCount)}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vehicles">
        <NativeTabs.Trigger.Label>Vehicles</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="car.fill" md="directions_car" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reviews">
        <NativeTabs.Trigger.Label>Reviews</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="star.fill" md="star" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
