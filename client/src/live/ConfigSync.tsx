import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { useAuth } from "@/hooks/use-auth";

export function ConfigSync() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { subscribe } = useLiveUpdates();

  useEffect(() => {
    if (!isAuthenticated) return;

    return subscribe((message) => {
      if (!message || typeof message !== "object") return;

      if (message.type === "symbols:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/config/symbols"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/symbols"] });
        return;
      }

      if (message.type === "system-config:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config"] });
      }
    });
  }, [isAuthenticated, queryClient, subscribe]);

  return null;
}

