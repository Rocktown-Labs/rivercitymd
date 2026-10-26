import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { Star } from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { Screen, ScreenHeader } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Modal } from "@/components/ui/modal";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

type PendingReview = {
  _id: string;
  scheduledDate: string;
  scheduledTime: string;
  services?: Array<{ name: string }>;
  vehicles?: Array<{ year: number; make: string; model: string }>;
};

export default function ReviewsScreen() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const reviews = useQuery(
    api.reviews.getUserReviewsWithDetails,
    currentUser ? {} : "skip",
  );
  const pendingReviews = useQuery(
    api.reviews.getPendingReviews,
    currentUser ? {} : "skip",
  ) as PendingReview[] | undefined;
  const submitReview = useMutation(api.reviews.submit);

  const [selectedAppointment, setSelectedAppointment] =
    React.useState<PendingReview | null>(null);
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const openReview = (appointment: PendingReview) => {
    setSelectedAppointment(appointment);
    setRating(5);
    setComment("");
  };

  const closeReview = () => {
    if (isSubmitting) return;
    setSelectedAppointment(null);
  };

  const handleSubmitReview = async () => {
    if (!selectedAppointment) return;
    setIsSubmitting(true);
    try {
      await submitReview({
        appointmentId: selectedAppointment._id as any,
        rating,
        comment: comment.trim() || undefined,
        isPublic: true,
      });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      setSelectedAppointment(null);
      Alert.alert(
        "Thanks for the review",
        "Your feedback helps us keep improving.",
      );
    } catch (error) {
      Alert.alert(
        "Could not submit review",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingCount = pendingReviews?.length ?? 0;

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Your feedback"
        title="Reviews"
        description="Share how your detail went and revisit the feedback you have left."
      />

      {pendingCount > 0 ? (
        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Awaiting your review
          </Text>
          {pendingReviews?.map((appointment) => (
            <GlassSurface
              key={appointment._id}
              style={{ borderRadius: 20, padding: 16 }}
            >
              <View className="gap-2.5">
                <View className="gap-0.5">
                  <Text className="font-bold text-base">
                    {appointment.services
                      ?.map((service) => service.name)
                      .join(", ") || "Completed detail"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {appointment.vehicles
                      ?.map(
                        (vehicle) =>
                          `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                      )
                      .join(", ")}
                    {appointment.scheduledDate
                      ? ` · ${appointment.scheduledDate}`
                      : ""}
                  </Text>
                </View>
                <Button
                  size="sm"
                  onPress={() => openReview(appointment)}
                  className="self-start"
                >
                  <Text className="font-bold text-primary-foreground">
                    Write a review
                  </Text>
                </Button>
              </View>
            </GlassSurface>
          ))}
        </View>
      ) : null}

      <View className="gap-3">
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your reviews
        </Text>
        {reviews?.length ? (
          <View className="gap-3">
            {reviews.map((review) => (
              <Card key={review._id}>
                <CardContent className="gap-3 py-5">
                  <View className="flex-row items-center justify-between gap-4">
                    <View className="flex-row gap-1">
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          size={17}
                          fill={
                            index < review.rating
                              ? THEME.light.accent
                              : "transparent"
                          }
                          color={
                            index < review.rating
                              ? THEME.light.accent
                              : THEME.light.border
                          }
                        />
                      ))}
                    </View>
                    <Text className="text-xs text-muted-foreground">
                      {review.appointment.scheduledDate}
                    </Text>
                  </View>
                  {review.comment ? (
                    <Text className="text-base leading-6">
                      “{review.comment}”
                    </Text>
                  ) : (
                    <Text className="text-sm italic text-muted-foreground">
                      No written comment.
                    </Text>
                  )}
                </CardContent>
              </Card>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No reviews yet"
            description="After a completed detail, you can share how everything went."
          />
        )}
      </View>

      <Modal
        visible={Boolean(selectedAppointment)}
        onClose={closeReview}
        title="Write a review"
        description="How did your detail go?"
      >
        <View className="gap-4">
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rating
            </Text>
            <View className="flex-row gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
                  onPress={() => {
                    setRating(value);
                    void Haptics.selectionAsync();
                  }}
                  className="p-1 active:opacity-70"
                >
                  <Star
                    size={32}
                    fill={
                      value <= rating ? THEME.light.accent : "transparent"
                    }
                    color={
                      value <= rating
                        ? THEME.light.accent
                        : THEME.light.border
                    }
                  />
                </Pressable>
              ))}
            </View>
          </View>

          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your review
            </Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Tell us about your experience..."
              placeholderTextColor="#8C887B"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              className="min-h-32 rounded-xl border border-border bg-card p-3 text-base text-foreground"
            />
          </View>

          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={closeReview}
              disabled={isSubmitting}
            >
              <Text>Cancel</Text>
            </Button>
            <Button
              className="flex-1"
              onPress={handleSubmitReview}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="font-bold text-primary-foreground">
                  Submit Review
                </Text>
              )}
            </Button>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
