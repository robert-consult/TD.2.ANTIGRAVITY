/**
 * TradeQuip Android - WebSocket Service
 * Aligned with webapp use-websocket.tsx for live updates
 */

import { Platform } from 'react-native';
import {
    WS_MSG_ACCOUNT_SUBSCRIBE,
    WS_MSG_ACCOUNT_UNSUBSCRIBE,
    WS_MSG_AUTH_HELLO,
    WS_MSG_QUOTES_SUBSCRIBE,
    WS_MSG_QUOTES_UNSUBSCRIBE,
    WS_MSG_TRADES_SUBSCRIBE,
    WS_MSG_TRADES_UNSUBSCRIBE,
    resolveWsUrl,
} from '@shared/ws/protocol';

type MessageHandler = (message: any) => void;
type ConnectionHandler = () => void;

interface WebSocketServiceConfig {
    baseUrl: string;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

class WebSocketService {
    private ws: WebSocket | null = null;
    private url: string;
    private reconnectInterval: number;
    private maxReconnectAttempts: number;
    private reconnectAttempts: number = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private messageHandlers: Set<MessageHandler> = new Set();
    private onConnectHandlers: Set<ConnectionHandler> = new Set();
    private onDisconnectHandlers: Set<ConnectionHandler> = new Set();
    private enabled: boolean = false;

    constructor(config: WebSocketServiceConfig) {
        this.url = config.baseUrl;
        this.reconnectInterval = config.reconnectInterval || 3000;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
    }

    /**
     * Compute reconnect delay with exponential backoff
     */
    private computeReconnectDelay(): number {
        const baseDelay = this.reconnectInterval;
        const attempt = this.reconnectAttempts;
        // Exponential backoff: base * 2^attempt, capped at 30 seconds
        const delay = Math.min(baseDelay * Math.pow(2, attempt), 30000);
        // Add jitter (0-1000ms)
        return delay + Math.random() * 1000;
    }

    /**
     * Connect to WebSocket
     */
    connect(): void {
        if (!this.enabled) return;
        this.clearReconnectTimer();

        const wsUrl = this.url;
        console.log('[WS] Connecting to:', wsUrl);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[WS] Connected');
                this.reconnectAttempts = 0;
                this.onConnectHandlers.forEach((handler) => handler());
                // Optional handshake for scope discovery (safe even when unauthenticated)
                this.send({ type: WS_MSG_AUTH_HELLO });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.messageHandlers.forEach((handler) => handler(data));
                } catch (error) {
                    console.warn('[WS] Message parse error:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('[WS] Disconnected:', event.code, event.reason);
                this.onDisconnectHandlers.forEach((handler) => handler());
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('[WS] Error:', error);
            };
        } catch (error) {
            console.error('[WS] Connection error:', error);
            this.scheduleReconnect();
        }
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (!this.enabled) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[WS] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.computeReconnectDelay();
        console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            if (this.enabled) {
                this.connect();
            }
        }, delay);
    }

    /**
     * Clear reconnect timer
     */
    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Enable WebSocket connection
     */
    enable(): void {
        this.enabled = true;
        this.connect();
    }

    /**
     * Disable WebSocket connection
     */
    disable(): void {
        this.enabled = false;
        this.clearReconnectTimer();
        this.reconnectAttempts = 0;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Send message
     */
    send(data: any): boolean {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }

    /**
     * Subscribe to messages
     */
    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.add(handler);
        return () => {
            this.messageHandlers.delete(handler);
        };
    }

    /**
     * Subscribe to connection events
     */
    onConnect(handler: ConnectionHandler): () => void {
        this.onConnectHandlers.add(handler);
        return () => {
            this.onConnectHandlers.delete(handler);
        };
    }

    /**
     * Subscribe to disconnection events
     */
    onDisconnect(handler: ConnectionHandler): () => void {
        this.onDisconnectHandlers.add(handler);
        return () => {
            this.onDisconnectHandlers.delete(handler);
        };
    }

    /**
     * Subscribe to specific trade updates
     */
    subscribeTrades(): void {
        this.send({ type: WS_MSG_TRADES_SUBSCRIBE });
    }

    /**
     * Unsubscribe from trade updates
     */
    unsubscribeTrades(): void {
        this.send({ type: WS_MSG_TRADES_UNSUBSCRIBE });
    }

    /**
     * Subscribe to account summary updates (requires authenticated WS session)
     */
    subscribeAccount(): void {
        this.send({ type: WS_MSG_ACCOUNT_SUBSCRIBE });
    }

    /**
     * Unsubscribe from account updates
     */
    unsubscribeAccount(): void {
        this.send({ type: WS_MSG_ACCOUNT_UNSUBSCRIBE });
    }

    /**
     * Subscribe to quote updates
     */
    subscribeQuotes(symbols?: string[]): void {
        this.send({ type: WS_MSG_QUOTES_SUBSCRIBE, symbols });
    }

    /**
     * Unsubscribe from quote updates
     */
    unsubscribeQuotes(): void {
        this.send({ type: WS_MSG_QUOTES_UNSUBSCRIBE });
    }
}

// Create singleton instance
const DEV_WS_BASE_URL =
    Platform.OS === 'android'
        // Android emulator → host machine. For physical devices prefer `adb reverse tcp:5000 tcp:5000` and use localhost.
        ? 'ws://10.0.2.2:5000/ws'
        : 'ws://localhost:5000/ws';

const WS_BASE_URL = resolveWsUrl(__DEV__ ? DEV_WS_BASE_URL : 'https://your-production-domain.com');

export const wsService = new WebSocketService({
    baseUrl: WS_BASE_URL,
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
});

export default wsService;
