import type { PropsWithChildren } from "react";
import { ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";

export function Screen({
  children,
  scrollRef,
}: PropsWithChildren<{
  scrollRef?: React.RefObject<ScrollView | null>;
}>) {
  return (
    <ScrollView
      ref={scrollRef as any}
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ gap: 24, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 140 }}
    >
      {children}
    </ScrollView>
  );
}

export function ScreenHeader({ eyebrow, title, description }: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <View className="gap-1">
      {eyebrow ? (
        <Text className="text-xs font-semibold uppercase tracking-[2px] text-accent">
          {eyebrow}
        </Text>
      ) : null}
      <Text variant="h1" className="text-left text-3xl">
        {title}
      </Text>
      {description ? (
        <Text className="text-base leading-6 text-muted-foreground">{description}</Text>
      ) : null}
    </View>
  );
}
