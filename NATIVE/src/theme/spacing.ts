/**
 * TradeQuip Android - Spacing & Layout
 */

export const spacing = {
    // Base spacing scale
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
    xxxl: 40,

    // Component-specific
    cardPadding: 16,
    cardRadius: 20,
    cardRadiusSmall: 14,
    buttonRadius: 14,
    inputRadius: 12,

    // Screen
    screenPadding: 16,
    headerHeight: 56,
    tabBarHeight: 64,

    // Safe areas (will be overridden by SafeAreaProvider)
    safeAreaTop: 0,
    safeAreaBottom: 0,
} as const;

export const shadows = {
    card: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.37,
        shadowRadius: 16,
        elevation: 8,
    },
    button: {
        shadowColor: '#00E5FF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 4,
    },
    buttonBuy: {
        shadowColor: '#00C853',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 4,
    },
    buttonSell: {
        shadowColor: '#D50000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 4,
    },
};

export type SpacingKey = keyof typeof spacing;
