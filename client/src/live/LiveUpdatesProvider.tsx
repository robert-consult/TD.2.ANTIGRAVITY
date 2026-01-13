import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { getWsUrl } from "@/lib/wsUrl";

type LiveUpdateMessage = Record<string, any>;
type LiveUpdateListener = (message: LiveUpdateMessage) => void;

type LiveUpdatesClient = {
  isConnected: boolean;
  sendMessage: (message: LiveUpdateMessage) => boolean;
  subscribe: (listener: LiveUpdateListener) => () => void;
};

const LiveUpdatesContext = createContext<LiveUpdatesClient | null>(null);

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef(new Set<LiveUpdateListener>());
  const wsUrl = getWsUrl();

  const { isConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      if (!message || typeof message !== "object") return;
      for (const listener of listenersRef.current) {
        listener(message);
      }
    },
  });

  useEffect(() => {
    if (isConnected) {
      sendMessage({ type: "auth:hello" });
    }
  }, [isConnected, sendMessage]);

  const subscribe = useCallback((listener: LiveUpdateListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const client = useMemo<LiveUpdatesClient>(() => {
    return {
      isConnected,
      sendMessage,
      subscribe,
    };
  }, [isConnected, sendMessage, subscribe]);

  return <LiveUpdatesContext.Provider value={client}>{children}</LiveUpdatesContext.Provider>;
}

export function useLiveUpdates() {
  const ctx = useContext(LiveUpdatesContext);
  if (!ctx) {
    throw new Error("useLiveUpdates must be used within LiveUpdatesProvider");
  }
  return ctx;
}
