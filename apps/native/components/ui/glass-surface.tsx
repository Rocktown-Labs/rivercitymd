import * as React from "react";
import {
  AccessibilityInfo,
  Platform,
  View,
  type ViewProps,
} from "react-native";
import { BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { useColorScheme } from "nativewind";

import { THEME } from "@/lib/theme";

type GlassSurfaceProps = ViewProps & {
  children: React.ReactNode;
  interactive?: boolean;
  glassEffectStyle?: "clear" | "regular";
  tintColor?: string;
  fallbackIntensity?: number;
};

export function GlassSurface({
  children,
  interactive = false,
  glassEffectStyle = "regular",
  tintColor,
  fallbackIntensity = 60,
  style,
  ...props
}: GlassSurfaceProps) {
  const { colorScheme } = useColorScheme();
  const [reduceTransparency, setReduceTransparency] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((enabled) => {
        if (active) setReduceTransparency(enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const canUseGlass =
    Platform.OS === "ios" &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable();

  if (reduceTransparency) {
    return (
      <View
        style={[
          {
            backgroundColor:
              (colorScheme ?? "light") === "dark"
                ? THEME.dark.card
                : THEME.light.card,
            borderWidth: 1,
            borderColor:
              (colorScheme ?? "light") === "dark"
                ? THEME.dark.border
                : THEME.light.border,
          },
          style,
        ]}
        {...props}
      >
        {children}
      </View>
    );
  }

  if (canUseGlass) {
    return (
      <GlassView
        glassEffectStyle={glassEffectStyle}
        isInteractive={interactive}
        tintColor={tintColor}
        style={style}
        {...props}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <BlurView
      tint="systemMaterial"
      intensity={fallbackIntensity}
      style={[{ overflow: "hidden" }, style]}
      {...props}
    >
      {children}
    </BlurView>
  );
}
