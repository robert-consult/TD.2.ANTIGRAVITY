/**
 * Mobile Profile Settings Component
 * Mobile-optimized settings with large touch targets and slide panels
 */

import React, { useState } from "react";
import { useMobilePlatform } from "../hooks/useMobilePlatform";
import { MobileBottomNavigation } from "./MobileNavigation";
import "../styles/mobile.css";

// Icon components
const ArrowLeftIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
    </svg>
);

const UserIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

const ShieldIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const BellIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
);

const GlobeIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);

const LockIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
);

const MonitorIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
);

const LogOutIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);

const AlertCircleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const ChevronRightIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const CheckCircleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
);

export interface MobileProfileSettingsProps {
    user?: {
        username?: string;
        email?: string;
        avatar?: string;
        isVerified?: boolean;
        mfaEnabled?: boolean;
    };
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onBack?: () => void;
    onNavigate?: (section: string) => void;
    onSignOut?: () => void;
    onDeactivate?: () => void;
}

interface SettingsItem {
    id: string;
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    badge?: React.ReactNode;
}

const settingsItems: SettingsItem[] = [
    { id: "account", icon: <UserIcon />, title: "Account Information", subtitle: "Personal details, email, phone" },
    { id: "security", icon: <ShieldIcon />, title: "Security & MFA", subtitle: "Password, two-factor auth" },
    { id: "notifications", icon: <BellIcon />, title: "Notifications", subtitle: "Push, email, alerts" },
    { id: "language", icon: <GlobeIcon />, title: "Language & Region", subtitle: "Timezone, locale" },
    { id: "privacy", icon: <LockIcon />, title: "Privacy & Data", subtitle: "Data export, deletion" },
    { id: "sessions", icon: <MonitorIcon />, title: "Active Sessions", subtitle: "Manage logged-in devices" },
];

export function MobileProfileSettings({
    user,
    activeTab,
    setActiveTab,
    onBack,
    onNavigate,
    onSignOut,
    onDeactivate,
}: MobileProfileSettingsProps) {
    const { triggerHaptic, keyboardVisible, isNative } = useMobilePlatform();

    const handleItemPress = async (itemId: string) => {
        if (isNative) {
            await triggerHaptic("light");
        }
        onNavigate?.(itemId);
    };

    const handleSignOut = async () => {
        if (isNative) {
            await triggerHaptic("medium");
        }
        onSignOut?.();
    };

    return (
        <div className={`mobile-app ${keyboardVisible ? "keyboard-visible" : ""}`}>
            {/* Header */}
            <header className="mobile-header">
                <button
                    onClick={onBack}
                    className="mobile-bottom-nav-item"
                    aria-label="Go back"
                >
                    <ArrowLeftIcon />
                </button>

                <div className="mobile-header-title">Profile Settings</div>

                <div style={{ width: 48 }} /> {/* Spacer for alignment */}
            </header>

            {/* Main content */}
            <main className="mobile-content">
                {/* Profile Header */}
                <div className="mobile-profile-header mobile-animate-in">
                    <div className="mobile-profile-avatar">
                        {user?.avatar ? (
                            <img src={user.avatar} alt={user.username || "User"} />
                        ) : (
                            <div
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "white",
                                    fontSize: 28,
                                    fontWeight: 600,
                                }}
                            >
                                {user?.username?.[0]?.toUpperCase() || "U"}
                            </div>
                        )}
                    </div>

                    <div className="mobile-profile-name">
                        {user?.username || "John Doe"}
                        {user?.isVerified !== false && (
                            <span className="mobile-verified-badge">
                                <CheckCircleIcon />
                                Verified
                            </span>
                        )}
                    </div>

                    <div className="mobile-profile-email">
                        {user?.email || "demo@tradequip.com"}
                    </div>
                </div>

                {/* Settings List */}
                <div className="mobile-list mobile-animate-in" style={{ animationDelay: "0.1s" }}>
                    {settingsItems.map((item, index) => (
                        <button
                            key={item.id}
                            className="mobile-list-item"
                            onClick={() => handleItemPress(item.id)}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                            }}
                        >
                            <div className="mobile-list-item-icon">
                                {item.icon}
                            </div>
                            <div className="mobile-list-item-content">
                                <div className="mobile-list-item-title">{item.title}</div>
                                {item.subtitle && (
                                    <div className="mobile-list-item-subtitle">{item.subtitle}</div>
                                )}
                            </div>
                            <div className="mobile-list-item-chevron">
                                <ChevronRightIcon />
                            </div>
                        </button>
                    ))}
                </div>

                {/* Danger Zone */}
                <div className="mobile-animate-in" style={{ marginTop: 24, animationDelay: "0.2s" }}>
                    <button
                        onClick={handleSignOut}
                        style={{
                            width: "100%",
                            padding: "16px",
                            background: "transparent",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: 12,
                            color: "white",
                            fontSize: 15,
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            cursor: "pointer",
                            marginBottom: 12,
                        }}
                    >
                        <LogOutIcon />
                        Sign Out
                    </button>

                    <button
                        onClick={onDeactivate}
                        style={{
                            width: "100%",
                            padding: "16px",
                            background: "transparent",
                            border: "none",
                            color: "#ef4444",
                            fontSize: 14,
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            cursor: "pointer",
                        }}
                    >
                        <AlertCircleIcon />
                        Deactivate Account
                    </button>
                </div>
            </main>

            {/* Bottom Navigation */}
            <MobileBottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
        </div>
    );
}

export default MobileProfileSettings;
