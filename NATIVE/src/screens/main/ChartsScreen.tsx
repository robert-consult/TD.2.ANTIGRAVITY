/**
 * TradeQuip Android - Charts Screen
 * Lightweight live charting based on streaming quotes
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart, type TLineChartPoint } from 'react-native-wagmi-charts';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';
import { GlassCard } from '../../components/cards/GlassCard';
import { Button } from '../../components/Button';
import { SymbolSelect } from '../../components/SymbolSelect';
import { useQuotes } from '../../hooks/useQuotes';

type ChartPeriod = '1H' | '1D' | '1W' | '1M';

const PERIODS: { key: ChartPeriod; label: string; windowMs: number }[] = [
    { key: '1H', label: '1H', windowMs: 60 * 60 * 1000 },
    { key: '1D', label: '1D', windowMs: 24 * 60 * 60 * 1000 },
    { key: '1W', label: '1W', windowMs: 7 * 24 * 60 * 60 * 1000 },
    { key: '1M', label: '1M', windowMs: 30 * 24 * 60 * 60 * 1000 },
];

interface ChartsScreenProps {
    navigation: any;
    route?: { params?: { symbol?: string; symbolId?: number } };
}

const formatPrice = (symbol: string, value: number) => {
    const isJpy = String(symbol).toUpperCase().includes('JPY');
    const decimals = isJpy ? 2 : value < 10 ? 5 : value < 1000 ? 4 : 2;
    return value.toFixed(decimals);
};

export const ChartsScreen: React.FC<ChartsScreenProps> = ({ navigation, route }) => {
    const { symbols, getQuote, isLive, refetchQuotes } = useQuotes();

    const firstEnabledSymbol = symbols?.find((s) => s?.enabled !== false)?.symbol;
    const [selectedSymbol, setSelectedSymbol] = useState<string>(
        route?.params?.symbol || firstEnabledSymbol || 'USDJPY'
    );
    const [activePeriod, setActivePeriod] = useState<ChartPeriod>('1D');
    const [series, setSeries] = useState<TLineChartPoint[]>([]);

    // Keep selection in sync when navigating from Quotes/History, etc.
    useEffect(() => {
        const next = route?.params?.symbol;
        if (!next) return;
        if (next !== selectedSymbol) setSelectedSymbol(next);
    }, [route?.params?.symbol, selectedSymbol]);

    // If symbols load and our selection is unknown, fall back to first enabled.
    useEffect(() => {
        if (!symbols?.length) return;
        const exists = symbols.some((s) => String(s.symbol).toUpperCase() === String(selectedSymbol).toUpperCase());
        if (!exists && firstEnabledSymbol) setSelectedSymbol(firstEnabledSymbol);
    }, [firstEnabledSymbol, selectedSymbol, symbols]);

    const quote = getQuote(selectedSymbol);

    const chartWindowMs = useMemo(() => {
        return PERIODS.find((p) => p.key === activePeriod)?.windowMs ?? PERIODS[1].windowMs;
    }, [activePeriod]);

    const pushPoint = useCallback(
        (point: TLineChartPoint) => {
            setSeries((prev) => {
                const now = point.timestamp || Date.now();
                const cutoff = now - chartWindowMs;

                const trimmed = Array.isArray(prev) ? prev.filter((p) => p.timestamp >= cutoff) : [];
                const last = trimmed[trimmed.length - 1];

                let next: TLineChartPoint[];
                if (last && last.timestamp === point.timestamp) {
                    next = [...trimmed.slice(0, -1), point];
                } else {
                    next = [...trimmed, point];
                }

                // Guardrail against runaway growth on high-frequency updates.
                if (next.length > 800) next = next.slice(next.length - 800);
                return next;
            });
        },
        [chartWindowMs]
    );

    // Seed + update chart from live quote changes.
    useEffect(() => {
        const value = quote?.bid ?? quote?.price ?? null;
        if (value === null) return;
        const tsSec = typeof quote?.timestamp === 'number' ? quote.timestamp : Math.floor(Date.now() / 1000);
        pushPoint({ timestamp: tsSec * 1000, value });
    }, [pushPoint, quote?.bid, quote?.price, quote?.timestamp]);

    // When symbol or period changes, reset series to the latest known point.
    useEffect(() => {
        const value = quote?.bid ?? quote?.price ?? null;
        const tsSec = typeof quote?.timestamp === 'number' ? quote.timestamp : Math.floor(Date.now() / 1000);
        if (value === null) {
            setSeries([]);
            return;
        }
        setSeries([{ timestamp: tsSec * 1000, value }]);
        refetchQuotes().catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePeriod, selectedSymbol]);

    const chartData = useMemo(() => {
        if (!series.length) return [];
        if (series.length >= 2) return series;
        const only = series[0];
        return [
            { timestamp: only.timestamp - 60_000, value: only.value },
            only,
        ];
    }, [series]);

    const bid = quote?.bid ?? quote?.price ?? 0;
    const ask = quote?.ask ?? quote?.price ?? 0;
    const spread = quote?.spread ?? (ask && bid ? Math.abs(ask - bid) : 0);
    const changePct = quote?.changePct ?? 0;

    return (
        <LinearGradient colors={[colors.bgPrimary, colors.bgSecondary]} style={styles.gradient}>
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.logoText}>TradeQuip</Text>
                    <View style={styles.headerCenter}>
                        <Text style={styles.headerTitle}>Charts</Text>
                        {isLive && (
                            <View style={styles.liveIndicator}>
                                <View style={styles.liveDot} />
                                <Text style={styles.liveText}>LIVE</Text>
                            </View>
                        )}
                    </View>
                    <View style={styles.headerRight} />
                </View>

                {/* Symbol select */}
                <View style={styles.symbolRow}>
                    <SymbolSelect
                        symbols={symbols.map((s) => ({ symbol: s.symbol, name: s.name }))}
                        selectedSymbol={selectedSymbol}
                        onSelect={(sym) => setSelectedSymbol(sym.symbol)}
                        placeholder="Select symbol"
                    />
                    <View style={styles.quoteMeta}>
                        <Text style={styles.quoteMetaLabel}>Bid</Text>
                        <Text style={styles.quoteMetaValue}>{formatPrice(selectedSymbol, bid)}</Text>
                    </View>
                </View>

                {/* Chart */}
                <GlassCard style={styles.chartCard}>
                    <View style={styles.chartHeader}>
                        <View>
                            <Text style={styles.symbolTitle}>{selectedSymbol}</Text>
                            <Text style={styles.symbolSubtitle}>
                                {quote?.name || symbols.find((s) => s.symbol === selectedSymbol)?.name || ''}
                            </Text>
                        </View>
                        <Text style={[styles.changeText, changePct >= 0 ? styles.positive : styles.negative]}>
                            {changePct >= 0 ? '+' : ''}
                            {changePct.toFixed(2)}%
                        </Text>
                    </View>

                    <View style={styles.periodRow}>
                        {PERIODS.map((p) => (
                            <View key={p.key} style={styles.periodButtonWrap}>
                                <Button
                                    title={p.label}
                                    variant={activePeriod === p.key ? 'primary' : 'ghost'}
                                    size="small"
                                    onPress={() => setActivePeriod(p.key)}
                                    style={styles.periodButton}
                                />
                            </View>
                        ))}
                    </View>

                    <View style={styles.chartArea}>
                        {chartData.length ? (
                            <LineChart.Provider data={chartData}>
                                <View style={styles.chartLabels}>
                                    <LineChart.PriceText
                                        precision={6}
                                        useOptimizedRendering
                                        style={styles.chartPrice}
                                        format={({ value }) => formatPrice(selectedSymbol, Number(value) || 0)}
                                    />
                                    <LineChart.DatetimeText
                                        style={styles.chartDatetime}
                                        options={{ month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }}
                                    />
                                </View>
                                <LineChart height={220}>
                                    <LineChart.Path
                                        color={colors.accent}
                                        width={2}
                                        isTransitionEnabled
                                    />
                                    <LineChart.Gradient
                                        color={colors.accent}
                                        opacity={0.12}
                                    />
                                    <LineChart.CursorCrosshair color={colors.accent}>
                                        <LineChart.Tooltip />
                                    </LineChart.CursorCrosshair>
                                </LineChart>
                            </LineChart.Provider>
                        ) : (
                            <View style={styles.chartEmpty}>
                                <Icon name="activity" size={28} color={colors.textMuted} />
                                <Text style={styles.chartEmptyText}>Waiting for quotes…</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.stat}>
                            <Text style={styles.statLabel}>Bid</Text>
                            <Text style={styles.statValue}>{formatPrice(selectedSymbol, bid)}</Text>
                        </View>
                        <View style={styles.stat}>
                            <Text style={styles.statLabel}>Ask</Text>
                            <Text style={styles.statValue}>{formatPrice(selectedSymbol, ask)}</Text>
                        </View>
                        <View style={styles.stat}>
                            <Text style={styles.statLabel}>Spread</Text>
                            <Text style={styles.statValue}>{formatPrice(selectedSymbol, spread)}</Text>
                        </View>
                    </View>
                </GlassCard>

                {/* Actions */}
                <View style={styles.actionsRow}>
                    <Button
                        title="Buy"
                        variant="buy"
                        onPress={() => navigation.navigate('Trade', { symbol: selectedSymbol, side: 'BUY' })}
                        style={styles.actionButton}
                    />
                    <Button
                        title="Sell"
                        variant="sell"
                        onPress={() => navigation.navigate('Trade', { symbol: selectedSymbol, side: 'SELL' })}
                        style={styles.actionButton}
                    />
                </View>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    gradient: { flex: 1 },
    container: { flex: 1, paddingHorizontal: spacing.screenPadding },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.md,
    },
    logoText: { ...typography.h4, color: colors.accent },
    headerCenter: { alignItems: 'center', gap: 6 },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    headerRight: { width: 60 },
    liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
    liveText: { ...typography.labelSmall, color: colors.success },
    symbolRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    quoteMeta: { alignItems: 'flex-end' },
    quoteMetaLabel: { ...typography.labelSmall, color: colors.textMuted },
    quoteMetaValue: { ...typography.price, color: colors.textPrimary },
    chartCard: { flex: 1, padding: spacing.md },
    chartHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
    },
    symbolTitle: { ...typography.h3, color: colors.textPrimary },
    symbolSubtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
    changeText: { ...typography.bodyBold },
    positive: { color: colors.success },
    negative: { color: colors.error },
    periodRow: { flexDirection: 'row', marginBottom: spacing.md, gap: spacing.xs },
    periodButtonWrap: { flex: 1 },
    periodButton: { width: '100%' },
    chartArea: { marginBottom: spacing.md },
    chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
    chartPrice: { ...typography.priceLarge, color: colors.textPrimary },
    chartDatetime: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'right' },
    chartEmpty: {
        height: 220,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    chartEmptyText: { ...typography.bodySmall, color: colors.textMuted },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.md,
    },
    stat: { alignItems: 'center', flex: 1 },
    statLabel: { ...typography.labelSmall, color: colors.textMuted },
    statValue: { ...typography.price, color: colors.textPrimary, marginTop: 4 },
    actionsRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
    actionButton: { flex: 1 },
});

export default ChartsScreen;
