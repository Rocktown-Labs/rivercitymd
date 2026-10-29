import * as React from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useAction } from "convex/react";
import { CalendarClock, TriangleAlert } from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Screen, ScreenHeader } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { openBrowser } from "@/lib/browser";
import { THEME } from "@/lib/theme";

export default function BookingResumeScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const resumeCheckout = useAction(api.payments.resumeBookingDraftCheckout);
  const [status, setStatus] = React.useState<
    "loading" | "requires_new_time" | "error" | "opened"
  >("loading");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("This booking link is missing a resume token.");
      return;
    }

    let active = true;
    setStatus("loading");

    void resumeCheckout({ token, origin: Linking.createURL("") })
      .then(async (result) => {
        if (!active) return;
        if (result.status === "converted") {
          router.replace(`/booking/success?token=${encodeURIComponent(token)}`);
          return;
        }
        if (result.status === "requires_new_time") {
          setStatus("requires_new_time");
          return;
        }
        if (result.url) {
          await openBrowser(result.url);
          setStatus("opened");
          return;
        }
        setStatus("error");
        setError("We couldn't restart checkout for this booking.");
      })
      .catch((resumeError) => {
        if (!active) return;
        setStatus("error");
        setError(
          resumeError instanceof Error
            ? resumeError.message
            : "We couldn't restart checkout for this booking.",
        );
      });

    return () => {
      active = false;
    };
  }, [resumeCheckout, token]);

  const handleChooseNewTime = () => {
    router.replace("/book");
  };

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Booking"
        title="Resume your booking"
        description="We saved your details. Let's get you back to checkout."
      />

      {status === "loading" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-8">
            <ActivityIndicator size="small" color={THEME.light.accent} />
            <Text className="text-sm text-muted-foreground">
              Restarting your checkout...
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {status === "requires_new_time" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <CalendarClock size={34} color={THEME.light.accent} />
            <Text className="text-center text-sm text-muted-foreground">
              Your original time is no longer available. Your details are saved
              so you can choose a new slot.
            </Text>
            <Button onPress={handleChooseNewTime}>
              <Text className="font-bold text-primary-foreground">
                Choose a new time
              </Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {status === "opened" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <Text className="text-center text-sm text-muted-foreground">
              Checkout opened in your browser. If it did not, tap below.
            </Text>
            <Button
              variant="outline"
              onPress={() => {
                if (token) {
                  void resumeCheckout({
                    token,
                    origin: Linking.createURL(""),
                  }).then((result) => {
                    if (result.url) void openBrowser(result.url);
                  });
                }
              }}
            >
              <Text className="font-semibold">Open checkout again</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {status === "error" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <TriangleAlert size={34} color={THEME.light.destructive} />
            <Text className="text-center text-sm text-muted-foreground">
              {error ?? "This booking link is invalid or has expired."}
            </Text>
            <Button
              variant="outline"
              onPress={handleChooseNewTime}
            >
              <Text className="font-semibold">Start a new booking</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </Screen>
  );
}
