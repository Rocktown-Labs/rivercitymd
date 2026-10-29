import * as React from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, TriangleAlert, UserRound } from "lucide-react-native";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { Screen, ScreenHeader } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

function mapRedirectPath(path: string) {
  if (path.includes("onboarding")) return "/(onboarding)" as const;
  if (path.includes("appointments")) return "/(tabs)/appointments" as const;
  return "/(tabs)" as const;
}

export default function BookingClaimScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { isLoaded, isSignedIn } = useAuth();
  const claimBooking = useMutation(api.bookingDrafts.claimConvertedDraft);
  const claimContext = useQuery(
    api.bookingDrafts.getPublicContext,
    token ? { token } : "skip",
  );
  const [status, setStatus] = React.useState<
    "idle" | "claiming" | "success" | "error"
  >("idle");
  const [error, setError] = React.useState<string | null>(null);
  const hasClaimed = React.useRef(false);

  React.useEffect(() => {
    if (
      !token ||
      !isLoaded ||
      !isSignedIn ||
      !claimContext ||
      status !== "idle" ||
      hasClaimed.current
    ) {
      return;
    }
    if (claimContext.status === "expired") {
      setStatus("error");
      setError(
        "This booking link has expired. Please contact us and we can send a fresh account link.",
      );
      return;
    }
    if (claimContext.status !== "converted") {
      return;
    }

    hasClaimed.current = true;
    setStatus("claiming");
    void claimBooking({ token })
      .then(({ redirectPath }) => {
        setStatus("success");
        router.replace(mapRedirectPath(redirectPath));
      })
      .catch((claimError) => {
        setStatus("error");
        setError(
          claimError instanceof Error
            ? claimError.message
            : "We couldn't attach this booking to your account.",
        );
      });
  }, [claimBooking, claimContext, isLoaded, isSignedIn, status, token]);

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Booking"
        title="Attach your booking"
        description="Sign in with the email used for this booking to see it in your account."
      />

      {!isLoaded ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-8">
            <ActivityIndicator size="small" color={THEME.light.accent} />
            <Text className="text-sm text-muted-foreground">
              Checking your account...
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {isLoaded && !isSignedIn ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <UserRound size={34} color={THEME.light.accent} />
            <Text className="text-center text-sm text-muted-foreground">
              Sign in or create an account with{" "}
              {claimContext?.email ?? "your booking email"} to attach this
              booking.
            </Text>
            <Button onPress={() => router.replace("/(auth)/sign-in")}>
              <Text className="font-bold text-primary-foreground">Sign in</Text>
            </Button>
            <Button
              variant="outline"
              onPress={() => router.replace("/(auth)/sign-up")}
            >
              <Text className="font-semibold">Create account</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isSignedIn && status === "claiming" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-8">
            <ActivityIndicator size="small" color={THEME.light.accent} />
            <Text className="text-sm text-muted-foreground">
              Attaching your booking...
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {isSignedIn && status === "success" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <CheckCircle2 size={34} color="#16a34a" />
            <Text className="text-center text-sm text-muted-foreground">
              Your booking is attached. Opening your appointments...
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {isSignedIn && status === "error" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <TriangleAlert size={34} color={THEME.light.destructive} />
            <Text className="text-center text-sm text-muted-foreground">
              {error ?? "We couldn't attach this booking."}
            </Text>
            <Button
              variant="outline"
              onPress={() => router.replace("/(tabs)/appointments")}
            >
              <Text className="font-semibold">View appointments</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isSignedIn &&
      claimContext &&
      claimContext.status !== "converted" &&
      claimContext.status !== "expired" &&
      status === "idle" ? (
        <Card className="border border-border">
          <CardContent className="items-center gap-3 p-6">
            <Text className="text-center text-sm text-muted-foreground">
              We&apos;re still finalizing this booking. Refresh in a moment and
              try again.
            </Text>
            <Button
              variant="outline"
              onPress={() => {
                hasClaimed.current = false;
                setStatus("idle");
              }}
            >
              <Text className="font-semibold">Try again</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </Screen>
  );
}
