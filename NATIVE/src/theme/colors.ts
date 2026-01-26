/**
 * TradeQuip Android - Color Tokens
 * Based on approved mockup designs
 */

export const colors = {
    // Background Colors (Deep Navy/Black - NO GREEN BACKGROUNDS)
    bgPrimary: '#050914',
    bgSecondary: '#0e1a35',
    bgCard: 'rgba(14, 26, 53, 0.85)',
    bgCardSolid: '#0e1a35',

    // Accent Colors (Cyan)
    accent: '#00E5FF',
    accentSecondary: '#2979FF',
    accentGlow: 'rgba(0, 229, 255, 0.3)',
    accentGradientStart: '#00E5FF',
    accentGradientEnd: '#2979FF',

    // Semantic Colors (Text/Icons ONLY - no backgrounds)
    success: '#00E676',
    successLight: 'rgba(0, 230, 118, 0.15)',
    error: '#FF5252',
    errorLight: 'rgba(255, 82, 82, 0.15)',
    warning: '#FFD740',

    // Buy/Sell
    buy: '#00C853',
    buyGradientStart: '#00C853',
    buyGradientEnd: '#00E676',
    sell: '#D50000',
    sellGradientStart: '#D50000',
    sellGradientEnd: '#FF5252',

    // Text Colors
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(176, 190, 197, 0.8)',
    textMuted: 'rgba(84, 110, 122, 0.6)',
    textDisabled: 'rgba(255, 255, 255, 0.3)',

    // Border Colors
    border: 'rgba(255, 255, 255, 0.1)',
    borderLight: 'rgba(255, 255, 255, 0.05)',
    borderAccent: 'rgba(0, 229, 255, 0.25)',

    // Glassmorphism
    glassBg: 'rgba(255, 255, 255, 0.05)',
    glassBorder: 'rgba(255, 255, 255, 0.1)',

    // Status Bar & Navigation
    statusBar: '#050914',
    tabBarBg: 'rgba(5, 9, 20, 0.95)',
    tabBarActive: '#00E5FF',
    tabBarInactive: 'rgba(255, 255, 255, 0.5)',

    // Podium (Leaderboard)
    gold: '#FFD700',
    silver: '#C0C0C0',
    bronze: '#CD7F32',
} as const;

export type ColorKey = keyof typeof colors;
