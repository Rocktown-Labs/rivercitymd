import * as React from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import {
  CarFront,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Search,
} from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

export default function AdminCustomersScreen() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const isAdmin = currentUser?.role === "admin";
  const customers = useQuery(api.users.listWithStats, isAdmin ? {} : "skip");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCustomerId, setSelectedCustomerId] =
    React.useState<Id<"users"> | null>(null);
  const customerDetails = useQuery(
    api.users.getByIdWithDetails,
    selectedCustomerId ? { userId: selectedCustomerId } : "skip",
  );
  const updateUser = useMutation(api.users.update);
  const [notes, setNotes] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (!customerDetails?.user) return;
    setNotes(customerDetails.user.notes ?? "");
    setIsActive(customerDetails.user.status !== "inactive");
  }, [customerDetails?.user?._id, customerDetails?.user?.notes, customerDetails?.user?.status]);

  const filteredCustomers = (customers || []).filter((customer: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = customer.name?.toLowerCase().includes(q);
    const emailMatch = customer.email?.toLowerCase().includes(q);
    const phoneMatch = customer.phone?.toLowerCase().includes(q);
    return nameMatch || emailMatch || phoneMatch;
  });

  const handleSaveCustomer = async () => {
    if (!selectedCustomerId) return;
    setIsSaving(true);
    try {
      await updateUser({
        userId: selectedCustomerId,
        notes: notes.trim() || undefined,
        status: isActive ? "active" : "inactive",
      });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      Alert.alert("Customer updated", "The customer record has been saved.");
    } catch (error) {
      Alert.alert(
        "Could not update customer",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const user = customerDetails?.user;
  const appointments = customerDetails?.appointments ?? [];
  const invoices = customerDetails?.invoices ?? [];
  const vehicles = customerDetails?.vehicles ?? [];

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Clients"
        title="Customer Directory"
        description="Search customer profiles, service records, and saved garages."
      />

      <Input
        placeholder="Search customers by name, email, or phone"
        value={searchQuery}
        onChangeText={setSearchQuery}
        leftIcon={<Search size={18} color={THEME.light.mutedForeground} />}
      />

      {filteredCustomers.length ? (
        <View className="gap-3">
          {filteredCustomers.map((customer: any) => (
            <Card key={customer._id} className="border border-border">
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedCustomerId(customer._id)}
                className="p-4 gap-3 active:bg-secondary/30"
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 gap-0.5">
                    <Text className="font-bold text-base">
                      {customer.name || "Customer"}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {customer.email || "No email"}
                    </Text>
                  </View>
                  <Badge
                    variant="accent"
                    size="sm"
                    label={`${customer.timesServiced || 0} Service(s)`}
                  />
                </View>

                <View className="flex-row items-center justify-between border-t border-border pt-2.5">
                  <View className="flex-row items-center gap-1.5">
                    <Phone size={13} color={THEME.light.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">
                      {customer.phone || "No phone"}
                    </Text>
                  </View>
                  <Text className="font-extrabold text-sm text-foreground">
                    ${customer.totalSpent?.toFixed(2) || "0.00"} spent
                  </Text>
                </View>
              </Pressable>
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          title="No customers found"
          description="Customers who sign up or book a detailing service will appear here."
        />
      )}

      <Modal
        visible={Boolean(selectedCustomerId)}
        onClose={() => setSelectedCustomerId(null)}
        title={user?.name || "Customer Detail"}
        description={user?.email || "Account Info"}
      >
        {user ? (
          <ScrollView
            contentContainerStyle={{ gap: 16, paddingBottom: 12 }}
            style={{ maxHeight: 540 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-row gap-2">
              {user.phone ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => Linking.openURL(`tel:${user.phone}`)}
                    className="flex-1 flex-row items-center justify-center gap-1.5"
                  >
                    <Phone size={14} color={THEME.light.foreground} />
                    <Text className="text-xs font-semibold">Call</Text>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => Linking.openURL(`sms:${user.phone}`)}
                    className="flex-1 flex-row items-center justify-center gap-1.5"
                  >
                    <MessageSquare size={14} color={THEME.light.foreground} />
                    <Text className="text-xs font-semibold">Text</Text>
                  </Button>
                </>
              ) : null}
              {user.email ? (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => Linking.openURL(`mailto:${user.email}`)}
                  className="flex-1 flex-row items-center justify-center gap-1.5"
                >
                  <Mail size={14} color={THEME.light.foreground} />
                  <Text className="text-xs font-semibold">Email</Text>
                </Button>
              ) : null}
            </View>

            {user.address ? (
              <View className="rounded-2xl border border-border bg-secondary/50 p-4 gap-1">
                <View className="flex-row items-center gap-2">
                  <MapPin size={15} color={THEME.light.accent} />
                  <Text className="font-bold text-sm">Service Address</Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {user.address.street}, {user.address.city}, {user.address.state}{" "}
                  {user.address.zip}
                </Text>
              </View>
            ) : null}

            <View className="flex-row gap-3">
              <View className="flex-1 rounded-2xl border border-border bg-card p-3 items-center">
                <Text className="text-xs text-muted-foreground">Total Spent</Text>
                <Text className="text-lg font-bold text-accent">
                  ${(user.totalSpent ?? 0).toFixed(2)}
                </Text>
              </View>
              <View className="flex-1 rounded-2xl border border-border bg-card p-3 items-center">
                <Text className="text-xs text-muted-foreground">
                  Lifetime Visits
                </Text>
                <Text className="text-lg font-bold">
                  {user.timesServiced ?? 0}
                </Text>
              </View>
            </View>

            <View className="rounded-2xl border border-border bg-secondary/50 p-4 gap-2">
              <Text className="font-bold text-sm">Garage Vehicles</Text>
              {vehicles.length ? (
                vehicles.map((vehicle: any) => (
                  <View
                    key={vehicle._id}
                    className="flex-row items-center justify-between border-t border-border/50 pt-2 mt-1"
                  >
                    <View className="flex-row items-center gap-2">
                      <CarFront size={15} color={THEME.light.accent} />
                      <Text className="text-xs font-semibold">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </Text>
                    </View>
                    <Badge
                      variant="secondary"
                      size="sm"
                      label={vehicle.size || "Standard"}
                    />
                  </View>
                ))
              ) : (
                <Text className="text-xs text-muted-foreground">
                  No vehicles registered yet.
                </Text>
              )}
            </View>

            <View className="rounded-2xl border border-border bg-secondary/50 p-4 gap-2">
              <Text className="font-bold text-sm">
                Recent Appointments ({appointments.length})
              </Text>
              {appointments.length ? (
                appointments.slice(0, 4).map((appointment: any) => (
                  <View
                    key={appointment._id}
                    className="border-t border-border/50 pt-2 mt-1 gap-0.5"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold">
                        {appointment.scheduledDate} · {appointment.scheduledTime}
                      </Text>
                      <Badge
                        variant={
                          appointment.status === "completed"
                            ? "success"
                            : appointment.status === "cancelled"
                              ? "destructive"
                              : "warning"
                        }
                        size="sm"
                        label={appointment.status}
                      />
                    </View>
                    <Text className="text-xs text-muted-foreground">
                      {appointment.services
                        ?.map((service: any) => service.name)
                        .join(", ") || "No services listed"}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="text-xs text-muted-foreground">
                  No appointments yet.
                </Text>
              )}
            </View>

            <View className="rounded-2xl border border-border bg-secondary/50 p-4 gap-2">
              <Text className="font-bold text-sm">
                Invoices ({invoices.length})
              </Text>
              {invoices.length ? (
                invoices.slice(0, 4).map((invoice: any) => (
                  <View
                    key={invoice._id}
                    className="flex-row items-center justify-between border-t border-border/50 pt-2 mt-1"
                  >
                    <Text className="text-xs font-semibold">
                      #{invoice.invoiceNumber}
                    </Text>
                    <View className="flex-row items-center gap-2">
                      <Badge
                        variant={
                          invoice.status === "paid"
                            ? "success"
                            : invoice.status === "overdue"
                              ? "destructive"
                              : "warning"
                        }
                        size="sm"
                        label={invoice.status}
                      />
                      <Text className="text-xs font-bold">
                        ${(invoice.total ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text className="text-xs text-muted-foreground">
                  No invoices yet.
                </Text>
              )}
            </View>

            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Internal notes
              </Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Add a private note about this customer..."
                placeholderTextColor="#8C887B"
                multiline
                textAlignVertical="top"
                className="min-h-24 rounded-xl border border-border bg-card p-3 text-sm text-foreground"
              />
            </View>

            <Switch
              label="Active customer"
              description="Inactive customers stay in your records but are marked as inactive."
              value={isActive}
              onValueChange={setIsActive}
            />

            <Button
              onPress={handleSaveCustomer}
              disabled={isSaving}
              className="w-full flex-row items-center justify-center gap-2"
            >
              <Text className="font-bold text-primary-foreground">
                {isSaving ? "Saving..." : "Save Customer"}
              </Text>
            </Button>
          </ScrollView>
        ) : (
          <View className="items-center gap-2 py-8">
            <Text className="text-sm text-muted-foreground">
              Loading customer...
            </Text>
          </View>
        )}
      </Modal>
    </Screen>
  );
}
