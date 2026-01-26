/**
 * TradeQuip Android - Charts Screen
 * Based on mockup: charts_revised.png
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';
import { Button } from '../../components/Button';

const timeframes = ['1M', '5M', '15M', '1H', '4H', 'D1', 'W1'];

interface ChartsScreenProps {
    navigation: any;
    route?: { params?: { symbol?: string } };
}

export const ChartsScreen: React.FC<ChartsScreenProps> = ({
    navigation,
    route,
}) => {
    const symbol = route?.params?.symbol || 'BTC/USD';
    const [activeTimeframe, setActiveTimeframe] = useState('1H');

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={styles.backButton}
                    >
                        <Icon name="chevron-left" size={28} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <View style={styles.headerCenter}>
                        <Text style={styles.headerTitle}>TradeQuip - {symbol}</Text>
                        <View style={styles.liveIndicator}>
                            <View style={styles.liveDot} />
                            <Text style={styles.liveText}>LIVE</Text>
                        </View>
                    </View>
                    <TouchableOpacity style={styles.menuButton}>
                        <Icon name="more-vertical" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Chart Title */}
                <View style={styles.chartHeader}>
                    <Text style={styles.chartTitle}>Charts</Text>
                </View>

                {/* OHLC Bar */}
                <View style={styles.ohlcBar}>
                    <View style={styles.ohlcItem}>
                        <Text style={styles.ohlcLabel}>O</Text>
                        <Text style={styles.ohlcValue}>2850.00</Text>
                    </View>
                    <View style={styles.ohlcItem}>
                        <Text style={styles.ohlcLabel}>H</Text>
                        <Text style={[styles.ohlcValue, styles.positive]}>2890.00</Text>
                    </View>
                    <View style={styles.ohlcItem}>
                        <Text style={styles.ohlcLabel}>L</Text>
                        <Text style={[styles.ohlcValue, styles.negative]}>2820.00</Text>
                    </View>
                    <View style={styles.ohlcItem}>
                        <Text style={styles.ohlcLabel}>C</Text>
                        <Text style={styles.ohlcValue}>2876.00</Text>
                    </View>
                </View>

                {/* Chart Placeholder */}
                <View style={styles.chartContainer}>
                    <View style={styles.chartPlaceholder}>
                        <Icon name="bar-chart-2" size={48} color={colors.textMuted} />
                        <Text style={styles.chartPlaceholderText}>
                            Candlestick Chart
                        </Text>
                        <Text style={styles.chartPlaceholderSubtext}>
                            (TradingView integration)
                        </Text>
                    </View>

                    {/* Price labels on right */}
                    <View style={styles.priceLabels}>
                        <Text style={styles.priceLabel}>3000</Text>
                        <Text style={styles.priceLabel}>2800</Text>
                        <Text style={styles.priceLabel}>2600</Text>
                        <Text style={styles.priceLabel}>2400</Text>
                        <Text style={styles.priceLabel}>2200</Text>
                    </View>

                    {/* Current Price Badge */}
                    <View style={styles.currentPriceBadge}>
                        <Text style={styles.currentPriceValue}>2876.00</Text>
                        <Text style={styles.currentPriceChange}>+217.92</Text>
                    </View>
                </View>

                {/* Timeframe Selector */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.timeframeContainer}
                >
                    {timeframes.map((tf) => (
                        <TouchableOpacity
                            key={tf}
                            style={[
                                styles.timeframeButton,
                                activeTimeframe === tf && styles.timeframeButtonActive,
                            ]}
                            onPress={() => setActiveTimeframe(tf)}
                        >
                            <Text
                                style={[
                                    styles.timeframeText,
                                    activeTimeframe === tf && styles.timeframeTextActive,
                                ]}
                            >
                                {tf}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                {/* Buy/Sell FABs */}
                <View style={styles.fabContainer}>
                    <Button
                        title="BUY"
                        variant="buy"
                        onPress={() => navigation.navigate('Trade', { symbol, side: 'buy' })}
                        style={styles.fab}
                    />
                    <Button
                        title="SELL"
                        variant="sell"
                        onPress={() => navigation.navigate('Trade', { symbol, side: 'sell' })}
                        style={styles.fab}
                    />
                </View>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    gradient: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.screenPadding,
        paddingVertical: spacing.sm,
    },
    backButton: {
        marginRight: spacing.sm,
    },
    headerCenter: {
        flex: 1,
    },
    headerTitle: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    liveIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    liveDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.success,
        marginRight: 4,
    },
    liveText: {
        ...typography.labelSmall,
        color: colors.success,
    },
    menuButton: {
        padding: spacing.xs,
    },
    chartHeader: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.sm,
    },
    chartTitle: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    ohlcBar: {
        flexDirection: 'row',
        paddingHorizontal: spacing.screenPadding,
        paddingVertical: spacing.xs,
        gap: spacing.lg,
    },
    ohlcItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    ohlcLabel: {
        ...typography.labelSmall,
        color: colors.textMuted,
    },
    ohlcValue: {
        ...typography.bodySmall,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    positive: {
        color: colors.success,
    },
    negative: {
        color: colors.error,
    },
    chartContainer: {
        flex: 1,
        marginHorizontal: spacing.screenPadding,
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadius,
        borderWidth: 1,
        borderColor: colors.border,
        position: 'relative',
        overflow: 'hidden',
    },
    chartPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chartPlaceholderText: {
        ...typography.body,
        color: colors.textMuted,
        marginTop: spacing.md,
    },
    chartPlaceholderSubtext: {
        ...typography.bodySmall,
        color: colors.textMuted,
    },
    priceLabels: {
        position: 'absolute',
        right: 8,
        top: 16,
        bottom: 16,
        justifyContent: 'space-between',
    },
    priceLabel: {
        ...typography.labelSmall,
        color: colors.textMuted,
    },
    currentPriceBadge: {
        position: 'absolute',
        right: 8,
        top: '40%',
        backgroundColor: colors.bgCardSolid,
        borderRadius: 4,
        padding: 4,
        borderWidth: 1,
        borderColor: colors.success,
    },
    currentPriceValue: {
        ...typography.bodySmall,
        fontWeight: '600',
        color: colors.success,
    },
    currentPriceChange: {
        ...typography.labelSmall,
        color: colors.success,
    },
    timeframeContainer: {
        paddingHorizontal: spacing.screenPadding,
        paddingVertical: spacing.md,
        gap: spacing.xs,
    },
    timeframeButton: {
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: 8,
        backgroundColor: colors.bgCard,
        borderWidth: 1,
        borderColor: colors.border,
        marginRight: spacing.xs,
    },
    timeframeButtonActive: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    timeframeText: {
        ...typography.buttonSmall,
        color: colors.textSecondary,
    },
    timeframeTextActive: {
        color: colors.bgPrimary,
    },
    fabContainer: {
        flexDirection: 'row',
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.md,
        gap: spacing.md,
    },
    fab: {
        flex: 1,
    },
});

export default ChartsScreen;
