import "@/global.css";

import { env } from "@rivercitymd/env/native";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexReactClient, useMutation, useQuery } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Stack, router, useSegments } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { PortalHost } from "@rn-primitives/portal";
import { useColorScheme } from "nativewind";
import * as React from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { api } from "@rivercitymd/backend/convex/_generated/api";
import { NAV_THEME, THEME } from "@/lib/theme";
import { BrandMark } from "@/components/brand-mark";
import { Text } from "@/components/ui/text";
import { AppViewProvider, useAppView } from "@/lib/app-view";
import { NetworkBanner, NetworkProvider } from "@/lib/network";
import { registerForPushNotificationsAsync } from "@/lib/push-notifications";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

const convex = new ConvexReactClient(env.EXPO_PUBLIC_CONVEX_URL, {
  unsavedChangesWarning: false,
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const resolvedColorScheme = colorScheme ?? "light";

  return (
    <ClerkProvider
      publishableKey={env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY}
      tokenCache={tokenCache}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider value={NAV_THEME[resolvedColorScheme]}>
          <AppViewProvider>
            <StatusBar style={resolvedColorScheme === "dark" ? "light" : "dark"} />
            <GestureHandlerRootView style={styles.root}>
              <NetworkProvider>
                <NetworkBanner />
                <AuthGuard>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="(admin)" options={{ headerShown: false }} />
                    <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
                    <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="book"
                      options={{ headerShown: false, presentation: "modal" }}
                    />
                    <Stack.Screen name="appointments/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="booking/success" options={{ headerShown: false }} />
                    <Stack.Screen name="booking/cancelled" options={{ headerShown: false }} />
                    <Stack.Screen name="booking/resume" options={{ headerShown: false }} />
                    <Stack.Screen name="booking/claim" options={{ headerShown: false }} />
                    <Stack.Screen name="vehicles/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="analytics" options={{ headerShown: false }} />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                </AuthGuard>
                <PortalHost />
              </NetworkProvider>
            </GestureHandlerRootView>
          </AppViewProvider>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const { viewMode, setViewMode } = useAppView();
  const segments = useSegments();
  const currentUser = useQuery(api.users.getCurrentUser, isSignedIn ? {} : "skip");
  const userRole = useQuery(api.auth.getUserRole, isSignedIn ? {} : "skip");
  const registerPushToken = useMutation(api.push.registerPushToken);

  React.useEffect(() => {
    if (isLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [isLoaded]);

  React.useEffect(() => {
    if (!isSignedIn) return;
    let active = true;
    void registerForPushNotificationsAsync()
      .then((token) => {
        if (!active || !token) return;
        return registerPushToken({
          token,
          platform:
            Platform.OS === "ios"
              ? "ios"
              : Platform.OS === "android"
                ? "android"
                : "web",
        });
      })
      .catch((error) => {
        console.warn("[push] registration failed", error);
      });
    return () => {
      active = false;
    };
  }, [isSignedIn, registerPushToken]);

  React.useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboardingGroup = segments[0] === "(onboarding)";
    const inAdminGroup = segments[0] === "(admin)";

    if (!isSignedIn) {
      if (viewMode !== "admin") setViewMode("admin");
      if (!inAuthGroup) {
        router.replace("/(auth)/sign-in");
      }
      return;
    }

    // User is signed in, wait for profile query
    if (currentUser === undefined) return;

    const isAdmin = currentUser?.role === "admin" || userRole?.type === "admin";
    const needsOnboarding =
      !isAdmin && (!currentUser?.address?.street || !currentUser?.phone);

    if (needsOnboarding) {
      if (!inOnboardingGroup) {
        router.replace("/(onboarding)");
      }
      return;
    }

    const isAtCustomerRoot =
      (segments as string[]).length === 0 ||
      segments[0] === "(tabs)" ||
      inAuthGroup;

    if (isAdmin && viewMode === "admin" && !inAdminGroup && isAtCustomerRoot) {
      router.replace("/(admin)");
      return;
    }

    if ((!isAdmin || viewMode === "customer") && inAdminGroup) {
      router.replace("/(tabs)");
      return;
    }

    if (inAuthGroup) {
      router.replace(isAdmin ? "/(admin)" : "/(tabs)");
    }
  }, [isLoaded, isSignedIn, currentUser, userRole, segments, viewMode, setViewMode]);

  if (!isLoaded || (isSignedIn && currentUser === undefined)) {
    return (
      <View className="flex-1 items-center justify-center bg-background gap-3">
        <BrandMark />
        <ActivityIndicator size="small" color={THEME.light.accent} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Loading RiverCityMD...
        </Text>
      </View>
    );
  }

  return <>{children}</>;
}
