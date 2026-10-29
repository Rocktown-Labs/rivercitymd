import * as React from "react";
import { useNetInfo } from "@react-native-community/netinfo";
import { View } from "react-native";
import { WifiOff } from "lucide-react-native";

import { Text } from "@/components/ui/text";

type NetworkContextValue = {
  isOnline: boolean;
};

const NetworkContext = React.createContext<NetworkContextValue>({
  isOnline: true,
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const netInfo = useNetInfo();
  const isOnline =
    netInfo.isConnected !== false && netInfo.isInternetReachable !== false;

  return (
    <NetworkContext.Provider value={{ isOnline }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetworkStatus() {
  return React.useContext(NetworkContext);
}

export function NetworkBanner() {
  const { isOnline } = useNetworkStatus();
  if (isOnline) return null;

  return (
    <View className="flex-row items-center justify-center gap-2 bg-amber-500 px-4 py-2">
      <WifiOff size={14} color="#fff" />
      <Text className="text-xs font-bold text-white">
        You&apos;re offline. Some actions may not work.
      </Text>
    </View>
  );
}
