/**
 * TradeQuip Android - Typography
 */

import { StyleSheet } from 'react-native';

export const typography = StyleSheet.create({
    // Headings
    h1: {
        fontSize: 42,
        fontWeight: '700',
        letterSpacing: -0.5,
        color: '#FFFFFF',
    },
    h2: {
        fontSize: 32,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: '#FFFFFF',
    },
    h3: {
        fontSize: 24,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    h4: {
        fontSize: 20,
        fontWeight: '600',
        color: '#FFFFFF',
    },

    // Body Text
    bodyLarge: {
        fontSize: 18,
        fontWeight: '400',
        lineHeight: 26,
        color: '#FFFFFF',
    },
    body: {
        fontSize: 16,
        fontWeight: '400',
        lineHeight: 24,
        color: '#FFFFFF',
    },
    bodySmall: {
        fontSize: 14,
        fontWeight: '400',
        lineHeight: 20,
        color: 'rgba(176, 190, 197, 0.8)',
    },

    // Labels
    label: {
        fontSize: 12,
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        color: 'rgba(176, 190, 197, 0.8)',
    },
    labelSmall: {
        fontSize: 10,
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: 'rgba(84, 110, 122, 0.6)',
    },

    // Numbers (for prices, values)
    price: {
        fontSize: 16,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        color: '#FFFFFF',
    },
    priceLarge: {
        fontSize: 24,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
        color: '#FFFFFF',
    },
    priceHero: {
        fontSize: 42,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
        letterSpacing: -0.5,
        color: '#FFFFFF',
    },

    // Button Text
    button: {
        fontSize: 16,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: '#FFFFFF',
    },
    buttonSmall: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFFFFF',
    },

    // Tab Bar
    tabLabel: {
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 0.2,
    },
});

export const fontFamilies = {
    regular: 'System',
    medium: 'System',
    semiBold: 'System',
    bold: 'System',
};
