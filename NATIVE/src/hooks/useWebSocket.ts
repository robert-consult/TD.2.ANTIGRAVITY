/**
 * TradeQuip Native - WebSocket Hook
 * Wraps the WebSocket service for use in React components
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { wsService } from '../services/websocket';

interface UseWebSocketOptions {
    enabled?: boolean;
    onMessage?: (message: any) => void;
    subscribeQuotes?: boolean;
    subscribeTrades?: boolean;
}

interface UseWebSocketReturn {
    isConnected: boolean;
    send: (data: any) => boolean;
    subscribeQuotes: (symbols?: string[]) => void;
    unsubscribeQuotes: () => void;
    subscribeTrades: () => void;
    unsubscribeTrades: () => void;
}

export const useWebSocket = (options: UseWebSocketOptions = {}): UseWebSocketReturn => {
    const { enabled = true, onMessage, subscribeQuotes: autoSubscribeQuotes, subscribeTrades: autoSubscribeTrades } = options;
    const [isConnected, setIsConnected] = useState(wsService.isConnected());
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;

    // Handle connection state changes
    useEffect(() => {
        if (!enabled) {
            wsService.disable();
            return;
        }

        wsService.enable();

        const unsubConnect = wsService.onConnect(() => {
            setIsConnected(true);
            // Auto-subscribe if enabled
            if (autoSubscribeQuotes) wsService.subscribeQuotes();
            if (autoSubscribeTrades) wsService.subscribeTrades();
        });

        const unsubDisconnect = wsService.onDisconnect(() => {
            setIsConnected(false);
        });

        const unsubMessage = wsService.onMessage((message) => {
            onMessageRef.current?.(message);
        });

        return () => {
            unsubConnect();
            unsubDisconnect();
            unsubMessage();
        };
    }, [enabled, autoSubscribeQuotes, autoSubscribeTrades]);

    // Handle app state changes (background/foreground)
    useEffect(() => {
        const handleAppStateChange = (state: AppStateStatus) => {
            if (state === 'active' && enabled) {
                wsService.enable();
            } else if (state === 'background') {
                wsService.disable();
            }
        };

        const subscription = AppState.addEventListener('change', handleAppStateChange);
        return () => subscription?.remove();
    }, [enabled]);

    const send = useCallback((data: any) => wsService.send(data), []);
    const subscribeQuotes = useCallback((symbols?: string[]) => wsService.subscribeQuotes(symbols), []);
    const unsubscribeQuotes = useCallback(() => wsService.unsubscribeQuotes(), []);
    const subscribeTrades = useCallback(() => wsService.subscribeTrades(), []);
    const unsubscribeTrades = useCallback(() => wsService.unsubscribeTrades(), []);

    return {
        isConnected,
        send,
        subscribeQuotes,
        unsubscribeQuotes,
        subscribeTrades,
        unsubscribeTrades,
    };
};

export default useWebSocket;
