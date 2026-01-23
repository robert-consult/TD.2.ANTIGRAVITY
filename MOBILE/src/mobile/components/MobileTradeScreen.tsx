/**
 * Mobile Trade Screen Component
 * Mobile-optimized trading interface with quick buy/sell actions
 */

import React, { useState } from "react";
import { useMobilePlatform } from "../hooks/useMobilePlatform";
import { MobileBottomNavigation } from "./MobileNavigation";
import "../styles/mobile.css";

// Icon components
const TrendingUpIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
    </svg>
);

const TrendingDownIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
    </svg>
);

const ChevronDownIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

const InfoIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

const ZapIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
);

export interface MobileTradeScreenProps {
    symbol: string;
    symbolName?: string;
    currentPrice?: number;
    bidPrice?: number;
    askPrice?: number;
    spread?: number;
    dailyChange?: number;
    dailyChangePercent?: number;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onExecuteTrade?: (trade: {
        symbol: string;
        side: "BUY" | "SELL";
        lots: number;
        orderType: string;
        takeProfit?: number;
        stopLoss?: number;
    }) => void;
}

const LOT_PRESETS = [1, 2, 5, 10, 20];

export function MobileTradeScreen({
    symbol,
    symbolName,
    currentPrice = 0,
    bidPrice,
    askPrice,
    spread = 0,
    dailyChange = 0,
    dailyChangePercent = 0,
    activeTab,
    setActiveTab,
    onExecuteTrade,
}: MobileTradeScreenProps) {
    const { triggerHaptic, keyboardVisible, isNative } = useMobilePlatform();

    const [lots, setLots] = useState(1);
    const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [takeProfit, setTakeProfit] = useState("");
    const [stopLoss, setStopLoss] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const displayBid = bidPrice ?? currentPrice;
    const displayAsk = askPrice ?? currentPrice;
    const isPositive = dailyChange >= 0;

    const handleLotsChange = async (newLots: number) => {
        if (isNative) await triggerHaptic("light");
        setLots(Math.max(1, Math.min(50, newLots)));
    };

    const handleTrade = async (side: "BUY" | "SELL") => {
        if (isNative) await triggerHaptic("medium");
        setIsSubmitting(true);

        try {
            await onExecuteTrade?.({
                symbol,
                side,
                lots,
                orderType,
                takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
                stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={`mobile-app ${keyboardVisible ? "keyboard-visible" : ""}`}>
            {/* Header */}
            <header className="mobile-header" style={{ justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                    <div className="mobile-header-title">{symbol}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                        {symbolName || "Currency Pair"}
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="mobile-content" style={{ paddingTop: 8 }}>

                {/* Price Display Card */}
                <div className="mobile-card" style={{
                    padding: 20,
                    marginBottom: 16,
                    background: "linear-gradient(135deg, rgba(17, 29, 46, 0.9), rgba(10, 22, 40, 0.95))",
                }}>
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 16,
                    }}>
                        <div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
                                CURRENT PRICE
                            </div>
                            <div style={{ fontSize: 32, fontWeight: 700, color: "white" }}>
                                {currentPrice.toFixed(symbol.includes("JPY") ? 3 : 5)}
                            </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    color: isPositive ? "#22c55e" : "#ef4444",
                                    fontSize: 14,
                                    fontWeight: 500,
                                }}
                            >
                                {isPositive ? <TrendingUpIcon /> : <TrendingDownIcon />}
                                {isPositive ? "+" : ""}{dailyChange.toFixed(4)}
                            </div>
                            <div style={{
                                fontSize: 12,
                                color: isPositive ? "#22c55e" : "#ef4444",
                                marginTop: 2,
                            }}>
                                ({isPositive ? "+" : ""}{dailyChangePercent.toFixed(2)}%)
                            </div>
                        </div>
                    </div>

                    {/* Spread indicator */}
                    <div style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: 8,
                        fontSize: 12,
                    }}>
                        <span style={{ color: "rgba(255,255,255,0.5)" }}>Spread:</span>
                        <span style={{ color: "white", fontWeight: 500 }}>{spread.toFixed(1)} pips</span>
                    </div>
                </div>

                {/* Lots Selection */}
                <div className="mobile-card" style={{ padding: 16, marginBottom: 16 }}>
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 12,
                    }}>
                        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                            Trade Size (Lots)
                        </span>
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                background: "transparent",
                                border: "none",
                                color: "#3b82f6",
                                fontSize: 12,
                                cursor: "pointer",
                            }}
                        >
                            Advanced <ChevronDownIcon />
                        </button>
                    </div>

                    {/* Lot presets */}
                    <div style={{
                        display: "flex",
                        gap: 8,
                        marginBottom: 12,
                        flexWrap: "wrap",
                    }}>
                        {LOT_PRESETS.map((preset) => (
                            <button
                                key={preset}
                                onClick={() => handleLotsChange(preset)}
                                style={{
                                    flex: 1,
                                    minWidth: 50,
                                    padding: "10px 0",
                                    background: lots === preset
                                        ? "linear-gradient(135deg, #3b82f6, #6366f1)"
                                        : "rgba(255,255,255,0.05)",
                                    border: "1px solid",
                                    borderColor: lots === preset ? "#3b82f6" : "rgba(255,255,255,0.1)",
                                    borderRadius: 8,
                                    color: "white",
                                    fontSize: 14,
                                    fontWeight: lots === preset ? 600 : 400,
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                {preset}
                            </button>
                        ))}
                    </div>

                    {/* Custom lots input */}
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: 8,
                        padding: "8px 12px",
                    }}>
                        <button
                            onClick={() => handleLotsChange(lots - 1)}
                            disabled={lots <= 1}
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.1)",
                                border: "none",
                                color: "white",
                                fontSize: 20,
                                cursor: lots <= 1 ? "not-allowed" : "pointer",
                                opacity: lots <= 1 ? 0.5 : 1,
                            }}
                        >
                            −
                        </button>
                        <input
                            type="number"
                            value={lots}
                            onChange={(e) => handleLotsChange(parseInt(e.target.value) || 1)}
                            style={{
                                flex: 1,
                                background: "transparent",
                                border: "none",
                                color: "white",
                                fontSize: 24,
                                fontWeight: 600,
                                textAlign: "center",
                                outline: "none",
                            }}
                        />
                        <button
                            onClick={() => handleLotsChange(lots + 1)}
                            disabled={lots >= 50}
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.1)",
                                border: "none",
                                color: "white",
                                fontSize: 20,
                                cursor: lots >= 50 ? "not-allowed" : "pointer",
                                opacity: lots >= 50 ? 0.5 : 1,
                            }}
                        >
                            +
                        </button>
                    </div>
                </div>

                {/* Advanced Options */}
                {showAdvanced && (
                    <div className="mobile-card mobile-animate-in" style={{ padding: 16, marginBottom: 16 }}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.5)",
                                display: "block",
                                marginBottom: 6,
                            }}>
                                Take Profit (optional)
                            </label>
                            <input
                                type="number"
                                placeholder="Enter price..."
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(e.target.value)}
                                style={{
                                    width: "100%",
                                    padding: "12px",
                                    background: "rgba(255,255,255,0.05)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: 8,
                                    color: "white",
                                    fontSize: 15,
                                    outline: "none",
                                }}
                            />
                        </div>
                        <div>
                            <label style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.5)",
                                display: "block",
                                marginBottom: 6,
                            }}>
                                Stop Loss (optional)
                            </label>
                            <input
                                type="number"
                                placeholder="Enter price..."
                                value={stopLoss}
                                onChange={(e) => setStopLoss(e.target.value)}
                                style={{
                                    width: "100%",
                                    padding: "12px",
                                    background: "rgba(255,255,255,0.05)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: 8,
                                    color: "white",
                                    fontSize: 15,
                                    outline: "none",
                                }}
                            />
                        </div>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginTop: 12,
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 11,
                        }}>
                            <InfoIcon />
                            <span>TP/SL will be attached to your position</span>
                        </div>
                    </div>
                )}

                {/* Buy/Sell Buttons */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 16,
                }}>
                    {/* SELL Button */}
                    <button
                        onClick={() => handleTrade("SELL")}
                        disabled={isSubmitting}
                        style={{
                            padding: "20px 16px",
                            background: "linear-gradient(135deg, #ef4444, #dc2626)",
                            border: "none",
                            borderRadius: 12,
                            color: "white",
                            cursor: isSubmitting ? "not-allowed" : "pointer",
                            opacity: isSubmitting ? 0.7 : 1,
                            boxShadow: "0 4px 20px rgba(239, 68, 68, 0.3)",
                        }}
                    >
                        <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>SELL</div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>
                            {displayBid.toFixed(symbol.includes("JPY") ? 3 : 5)}
                        </div>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            marginTop: 6,
                            fontSize: 12,
                        }}>
                            <TrendingDownIcon />
                            <span>{lots} lot{lots !== 1 ? "s" : ""}</span>
                        </div>
                    </button>

                    {/* BUY Button */}
                    <button
                        onClick={() => handleTrade("BUY")}
                        disabled={isSubmitting}
                        style={{
                            padding: "20px 16px",
                            background: "linear-gradient(135deg, #22c55e, #16a34a)",
                            border: "none",
                            borderRadius: 12,
                            color: "white",
                            cursor: isSubmitting ? "not-allowed" : "pointer",
                            opacity: isSubmitting ? 0.7 : 1,
                            boxShadow: "0 4px 20px rgba(34, 197, 94, 0.3)",
                        }}
                    >
                        <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>BUY</div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>
                            {displayAsk.toFixed(symbol.includes("JPY") ? 3 : 5)}
                        </div>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            marginTop: 6,
                            fontSize: 12,
                        }}>
                            <TrendingUpIcon />
                            <span>{lots} lot{lots !== 1 ? "s" : ""}</span>
                        </div>
                    </button>
                </div>

                {/* Quick Trade Tip */}
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "10px 16px",
                    background: "rgba(59, 130, 246, 0.1)",
                    borderRadius: 8,
                    color: "#3b82f6",
                    fontSize: 12,
                }}>
                    <ZapIcon />
                    <span>Market orders execute instantly at current price</span>
                </div>

            </main>

            {/* Bottom Navigation */}
            <MobileBottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
        </div>
    );
}

export default MobileTradeScreen;
