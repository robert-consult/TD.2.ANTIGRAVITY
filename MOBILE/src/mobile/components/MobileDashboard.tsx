/**
 * Mobile Dashboard Component
 * Mobile-optimized trading dashboard with portfolio overview
 */

import React, { useEffect } from "react";
import { useMobilePlatform, useNetworkStatus } from "../hooks/useMobilePlatform";
import { MobileBottomNavigation } from "./MobileNavigation";
import "../styles/mobile.css";

// Icon components
const TrendingUpIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
    </svg>
);

const TrendingDownIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
    </svg>
);

const ChevronRightIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const MenuIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
);

const SettingsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
);

export interface MobileDashboardProps {
    user?: {
        balance?: number;
        equity?: number;
        margin?: number;
        openPnL?: number;
        username?: string;
        avatar?: string;
    };
    positions?: Array<{
        symbol: string;
        pnl: number;
        direction: "long" | "short";
    }>;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onQuickTrade?: (symbol: string) => void;
    onOpenMenu?: () => void;
    onOpenSettings?: () => void;
}

export function MobileDashboard({
    user,
    positions = [],
    activeTab,
    setActiveTab,
    onQuickTrade,
    onOpenMenu,
    onOpenSettings,
}: MobileDashboardProps) {
    const { keyboardVisible, isConnected } = useMobilePlatform();
    const networkStatus = useNetworkStatus();

    // Calculate portfolio value and change
    const portfolioValue = user?.balance ?? 10450.0;
    const portfolioChange = user?.openPnL ?? 124.50;
    const portfolioChangePercent = ((portfolioChange / (portfolioValue - portfolioChange)) * 100).toFixed(1);
    const isPositive = portfolioChange >= 0;

    // Default positions for demo
    const displayPositions = positions.length > 0 ? positions : [
        { symbol: "USDJPY", pnl: 80.25, direction: "long" as const },
        { symbol: "EURUSD", pnl: -32.10, direction: "short" as const },
        { symbol: "GBPUSD", pnl: 76.35, direction: "long" as const },
    ];

    return (
        <div className={`mobile-app ${keyboardVisible ? "keyboard-visible" : ""}`}>
            {/* Offline indicator */}
            {!networkStatus.connected && (
                <div className="mobile-offline-banner">
                    You're offline. Trading features are unavailable.
                </div>
            )}

            {/* Header */}
            <header className="mobile-header">
                <button
                    onClick={onOpenMenu}
                    className="mobile-bottom-nav-item"
                    aria-label="Open menu"
                >
                    <MenuIcon />
                </button>

                <div className="mobile-header-title">
                    <span style={{ color: "#3b82f6" }}>Trade</span>Quip
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <div
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontSize: 14,
                            fontWeight: 600,
                        }}
                    >
                        {user?.username?.[0]?.toUpperCase() || "U"}
                    </div>
                    <button
                        onClick={onOpenSettings}
                        className="mobile-bottom-nav-item"
                        aria-label="Settings"
                    >
                        <SettingsIcon />
                    </button>
                </div>
            </header>

            {/* Main content */}
            <main className="mobile-content">
                {/* Portfolio Hero Card */}
                <div className="mobile-card-hero mobile-animate-in">
                    <div className="mobile-card-hero-label">Portfolio Value</div>
                    <div className="mobile-card-hero-value">
                        ${portfolioValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                    <div className={`mobile-card-hero-change ${isPositive ? "positive" : "negative"}`}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            {isPositive ? <TrendingUpIcon /> : <TrendingDownIcon />}
                            {isPositive ? "+" : ""}${Math.abs(portfolioChange).toFixed(2)} ({isPositive ? "+" : ""}{portfolioChangePercent}%)
                        </span>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="mobile-stats-grid" style={{ animationDelay: "0.1s" }}>
                    <div className="mobile-stat-card mobile-animate-in">
                        <div className="mobile-stat-label">Equity</div>
                        <div className="mobile-stat-value">${(user?.equity ?? 8200).toLocaleString()}</div>
                    </div>
                    <div className="mobile-stat-card mobile-animate-in" style={{ animationDelay: "0.15s" }}>
                        <div className="mobile-stat-label">Margin</div>
                        <div className="mobile-stat-value">${(user?.margin ?? 2250).toLocaleString()}</div>
                    </div>
                    <div className="mobile-stat-card mobile-animate-in" style={{ animationDelay: "0.2s" }}>
                        <div className="mobile-stat-label">Open P&L</div>
                        <div className="mobile-stat-value" style={{ color: isPositive ? "#22c55e" : "#ef4444" }}>
                            {isPositive ? "+" : ""}${user?.openPnL?.toFixed(0) ?? 124}
                        </div>
                    </div>
                    <div className="mobile-stat-card mobile-animate-in" style={{ animationDelay: "0.25s" }}>
                        <div className="mobile-stat-label">Positions</div>
                        <div className="mobile-stat-value">{displayPositions.length}</div>
                    </div>
                </div>

                {/* Quick Trade Button */}
                <button
                    className="mobile-btn-primary mobile-animate-in"
                    style={{ animationDelay: "0.3s", marginTop: 8, marginBottom: 16 }}
                    onClick={() => onQuickTrade?.("USDJPY")}
                >
                    Quick Trade: USDJPY
                    <ChevronRightIcon />
                </button>

                {/* Active Positions */}
                <div className="mobile-card mobile-animate-in" style={{ animationDelay: "0.35s" }}>
                    <div style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.7)",
                        marginBottom: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}>
                        Active Positions
                    </div>

                    {displayPositions.map((position, index) => (
                        <div
                            key={position.symbol}
                            className="mobile-list-item"
                            style={{
                                padding: "12px 0",
                                borderBottom: index < displayPositions.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <div
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: 8,
                                        background: "rgba(255,255,255,0.05)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: position.pnl >= 0 ? "#22c55e" : "#ef4444",
                                    }}
                                >
                                    {position.pnl >= 0 ? "▲" : "▼"}
                                </div>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 500, color: "white" }}>
                                        {position.symbol}
                                    </div>
                                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                                        {position.direction === "long" ? "Long" : "Short"}
                                    </div>
                                </div>
                            </div>
                            <div
                                style={{
                                    fontSize: 15,
                                    fontWeight: 600,
                                    color: position.pnl >= 0 ? "#22c55e" : "#ef4444",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                }}
                            >
                                {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
                                {position.pnl >= 0 ? <TrendingUpIcon /> : <TrendingDownIcon />}
                            </div>
                        </div>
                    ))}
                </div>
            </main>

            {/* Bottom Navigation */}
            <MobileBottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
        </div>
    );
}

export default MobileDashboard;
