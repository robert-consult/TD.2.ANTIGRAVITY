import { useState, useEffect, useCallback, useRef } from "react";
import { computeWsReconnectDelayMs } from "@/lib/perfHints";

interface UseWebSocketOptions {
  enabled?: boolean;
  onMessage?: (data: any) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  reconnectAttempts?: number;
  debug?: boolean;
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Event | null>(null);
  const enabledRef = useRef(true);
  const reconnectIntervalRef = useRef(3000);
  const reconnectAttemptsLimitRef = useRef(10);
  const urlRef = useRef(url);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onMessageRef = useRef<UseWebSocketOptions["onMessage"]>(undefined);
  const onOpenRef = useRef<UseWebSocketOptions["onOpen"]>(undefined);
  const onCloseRef = useRef<UseWebSocketOptions["onClose"]>(undefined);
  const onErrorRef = useRef<UseWebSocketOptions["onError"]>(undefined);
  
  const {
    enabled = true,
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnectInterval = 3000,
    reconnectAttempts = 10,
    debug = false,
  } = options;

  const isDev = Boolean((import.meta as any)?.env?.DEV);
  const shouldLog = debug || isDev;

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    reconnectIntervalRef.current = reconnectInterval;
  }, [reconnectInterval]);

  useEffect(() => {
    reconnectAttemptsLimitRef.current = reconnectAttempts;
  }, [reconnectAttempts]);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);
  
  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    clearReconnectTimer();
    const targetUrl = urlRef.current;
    if (shouldLog) {
      console.log(`Connecting to WebSocket at: "${targetUrl}"`);
    }
    const ws = new WebSocket(targetUrl);
    socketRef.current = ws;
    
    ws.onopen = () => {
      if (shouldLog) {
        console.log("WebSocket connected successfully");
      }
      setIsConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
      
      onOpenRef.current?.();
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(data);
      } catch (parseError) {
        if (shouldLog) {
          console.error("WebSocket message parse error:", parseError, event.data);
        }
      }
    };
    
    ws.onclose = (event) => {
      if (shouldLog) {
        console.log(`WebSocket disconnected:`, event.code, event.reason);
      }
      setIsConnected(false);
      
      onCloseRef.current?.();
      
      if (!enabledRef.current) return;

      const attemptsSoFar = reconnectAttemptsRef.current;
      const reconnectLimit = reconnectAttemptsLimitRef.current;
      if (attemptsSoFar >= reconnectLimit) return;

      reconnectAttemptsRef.current = attemptsSoFar + 1;
      const reconnectBaseDelay = reconnectIntervalRef.current;
      const nextAttemptDelay = computeWsReconnectDelayMs(attemptsSoFar, reconnectBaseDelay);
      if (shouldLog) {
        console.log(`Will attempt to reconnect in ${nextAttemptDelay}ms`);
      }

      reconnectTimerRef.current = setTimeout(() => {
        if (!enabledRef.current) return;
        connect();
      }, nextAttemptDelay);
    };
    
    ws.onerror = (event) => {
      if (shouldLog) {
        console.error("WebSocket error:", event);
      }
      setError(event);
      
      onErrorRef.current?.(event);
    };
  }, [clearReconnectTimer, shouldLog]);
  
  // Connect on mount
  useEffect(() => {
    if (!enabled) {
      enabledRef.current = false;
      clearReconnectTimer();
      reconnectAttemptsRef.current = 0;
      setIsConnected(false);
      setError(null);
      if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
        socketRef.current.close();
      }
      socketRef.current = null;
      return;
    }

    enabledRef.current = true;
    connect();

    return () => {
      enabledRef.current = false;
      clearReconnectTimer();
      if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
        socketRef.current.close();
      }
      socketRef.current = null;
    };
  }, [clearReconnectTimer, connect, enabled, url]);
  
  // Send message
  const sendMessage = useCallback((data: any) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);
  
  return {
    isConnected,
    sendMessage,
    error
  };
}
