/**
 * TradeQuip Native - WebSocket Service
 * Aligned with webapp use-websocket.tsx for live updates.
 */

import {
    WS_MSG_ACCOUNT_SUBSCRIBE,
    WS_MSG_ACCOUNT_UNSUBSCRIBE,
    WS_MSG_AUTH_HELLO,
    WS_MSG_QUOTES_SUBSCRIBE,
    WS_MSG_QUOTES_UNSUBSCRIBE,
    WS_MSG_TRADES_SUBSCRIBE,
    WS_MSG_TRADES_UNSUBSCRIBE,
} from '@shared/ws/protocol';
import { getWsBaseUrl } from './runtimeConfig';

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
    private connecting: boolean = false;
    private wantsTrades: boolean = false;
    private wantsAccount: boolean = false;
    private quoteSymbols: string[] | null = null;

    constructor(config: WebSocketServiceConfig) {
        this.url = config.baseUrl;
        this.reconnectInterval = config.reconnectInterval || 3000;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
    }

    private computeReconnectDelay(): number {
        const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts), 30000);
        return delay + Math.random() * 1000;
    }

    private replaySubscriptions(): void {
        if (this.wantsTrades) {
            this.send({ type: WS_MSG_TRADES_SUBSCRIBE });
        }
        if (this.wantsAccount) {
            this.send({ type: WS_MSG_ACCOUNT_SUBSCRIBE });
        }
        if (this.quoteSymbols) {
            this.send({
                type: WS_MSG_QUOTES_SUBSCRIBE,
                symbols: this.quoteSymbols.length > 0 ? this.quoteSymbols : undefined,
            });
        }
    }

    connect(): void {
        if (!this.enabled) return;
        if (this.connecting) return;
        if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
            return;
        }
        this.clearReconnectTimer();

        try {
            this.connecting = true;
            const socket = new WebSocket(this.url);
            this.ws = socket;

            socket.onopen = () => {
                if (this.ws !== socket) {
                    socket.close();
                    return;
                }
                this.connecting = false;
                this.reconnectAttempts = 0;
                this.send({ type: WS_MSG_AUTH_HELLO });
                this.replaySubscriptions();
                this.onConnectHandlers.forEach((handler) => handler());
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.messageHandlers.forEach((handler) => handler(data));
                } catch (error) {
                    console.warn('[WS] Message parse error:', error);
                }
            };

            socket.onclose = (event) => {
                if (this.ws === socket) {
                    this.ws = null;
                }
                this.connecting = false;
                console.log('[WS] Disconnected:', event.code, event.reason);
                this.onDisconnectHandlers.forEach((handler) => handler());
                this.scheduleReconnect();
            };

            socket.onerror = (error) => {
                console.error('[WS] Error:', error);
            };
        } catch (error) {
            this.connecting = false;
            console.error('[WS] Connection error:', error);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (!this.enabled) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[WS] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.computeReconnectDelay();
        this.reconnectTimer = setTimeout(() => {
            if (this.enabled) this.connect();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    enable(): void {
        if (this.enabled) {
            if (!this.isConnected()) {
                this.connect();
            }
            return;
        }
        this.enabled = true;
        this.connect();
    }

    disable(): void {
        this.enabled = false;
        this.clearReconnectTimer();
        this.reconnectAttempts = 0;
        this.connecting = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    send(data: any): boolean {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }

    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.add(handler);
        return () => {
            this.messageHandlers.delete(handler);
        };
    }

    onConnect(handler: ConnectionHandler): () => void {
        this.onConnectHandlers.add(handler);
        return () => {
            this.onConnectHandlers.delete(handler);
        };
    }

    onDisconnect(handler: ConnectionHandler): () => void {
        this.onDisconnectHandlers.add(handler);
        return () => {
            this.onDisconnectHandlers.delete(handler);
        };
    }

    subscribeTrades(): void {
        this.wantsTrades = true;
        this.send({ type: WS_MSG_TRADES_SUBSCRIBE });
    }

    unsubscribeTrades(): void {
        this.wantsTrades = false;
        this.send({ type: WS_MSG_TRADES_UNSUBSCRIBE });
    }

    subscribeAccount(): void {
        this.wantsAccount = true;
        this.send({ type: WS_MSG_ACCOUNT_SUBSCRIBE });
    }

    unsubscribeAccount(): void {
        this.wantsAccount = false;
        this.send({ type: WS_MSG_ACCOUNT_UNSUBSCRIBE });
    }

    subscribeQuotes(symbols?: string[]): void {
        this.quoteSymbols = Array.isArray(symbols)
            ? symbols
                .map((symbol) => String(symbol || '').trim().toUpperCase())
                .filter(Boolean)
            : [];
        this.send({
            type: WS_MSG_QUOTES_SUBSCRIBE,
            symbols: this.quoteSymbols.length > 0 ? this.quoteSymbols : undefined,
        });
    }

    unsubscribeQuotes(): void {
        this.quoteSymbols = null;
        this.send({ type: WS_MSG_QUOTES_UNSUBSCRIBE });
    }
}

export const wsService = new WebSocketService({
    baseUrl: getWsBaseUrl(),
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
});

export default wsService;
