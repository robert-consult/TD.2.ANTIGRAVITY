/**
 * Mobile Bottom Navigation Component
 * Optimized for touch with 48px+ tap targets and haptic feedback
 */

import React from "react";
import { useMobilePlatform } from "../hooks/useMobilePlatform";
import "../styles/mobile.css";

// Icon components (using Lucide-style paths)
const ChartIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
);

const LineChartIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
    </svg>
);

const DollarSignIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
);

const ClockIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
    </svg>
);

const UserIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

export interface MobileNavigationProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
}

interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
}

const navItems: NavItem[] = [
    { id: "quotes", label: "Quotes", icon: <ChartIcon /> },
    { id: "chart", label: "Chart", icon: <LineChartIcon /> },
    { id: "trade", label: "Trade", icon: <DollarSignIcon /> },
    { id: "history", label: "History", icon: <ClockIcon /> },
    { id: "account", label: "Account", icon: <UserIcon /> },
];

export function MobileBottomNavigation({ activeTab, setActiveTab }: MobileNavigationProps) {
    const { triggerHaptic, isNative } = useMobilePlatform();

    const handleTabPress = async (tabId: string) => {
        if (tabId !== activeTab) {
            if (isNative) {
                await triggerHaptic("light");
            }
            setActiveTab(tabId);
        }
    };

    return (
        <nav className="mobile-bottom-nav" role="navigation" aria-label="Main navigation">
            {navItems.map((item) => (
                <button
                    key={item.id}
                    className={`mobile-bottom-nav-item ${activeTab === item.id ? "active" : ""}`}
                    onClick={() => handleTabPress(item.id)}
                    aria-current={activeTab === item.id ? "page" : undefined}
                    aria-label={item.label}
                >
                    {item.icon}
                    <span>{item.label}</span>
                </button>
            ))}
        </nav>
    );
}

export default MobileBottomNavigation;
