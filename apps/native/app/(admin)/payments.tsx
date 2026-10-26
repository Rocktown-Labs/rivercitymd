import * as React from "react";
import { Alert, Pressable, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  DollarSign,
  FileText,
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
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export default function AdminPaymentsScreen() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const isAdmin = currentUser?.role === "admin";
  const invoices = useQuery(
    api.invoices.listWithDetails,
    isAdmin ? {} : "skip",
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] =
    React.useState<Id<"invoices"> | null>(null);
  const selectedInvoice = useQuery(
    api.invoices.getByIdAdmin,
    selectedInvoiceId ? { invoiceId: selectedInvoiceId } : "skip",
  );
  const updateStatus = useMutation(api.invoices.updateStatus);
  const [isUpdating, setIsUpdating] = React.useState(false);

  const filtered = (invoices || []).filter((inv: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const invNum = inv.invoiceNumber?.toLowerCase().includes(q);
    const userMatch = inv.user?.name?.toLowerCase().includes(q);
    return invNum || userMatch;
  });

  const handleUpdateStatus = async (status: InvoiceStatus) => {
    if (!selectedInvoiceId) return;
    setIsUpdating(true);
    try {
      await updateStatus({ invoiceId: selectedInvoiceId, status });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setSelectedInvoiceId(null);
      Alert.alert("Invoice updated", `Marked as ${status}.`);
    } catch (error) {
      Alert.alert(
        "Could not update invoice",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const confirmPaid = () => {
    Alert.alert(
      "Mark invoice paid?",
      "This records the payment and updates the customer's service totals.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark Paid",
          onPress: () => void handleUpdateStatus("paid"),
        },
      ],
    );
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        className="flex-row items-center gap-1.5 self-start active:opacity-70"
      >
        <ArrowLeft size={18} color={THEME.light.foreground} />
        <Text className="text-sm font-semibold">More Menu</Text>
      </Pressable>

      <ScreenHeader
        eyebrow="Billing"
        title="Payments & Invoices"
        description="Track customer invoices, payment statuses, and collected deposits."
      />

      <Input
        placeholder="Search by invoice # or customer name"
        value={searchQuery}
        onChangeText={setSearchQuery}
        leftIcon={<Search size={18} color={THEME.light.mutedForeground} />}
      />

      {filtered.length ? (
        <View className="gap-3">
          {filtered.map((inv: any) => (
            <Pressable
              key={inv._id}
              accessibilityRole="button"
              accessibilityLabel={`Invoice ${inv.invoiceNumber}`}
              onPress={() => setSelectedInvoiceId(inv._id)}
              className="active:opacity-80"
            >
              <Card className="border border-border">
                <CardContent className="gap-3 p-4">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 gap-0.5">
                      <Text className="font-bold text-base">
                        #{inv.invoiceNumber}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {inv.user?.name || "Customer"}
                      </Text>
                    </View>
                    <Badge
                      variant={
                        inv.status === "paid"
                          ? "success"
                          : inv.status === "overdue"
                            ? "destructive"
                            : "warning"
                      }
                      size="sm"
                      label={inv.status}
                    />
                  </View>

                  <View className="flex-row items-center justify-between border-t border-border pt-2.5">
                    <Text className="text-xs text-muted-foreground">
                      Due {inv.dueDate}
                    </Text>
                    <Text className="font-extrabold text-base text-accent">
                      ${inv.total?.toFixed(2) || "0.00"}
                    </Text>
                  </View>
                </CardContent>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : (
        <EmptyState
          title="No invoices found"
          description="Invoices created for appointments will show up here."
        />
      )}

      <Modal
        visible={Boolean(selectedInvoiceId)}
        onClose={() => setSelectedInvoiceId(null)}
        title={
          selectedInvoice
            ? `Invoice #${selectedInvoice.invoiceNumber}`
            : "Invoice details"
        }
        description={
          selectedInvoice
            ? `${selectedInvoice.customer} · ${selectedInvoice.customerEmail}`
            : "Loading invoice..."
        }
      >
        {selectedInvoice ? (
          <View className="gap-4">
            <View className="flex-row items-center justify-between">
              <Badge
                variant={
                  selectedInvoice.status === "paid"
                    ? "success"
                    : selectedInvoice.status === "overdue"
                      ? "destructive"
                      : "warning"
                }
                size="sm"
                label={selectedInvoice.status}
              />
              <Text className="text-lg font-extrabold text-accent">
                ${selectedInvoice.total?.toFixed(2) || "0.00"}
              </Text>
            </View>

            <View className="gap-2 rounded-xl border border-border bg-secondary/40 p-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Due date</Text>
                <Text className="text-xs font-semibold">
                  {selectedInvoice.dueDate}
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Subtotal</Text>
                <Text className="text-xs font-semibold">
                  ${selectedInvoice.subtotal?.toFixed(2) || "0.00"}
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted-foreground">Tax</Text>
                <Text className="text-xs font-semibold">
                  ${selectedInvoice.tax?.toFixed(2) || "0.00"}
                </Text>
              </View>
              {selectedInvoice.depositAmount ? (
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs text-muted-foreground">Deposit</Text>
                  <Text className="text-xs font-semibold">
                    ${selectedInvoice.depositAmount.toFixed(2)}
                  </Text>
                </View>
              ) : null}
              {selectedInvoice.remainingBalance ? (
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs text-muted-foreground">
                    Remaining balance
                  </Text>
                  <Text className="text-xs font-semibold">
                    ${selectedInvoice.remainingBalance.toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </View>

            {selectedInvoice.appointment ? (
              <View className="gap-2 rounded-xl border border-border p-3">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Appointment
                </Text>
                <Text className="text-sm font-semibold">
                  {selectedInvoice.appointment.scheduledDate} ·{" "}
                  {selectedInvoice.appointment.scheduledTime}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {selectedInvoice.appointment.services
                    ?.map((service: any) => service.name)
                    .join(", ") || "No services listed"}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {selectedInvoice.appointment.vehicles
                    ?.map(
                      (vehicle: any) =>
                        `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                    )
                    .join(", ") || "No vehicles listed"}
                </Text>
              </View>
            ) : null}

            <View className="gap-2">
              {selectedInvoice.status !== "paid" ? (
                <Button
                  onPress={confirmPaid}
                  disabled={isUpdating}
                  className="w-full flex-row items-center justify-center gap-2"
                >
                  <CheckCircle2
                    size={16}
                    color={THEME.light.primaryForeground}
                  />
                  <Text className="font-bold text-primary-foreground">
                    Mark as Paid
                  </Text>
                </Button>
              ) : null}
              <View className="flex-row gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => void handleUpdateStatus("sent")}
                  disabled={isUpdating || selectedInvoice.status === "paid"}
                >
                  <Text className="text-xs font-semibold">Mark Sent</Text>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => void handleUpdateStatus("overdue")}
                  disabled={isUpdating || selectedInvoice.status === "paid"}
                >
                  <Text className="text-xs font-semibold">Mark Overdue</Text>
                </Button>
              </View>
            </View>
          </View>
        ) : (
          <View className="items-center gap-2 py-8">
            <FileText size={28} color={THEME.light.mutedForeground} />
            <Text className="text-sm text-muted-foreground">
              Loading invoice details...
            </Text>
          </View>
        )}
      </Modal>
    </Screen>
  );
}
